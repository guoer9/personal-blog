"""Unified administrator view for manual and Notion-backed articles."""

from datetime import datetime, timezone
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_admin
from app.db.session import get_db
from app.models.notion_library import NotionDocument
from app.models.notion import NotionPage
from app.models.post import Post
from app.crud.comment import get_article_comments
from app.schemas.comment import CommentResponse
from app.schemas.articles import AdminArticlePage, AdminArticleResponse, ArticleKind


router = APIRouter(
    prefix="/admin/articles",
    dependencies=[Depends(get_current_admin)],
)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _post_article(post: Post) -> dict[str, Any]:
    return {
        "id": post.id,
        "key": f"post:{post.id}",
        "kind": "post",
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "status": "published" if post.is_published else "draft",
        "is_published": bool(post.is_published),
        "author": post.author,
        "author_label": post.author.username if post.author else "未指定作者",
        "tags": [tag.name for tag in post.tags],
        "comment_count": len(post.comments),
        "view_count": post.view_count or 0,
        "public_url": f"/documents/{post.slug}",
        "external_url": None,
        "source_label": "手动文章",
        "created_at": _utc(post.created_at),
        "updated_at": _utc(post.updated_at),
    }


def _notion_article(document: NotionDocument) -> dict[str, Any]:
    published = document.status == "published" and not document.manual_unpublished
    return {
        "id": document.id,
        "key": f"notion:{document.id}",
        "kind": "notion",
        "title": document.title,
        "slug": document.slug,
        "summary": document.summary,
        "status": document.status,
        "is_published": published,
        "author": document.author,
        "author_label": document.author.username if document.author else "Notion 导入",
        "tags": list(document.categories or []),
        "comment_count": len(document.comments),
        "view_count": document.view_count or 0,
        "public_url": f"/documents/{document.slug}",
        "external_url": f"https://www.notion.so/{document.notion_page_id.replace('-', '')}",
        "source_label": document.source.title if document.source else "Notion",
        "created_at": _utc(document.created_at),
        "updated_at": _utc(document.updated_at),
    }


@router.get("", response_model=AdminArticlePage)
async def list_admin_articles(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    posts = list(
        (
            await db.scalars(
                select(Post)
                .where(~Post.id.in_(select(NotionPage.post_id).join(
                    NotionDocument, NotionDocument.notion_page_id == NotionPage.notion_page_id
                )))
                .options(
                    selectinload(Post.author),
                    selectinload(Post.tags),
                    selectinload(Post.comments),
                )
            )
        ).all()
    )
    documents = list(
        (
            await db.scalars(
                select(NotionDocument)
                .options(
                    selectinload(NotionDocument.author),
                    selectinload(NotionDocument.source),
                    selectinload(NotionDocument.comments),
                )
            )
        ).all()
    )
    rows = [_post_article(post) for post in posts]
    rows.extend(_notion_article(document) for document in documents)
    rows.sort(key=lambda row: (_utc(row["updated_at"]), row["key"]), reverse=True)
    total = len(rows)
    offset = (page - 1) * page_size
    return {
        "items": rows[offset : offset + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@router.get("/{kind}/{article_id}/comments", response_model=list[CommentResponse])
async def list_admin_article_comments(kind: ArticleKind, article_id: int, db: AsyncSession = Depends(get_db)):
    model = Post if kind == "post" else NotionDocument
    if await db.get(model, article_id) is None:
        raise HTTPException(404, "文章不存在")
    target = {"post_id": article_id} if kind == "post" else {"notion_document_id": article_id}
    return await get_article_comments(db, **target)


@router.post("/{kind}/{article_id}/unpublish", response_model=AdminArticleResponse)
async def unpublish_article(
    kind: ArticleKind,
    article_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    if kind == "post":
        article = await db.scalar(
            select(Post)
            .options(selectinload(Post.author), selectinload(Post.tags), selectinload(Post.comments))
            .where(Post.id == article_id)
        )
        if article is None:
            raise HTTPException(404, "文章不存在")
        article.is_published = False
        article.updated_at = now.replace(tzinfo=None)
        result = _post_article(article)
    else:
        article = await db.scalar(
            select(NotionDocument)
            .options(selectinload(NotionDocument.author), selectinload(NotionDocument.source), selectinload(NotionDocument.comments))
            .where(NotionDocument.id == article_id)
        )
        if article is None:
            raise HTTPException(404, "Notion 文章不存在")
        article.manual_unpublished = True
        article.status = "archived"
        article.isolation_reason = "管理员手动下架"
        article.updated_at = now
        result = _notion_article(article)
    await db.commit()
    return result
