from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
import math

from app.db.session import get_db
from app.schemas.post import (
    PostCreate, PostUpdate, PostListResponse, 
    PostDetailResponse, PostPaginatedResponse
)
from app.crud.post import (
    get_post_by_id, get_posts,
    create_post, update_post, delete_post,
    increment_view_count
)
from app.crud.article import get_article_by_slug, get_public_articles, get_public_article_tags
from app.schemas.articles import PublicArticlePage, PublicArticleTag
from app.api.deps import get_current_admin
from app.models.user import User
from app.models.notion_library import NotionDocument
from app.core.config import settings

router = APIRouter()


@router.get("", response_model=PublicArticlePage)
async def list_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    tag: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """公开文章索引：手写文章和资料库中的 Notion 文章。"""
    posts, total = await get_public_articles(db, page, page_size, tag_slug=tag)
    
    return PublicArticlePage(
        items=posts,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0
    )


@router.get("/topics/list", response_model=list[PublicArticleTag])
async def list_article_tags(db: AsyncSession = Depends(get_db)):
    """公开主题索引；不向管理端标签选择器添加虚构的标签 ID。"""
    return await get_public_article_tags(db)


@router.get("/search", response_model=PublicArticlePage)
async def search(
    q: str = Query(..., min_length=1, max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """搜索文章"""
    posts, total = await get_public_articles(db, page, page_size, keyword=q)
    
    return PublicArticlePage(
        items=posts,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0
    )


@router.get("/admin/list", response_model=PostPaginatedResponse)
async def list_posts_for_admin(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """后台文章管理列表（包含草稿）；与公开文章列表隔离。"""
    posts, total = await get_posts(db, page, page_size, include_unpublished=True)
    return PostPaginatedResponse(
        items=posts,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0,
    )


@router.get("/id/{post_id}", response_model=PostDetailResponse)
async def get_post_by_id_for_admin(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """管理员按 ID 获取文章（包含草稿）"""
    post = await get_post_by_id(db, post_id, include_unpublished=True)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    return post


@router.get("/{slug}", response_model=None)
async def get_post(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """兼容旧文章 API；公开页面统一使用 /documents。"""
    article = await get_article_by_slug(db, slug)
    if isinstance(article, NotionDocument):
        if article.status == "published" and not article.manual_unpublished:
            return RedirectResponse(
                url=f"{settings.API_V1_PREFIX}/documents/{article.slug}",
                status_code=307,
            )
        raise HTTPException(status_code=404, detail="文章不存在")

    if article is None or not article.is_published:
        raise HTTPException(status_code=404, detail="文章不存在")
    
    # 增加浏览次数
    await increment_view_count(db, article)
    await db.commit()
    
    return article


@router.post("", response_model=PostDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_new_post(
    post_in: PostCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """创建文章（管理员）"""
    post = await create_post(db, post_in, current_user.id)
    await db.commit()
    await db.refresh(post)
    return post


@router.put("/{post_id}", response_model=PostDetailResponse)
async def update_existing_post(
    post_id: int,
    post_in: PostUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """更新文章（管理员）"""
    post = await get_post_by_id(db, post_id, include_unpublished=True)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    
    post = await update_post(db, post, post_in)
    await db.commit()
    await db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """删除文章（管理员）"""
    post = await get_post_by_id(db, post_id, include_unpublished=True)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    
    await delete_post(db, post)
    await db.commit()
    return None
