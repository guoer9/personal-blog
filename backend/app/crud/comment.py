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
) -> list[dict]:
    return await get_article_comments(db, post_id=post_id)


def comment_response(comment: Comment) -> dict:
    return {
        "id": comment.id,
        "content": comment.content,
        "post_id": comment.post_id,
        "notion_document_id": comment.notion_document_id,
        "user": comment.user,
        "parent_id": comment.parent_id,
        "created_at": comment.created_at,
        "replies": [],
    }


async def get_article_comments(
    db: AsyncSession, *, post_id: int | None = None, notion_document_id: int | None = None
) -> list[dict]:
    """Load the whole discussion once, then build its reply tree without lazy SQL."""
    target = Comment.post_id == post_id if post_id is not None else Comment.notion_document_id == notion_document_id
    result = await db.execute(
        select(Comment)
        .options(selectinload(Comment.user))
        .where(target)
        .order_by(Comment.created_at.desc())
    )
    rows = {comment.id: comment_response(comment) for comment in result.scalars()}
    roots = []
    for row in rows.values():
        parent = rows.get(row["parent_id"])
        if parent is not None:
            parent["replies"].append(row)
        else:
            roots.append(row)
    return roots


async def create_comment(
    db: AsyncSession, comment_in: CommentCreate, user_id: int
) -> Comment:
    """创建评论"""
    comment = Comment(
        content=comment_in.content,
        post_id=comment_in.post_id,
        notion_document_id=comment_in.notion_document_id,
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
