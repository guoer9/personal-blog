from typing import Optional, List
from slugify import slugify
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.post import Tag
from app.schemas.post import TagCreate


async def get_tag_by_id(db: AsyncSession, tag_id: int) -> Optional[Tag]:
    """通过 ID 获取标签"""
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    return result.scalar_one_or_none()


async def get_tag_by_slug(db: AsyncSession, slug: str) -> Optional[Tag]:
    """通过 slug 获取标签"""
    result = await db.execute(select(Tag).where(Tag.slug == slug))
    return result.scalar_one_or_none()


async def get_tag_by_name(db: AsyncSession, name: str) -> Optional[Tag]:
    """通过名称获取标签"""
    result = await db.execute(select(Tag).where(Tag.name == name))
    return result.scalar_one_or_none()


async def get_all_tags(db: AsyncSession) -> List[Tag]:
    """获取所有标签"""
    result = await db.execute(select(Tag).order_by(Tag.name))
    return list(result.scalars().all())


async def generate_unique_tag_slug(db: AsyncSession, name: str) -> str:
    """生成唯一的标签 slug"""
    base_slug = slugify(name, allow_unicode=True)
    if not base_slug:
        base_slug = "tag"
    
    slug = base_slug
    counter = 1
    
    while True:
        result = await db.execute(select(Tag).where(Tag.slug == slug))
        if not result.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    return slug


async def create_tag(db: AsyncSession, tag_in: TagCreate) -> Tag:
    """创建标签"""
    slug = await generate_unique_tag_slug(db, tag_in.name)
    
    tag = Tag(
        name=tag_in.name,
        slug=slug,
    )
    
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag: Tag) -> None:
    """删除标签"""
    await db.delete(tag)
    await db.flush()
