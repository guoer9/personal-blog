from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.post import TagCreate, TagResponse
from app.crud.tag import (
    get_all_tags, get_tag_by_name, create_tag, get_tag_by_id, delete_tag
)
from app.api.deps import get_current_admin
from app.models.user import User

router = APIRouter()


@router.get("", response_model=List[TagResponse])
async def list_tags(db: AsyncSession = Depends(get_db)):
    """获取所有标签"""
    tags = await get_all_tags(db)
    return tags


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_new_tag(
    tag_in: TagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """创建标签（管理员）"""
    existing = await get_tag_by_name(db, tag_in.name)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="标签已存在"
        )
    
    tag = await create_tag(db, tag_in)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """删除标签（管理员）"""
    tag = await get_tag_by_id(db, tag_id)
    if not tag:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="标签不存在"
        )
    
    await delete_tag(db, tag)
    return None
