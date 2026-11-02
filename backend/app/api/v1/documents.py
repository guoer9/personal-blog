"""Public Notion library documents, isolated from ordinary blog posts."""

import math
import unicodedata
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.notion_library import NotionDocument
from app.schemas.documents import PublicDocumentDetail, PublicDocumentList
from app.services.notion_content import media_directory, NotionContentError


router = APIRouter(prefix="/documents")


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _matches(document: NotionDocument, query: str | None, category: str | None) -> bool:
    if category and category not in (document.categories or []):
        return False
    if not query:
        return True
    needle = _normalize(query)
    haystack = _normalize(
        " ".join(
            [
                document.title,
                document.summary or "",
                document.content,
                " ".join(document.categories or []),
            ]
        )
    )
    return needle in haystack


def _sort_key(document: NotionDocument):
    return (document.updated_at or document.created_at, document.id)


def _summary(document: NotionDocument) -> dict:
    return {
        "id": document.id,
        "slug": document.slug,
        "title": document.title,
        "summary": document.summary,
        "categories": list(document.categories or []),
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "icon": document.icon,
        "cover_url": document.cover_url,
        "author": document.author,
        "author_label": document.author.username if document.author else "Notion 导入",
        "view_count": document.view_count or 0,
        "comment_count": len(document.comments),
        "public_url": f"/documents/{document.slug}",
        "external_url": f"https://www.notion.so/{document.notion_page_id.replace('-', '')}",
    }


@router.get("", response_model=PublicDocumentList)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    category: str | None = Query(None, max_length=100),
    q: str | None = Query(None, max_length=120),
    source_id: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows = list(
        (
            await db.scalars(
                select(NotionDocument).options(selectinload(NotionDocument.comments)).where(
                    NotionDocument.status == "published", NotionDocument.manual_unpublished.is_(False)
                )
            )
        ).all()
    )
    if source_id is not None:
        rows = [row for row in rows if row.source_id == source_id]
    rows = [row for row in rows if _matches(row, q, category)]
    rows.sort(key=_sort_key, reverse=True)
    total = len(rows)
    offset = (page - 1) * page_size
    items = [_summary(row) for row in rows[offset : offset + page_size]]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@router.get("/media/{page_id}/{asset}")
async def document_media(page_id: str, asset: str, db: AsyncSession = Depends(get_db)):
    if not re.fullmatch(r"[a-f0-9-]{36}", page_id) or not re.fullmatch(r"[a-f0-9]{64}\.(?:png|jpg|gif|webp)", asset):
        raise HTTPException(404, "图片不存在")
    document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == page_id, NotionDocument.status == "published"))
    target = f"/api/v1/documents/media/{page_id}/{asset}"
    def referenced(value):
        if isinstance(value, dict):
            return value.get("url") == target or any(referenced(item) for item in value.values())
        if isinstance(value, list): return any(referenced(item) for item in value)
        return False
    if document is None or (document.cover_url != target and not referenced(document.content_blocks)):
        raise HTTPException(404, "图片不存在")
    try:
        path = media_directory(page_id) / asset
    except (ValueError, NotionContentError, OSError):
        raise HTTPException(404, "图片不存在") from None
    if path.is_symlink() or not path.is_file(): raise HTTPException(404, "图片不存在")
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.get("/{slug}", response_model=PublicDocumentDetail)
async def get_document(slug: str, db: AsyncSession = Depends(get_db)) -> dict:
    document = await db.scalar(
        select(NotionDocument).options(selectinload(NotionDocument.comments)).where(
            NotionDocument.slug == slug,
            NotionDocument.status == "published",
            NotionDocument.manual_unpublished.is_(False),
        )
    )
    if document is None:
        raise HTTPException(404, "资料不存在")
    await db.execute(update(NotionDocument).where(NotionDocument.id == document.id).values(
        view_count=NotionDocument.view_count + 1,
        updated_at=NotionDocument.updated_at,
    ))
    await db.commit()
    return {**_summary(document), "content": document.content, "blocks": document.content_blocks}
