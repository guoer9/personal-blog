from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.comment import CommentCreate, CommentResponse
from app.crud.comment import (
    get_comments_by_post, create_comment, get_comment_by_id, delete_comment
)
from app.crud.post import get_post_by_id
from app.api.deps import get_current_user_required, get_current_admin
from app.models.user import User

router = APIRouter()


@router.get("/post/{post_id}", response_model=List[CommentResponse])
async def list_comments(
    post_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取文章的评论列表"""
    post = await get_post_by_id(db, post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    
    comments = await get_comments_by_post(db, post_id)
    return comments


@router.post("", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_new_comment(
    comment_in: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user_required)
):
    """发表评论（需登录）"""
    # 检查文章是否存在
    post = await get_post_by_id(db, comment_in.post_id)
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )
    
    # 如果是回复，检查父评论是否存在
    if comment_in.parent_id:
        parent = await get_comment_by_id(db, comment_in.parent_id)
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="父评论不存在"
            )
        # 确保父评论属于同一篇文章
        if parent.post_id != comment_in.post_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="父评论不属于该文章"
            )
    
    comment = await create_comment(db, comment_in, current_user.id)
    return comment


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user_required)
):
    """删除评论（评论作者或管理员）"""
    comment = await get_comment_by_id(db, comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="评论不存在"
        )
    
    # 只有评论作者或管理员可以删除
    if comment.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权删除该评论"
        )
    
    await delete_comment(db, comment)
    return None
