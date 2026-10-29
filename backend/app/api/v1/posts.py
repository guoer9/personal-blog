from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
import math

from app.db.session import get_db
from app.schemas.post import (
    PostCreate, PostUpdate, PostListResponse, 
    PostDetailResponse, PostPaginatedResponse
)
from app.crud.post import (
    get_post_by_id, get_post_by_slug, get_posts, 
    create_post, update_post, delete_post,
    increment_view_count, search_posts
)
from app.api.deps import get_current_user, get_current_admin
from app.models.user import User

router = APIRouter()


@router.get("", response_model=PostPaginatedResponse)
async def list_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    tag: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """获取文章列表"""
    # 管理员可以看到未发布的文章
    include_unpublished = current_user and current_user.is_admin
    
    posts, total = await get_posts(
        db, page, page_size, 
        tag_slug=tag, 
        include_unpublished=include_unpublished
    )
    
    return PostPaginatedResponse(
        items=posts,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0
    )


@router.get("/search", response_model=PostPaginatedResponse)
async def search(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """搜索文章"""
    posts, total = await search_posts(db, q, page, page_size)
    
    return PostPaginatedResponse(
        items=posts,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0
    )


@router.get("/{slug}", response_model=PostDetailResponse)
async def get_post(
    slug: str,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """获取文章详情"""
    include_unpublished = current_user and current_user.is_admin
    post = await get_post_by_slug(db, slug, include_unpublished=include_unpublished)
    
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    
    # 增加浏览次数
    await increment_view_count(db, post)
    
    return post


@router.post("", response_model=PostDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_new_post(
    post_in: PostCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """创建文章（管理员）"""
    post = await create_post(db, post_in, current_user.id)
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
    return None
