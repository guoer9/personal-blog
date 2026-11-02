from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User
from app.models.work import Work
from app.schemas.work import AdminWork, AdminWorkList, AssetCreate, AssetResponse, Category, PublicWork, PublicWorkList, WorkCreate, WorkUpdate, WorkVersion
from app.services import works as service
from app.services.work_assets import prepare, publication_write, storage_status, cleanup_assets

public_router = APIRouter()
admin_router = APIRouter(prefix="/admin/works", dependencies=[Depends(get_current_admin)])
asset_admin_router = APIRouter(prefix="/admin/work-assets")
PREVIEW_COOKIE = "work_media_preview"


@public_router.get("/works", response_model=PublicWorkList)
async def list_public(response: Response, category: Category | None = None, featured: bool | None = None, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    rows = (await db.scalars(select(Work).where(Work.published.is_not(None)))).all()
    rows = [row for row in rows if row.published and (category is None or row.published["category"] == category) and (featured is None or row.published["featured"] == featured)]
    rows.sort(key=lambda row: (row.published["sort_order"], row.slug))
    return {"items": [await service.project(db, row) for row in rows]}


@public_router.get("/works/{slug}", response_model=PublicWork)
async def get_public(slug: str, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    work = await db.scalar(select(Work).where(Work.slug == slug))
    if work is None or not work.published:
        raise HTTPException(404, "作品不存在或尚未发布")
    return await service.project(db, work)


def media_response(asset, path):
    return FileResponse(path, media_type=asset.mime_type, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin"})


@public_router.get("/work-assets/{asset_id}")
async def public_media(asset_id: UUID, db: AsyncSession = Depends(get_db)):
    return media_response(*(await service.public_asset(db, asset_id)))


@admin_router.get("", response_model=AdminWorkList)
async def admin_list(db: AsyncSession = Depends(get_db)):
    return {"items": (await db.scalars(select(Work).order_by(Work.updated_at.desc()))).all()}


@admin_router.post("", response_model=AdminWork, status_code=201)
async def admin_create(data: WorkCreate, db: AsyncSession = Depends(get_db)):
    draft = data.model_dump(mode="json", exclude={"slug"})
    async with publication_write(db):
        await service.validate_assets(db, draft)
        work = await service.create(db, data)
    return work


@admin_router.get("/{work_id}", response_model=AdminWork)
async def admin_get(work_id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.record(db, work_id)


@admin_router.put("/{work_id}", response_model=AdminWork)
async def admin_update(work_id: UUID, data: WorkUpdate, db: AsyncSession = Depends(get_db)):
    draft = data.model_dump(mode="json", exclude={"version"})
    async with publication_write(db):
        await service.validate_assets(db, draft)
        work = await service.change(db, work_id, data.version, {"draft": draft})
    return work


@admin_router.get("/{work_id}/preview", response_model=PublicWork)
async def admin_preview(work_id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.project(db, await service.record(db, work_id), preview=True)


@admin_router.post("/{work_id}/publish", response_model=AdminWork)
async def admin_publish(work_id: UUID, data: WorkVersion, db: AsyncSession = Depends(get_db)):
    async with publication_write(db):
        work = await service.publish(db, work_id, data.version)
    return work


@admin_router.post("/{work_id}/unpublish", response_model=AdminWork)
async def admin_unpublish(work_id: UUID, data: WorkVersion, db: AsyncSession = Depends(get_db)):
    async with publication_write(db):
        work = await service.change(db, work_id, data.version, {"published": None, "published_at": None})
    return work


@asset_admin_router.post("", response_model=AssetResponse, status_code=201)
async def create_asset(data: AssetCreate, db: AsyncSession = Depends(get_db), admin=Depends(get_current_admin)):
    async with publication_write(db):
        asset = await prepare(db, data.entry_id, data.role)
    return asset


@asset_admin_router.get('/storage', dependencies=[Depends(get_current_admin)])
async def asset_storage(db: AsyncSession = Depends(get_db)):
    async with publication_write(db):
        return storage_status()


@asset_admin_router.post('/cleanup', dependencies=[Depends(get_current_admin)])
async def asset_cleanup(db: AsyncSession = Depends(get_db)):
    async with publication_write(db):
        return await cleanup_assets(db)


@asset_admin_router.post("/preview-session", status_code=204)
async def preview_session(response: Response, admin=Depends(get_current_admin)):
    token = jwt.encode({"sub": str(admin.id), "type": "work-preview", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    response.set_cookie(PREVIEW_COOKIE, token, max_age=300, httponly=True, secure=settings.ENVIRONMENT.lower() == "production", samesite="strict", path=settings.API_V1_PREFIX + "/admin/work-assets")


@asset_admin_router.delete("/preview-session", status_code=204)
async def close_preview_session(response: Response):
    response.delete_cookie(PREVIEW_COOKIE, path=settings.API_V1_PREFIX + "/admin/work-assets", httponly=True, samesite="strict")


async def preview_admin(request: Request, current=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current is not None:
        if current.is_admin:
            return current
        raise HTTPException(403, "需要管理员权限")
    payload = decode_token(request.cookies.get(PREVIEW_COOKIE, ""))
    if not payload or payload.get("type") != "work-preview":
        raise HTTPException(401, "需要登录后预览")
    try:
        user = await db.get(User, int(payload["sub"]))
    except (KeyError, ValueError, TypeError):
        user = None
    if not user or not user.is_active or not user.is_admin:
        raise HTTPException(403, "预览权限已失效")
    return user


@asset_admin_router.get("/{asset_id}")
async def preview_media(asset_id: UUID, db: AsyncSession = Depends(get_db), admin=Depends(preview_admin)):
    return media_response(*(await service.get_asset(db, asset_id)))
