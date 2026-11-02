"""Administrator endpoints for manual Notion sync and library import."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.db.session import get_db
from app.models.user import User
from app.schemas.notion_library import (
    NotionConnectionSummary,
    NotionLibraryStatus,
    NotionLinkRequest,
    NotionPageLinkRequest,
    NotionSourceResponse,
)
from app.services.notion_library import (
    NotionLibraryBusy,
    NotionLibraryError,
    notion_library_service,
)
from app.services.notion_sync import (
    NotionSyncBusy,
    NotionSyncError,
    notion_sync_service,
)


class NotionSyncCounters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queried: int
    published: int
    updated: int
    unpublished: int
    skipped: int
    failed: int


class NotionSyncStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    enabled: bool
    interval_seconds: int
    status: Literal["never", "running", "success", "error"]
    last_started_at: str | None
    last_finished_at: str | None
    last_success_at: str | None
    last_error: str | None
    counters: NotionSyncCounters


router = APIRouter(
    prefix="/admin/notion",
    dependencies=[Depends(get_current_admin)],
)


def _library_http_exception(error: NotionLibraryError) -> HTTPException:
    if isinstance(error, NotionLibraryBusy):
        return HTTPException(409, str(error))
    if "链接" in str(error) or "connection" in str(error).lower():
        return HTTPException(400, str(error))
    return HTTPException(502, str(error))


async def _commit_or_safe_500(db: AsyncSession) -> None:
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(500, "Notion sync result could not be saved") from None


@router.get("/connections", response_model=list[NotionConnectionSummary])
async def list_connections() -> list[dict]:
    try:
        return notion_library_service.list_connections()
    except NotionLibraryError as error:
        raise _library_http_exception(error) from None


@router.get("/sources", response_model=list[NotionSourceResponse])
async def list_sources(db: AsyncSession = Depends(get_db)) -> list[dict]:
    try:
        return await notion_library_service.list_sources(db)
    except NotionLibraryError as error:
        raise _library_http_exception(error) from None


@router.get("/connections/{connection_id}/workspace")
async def browse_workspace(
    connection_id: str,
    cursor: str | None = Query(None, max_length=2048),
    q: str | None = Query(None, max_length=120),
) -> dict:
    try:
        return await notion_library_service.browse_workspace(connection_id, cursor, q)
    except NotionLibraryError as error:
        raise _library_http_exception(error) from None


@router.post("/sources/inspect")
async def inspect_source(
    payload: NotionLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await notion_library_service.inspect(db, payload.connection_id, payload.url)
    except NotionLibraryError as error:
        raise _library_http_exception(error) from None


@router.post("/sources")
async def import_source(
    payload: NotionLinkRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> dict:
    try:
        result = await notion_library_service.import_source(
            db, payload.connection_id, payload.url, admin.id
        )
        await _commit_or_safe_500(db)
        return result
    except NotionLibraryError as error:
        await db.rollback()
        raise _library_http_exception(error) from None


@router.post("/sources/{source_id}/sync")
async def sync_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> dict:
    try:
        result = await notion_library_service.sync(db, source_id, admin.id)
        await _commit_or_safe_500(db)
        return result
    except NotionLibraryBusy as error:
        await db.rollback()
        raise HTTPException(409, str(error)) from None
    except NotionLibraryError as error:
        # sync() may have persisted a sanitized error state before raising.
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise HTTPException(500, "Notion sync result could not be saved") from None
        raise _library_http_exception(error) from None


@router.post("/sources/{source_id}/pages/inspect")
async def inspect_page(
    source_id: int,
    payload: NotionPageLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await notion_library_service.inspect_page(db, source_id, payload.url)
    except NotionLibraryError as error:
        raise _library_http_exception(error) from None


@router.post("/sources/{source_id}/pages/import")
async def import_page(
    source_id: int,
    payload: NotionPageLinkRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> dict:
    try:
        result = await notion_library_service.import_page(db, source_id, payload.url, admin.id)
        await _commit_or_safe_500(db)
        return result
    except NotionLibraryError as error:
        await db.rollback()
        raise _library_http_exception(error) from None


@router.get("/status", response_model=NotionLibraryStatus)
async def status(db: AsyncSession = Depends(get_db)) -> dict:
    return await notion_library_service.get_status(db)


# Compatibility endpoints for the first single-source prototype. They remain
# explicit manual actions, while the application lifespan no longer starts
# the legacy scheduler. New UI code should use /connections and /sources.
@router.get("/legacy/status", response_model=NotionSyncStatus, deprecated=True)
async def legacy_status(db: AsyncSession = Depends(get_db)) -> dict:
    return await notion_sync_service.get_status(db)


@router.post("/sync", response_model=NotionSyncStatus)
async def sync(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> dict | JSONResponse:
    if not notion_sync_service.config.is_ready:
        raise HTTPException(503, "Notion sync is not configured")

    try:
        result = await notion_sync_service.sync(db, author_id=admin.id)
    except NotionSyncBusy:
        raise HTTPException(409, "A Notion sync is already running") from None
    except NotionSyncError:
        await _commit_or_safe_500(db)
        return JSONResponse(
            status_code=502,
            content=await notion_sync_service.get_status(db),
        )

    await _commit_or_safe_500(db)
    return result
