from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.comment import Comment
from app.schemas.comment import CommentCreate


async def get_comment_by_id(db: AsyncSession, comment_id: int) -> Optional[Comment]:
    """通过 ID 获取评论"""
    result = await db.execute(
        select(Comment)
        .options(selectinload(Comment.user))
        .where(Comment.id == comment_id)
    )
    return result.scalar_one_or_none()


async def get_comments_by_post(
    db: AsyncSession, post_id: int
) -> List[Comment]:
    """获取文章的所有评论（只获取顶级评论，嵌套通过关系加载）"""
    result = await db.execute(
        select(Comment)
        .options(
            selectinload(Comment.user),
            selectinload(Comment.replies).selectinload(Comment.user)
        )
        .where(
            Comment.post_id == post_id,
            Comment.parent_id == None  # 只获取顶级评论
        )
        .order_by(Comment.created_at.desc())
    )
    return list(result.scalars().all())


async def create_comment(
    db: AsyncSession, comment_in: CommentCreate, user_id: int
) -> Comment:
    """创建评论"""
    comment = Comment(
        content=comment_in.content,
        post_id=comment_in.post_id,
        user_id=user_id,
        parent_id=comment_in.parent_id,
    )
    
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    
    # 加载用户关系
    result = await db.execute(
        select(Comment)
        .options(selectinload(Comment.user))
        .where(Comment.id == comment.id)
    )
    return result.scalar_one()


async def delete_comment(db: AsyncSession, comment: Comment) -> None:
    """删除评论"""
    await db.delete(comment)
    await db.flush()
