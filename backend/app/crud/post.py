import unicodedata
from typing import Optional, List, Tuple
from slugify import slugify
from sqlalchemy import case, select, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.post import Post, Tag
from app.schemas.post import PostCreate, PostUpdate


async def get_post_by_id(
    db: AsyncSession, post_id: int, include_unpublished: bool = False
) -> Optional[Post]:
    """通过 ID 获取文章"""
    query = select(Post).options(
        selectinload(Post.author),
        selectinload(Post.tags)
    ).where(Post.id == post_id)
    
    if not include_unpublished:
        query = query.where(Post.is_published == True)
    
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_post_by_slug(
    db: AsyncSession, slug: str, include_unpublished: bool = False
) -> Optional[Post]:
    """通过 slug 获取文章"""
    query = select(Post).options(
        selectinload(Post.author),
        selectinload(Post.tags)
    ).where(Post.slug == slug)
    
    if not include_unpublished:
        query = query.where(Post.is_published == True)
    
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_posts(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 10,
    tag_slug: Optional[str] = None,
    include_unpublished: bool = False
) -> Tuple[List[Post], int]:
    """获取文章列表（分页）"""
    query = select(Post).options(
        selectinload(Post.author),
        selectinload(Post.tags)
    )
    count_query = select(func.count(Post.id))
    
    if not include_unpublished:
        query = query.where(Post.is_published == True)
        count_query = count_query.where(Post.is_published == True)
    
    if tag_slug:
        query = query.join(Post.tags).where(Tag.slug == tag_slug)
        count_query = count_query.join(Post.tags).where(Tag.slug == tag_slug)
    
    # 排序：最新的在前
    query = query.order_by(Post.created_at.desc())
    
    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    result = await db.execute(query)
    posts = result.scalars().all()
    
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    
    return list(posts), total


async def generate_unique_slug(db: AsyncSession, title: str, post_id: Optional[int] = None) -> str:
    """生成唯一的 slug"""
    base_slug = slugify(title, allow_unicode=True)
    if not base_slug:
        base_slug = "post"
    
    slug = base_slug
    counter = 1
    
    while True:
        query = select(Post).where(Post.slug == slug)
        if post_id:
            query = query.where(Post.id != post_id)
        result = await db.execute(query)
        if not result.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    return slug


async def create_post(
    db: AsyncSession, post_in: PostCreate, author_id: int
) -> Post:
    """创建文章"""
    slug = await generate_unique_slug(db, post_in.title)
    
    post = Post(
        title=post_in.title,
        slug=slug,
        content=post_in.content,
        summary=post_in.summary,
        cover_image=post_in.cover_image,
        is_published=post_in.is_published,
        author_id=author_id,
    )
    
    # 添加标签
    if post_in.tag_ids:
        result = await db.execute(
            select(Tag).where(Tag.id.in_(post_in.tag_ids))
        )
        tags = result.scalars().all()
        post.tags = list(tags)
    
    db.add(post)
    await db.flush()
    await db.refresh(post)
    return post


async def update_post(
    db: AsyncSession, post: Post, post_in: PostUpdate
) -> Post:
    """更新文章"""
    update_data = post_in.model_dump(exclude_unset=True, exclude={"tag_ids"})
    
    # Slugs are permanent public permalinks; changing a title must not break links.
    for field, value in update_data.items():
        setattr(post, field, value)
    
    # 更新标签
    if post_in.tag_ids is not None:
        result = await db.execute(
            select(Tag).where(Tag.id.in_(post_in.tag_ids))
        )
        tags = result.scalars().all()
        post.tags = list(tags)
    
    await db.flush()
    await db.refresh(post)
    return post


async def delete_post(db: AsyncSession, post: Post) -> None:
    """删除文章"""
    await db.delete(post)
    await db.flush()


async def increment_view_count(db: AsyncSession, post: Post) -> None:
    """增加浏览次数"""
    post.view_count += 1
    await db.flush()


async def search_posts(
    db: AsyncSession,
    keyword: str,
    page: int = 1,
    page_size: int = 10
) -> Tuple[List[Post], int]:
    """搜索已发布文章，按字段相关度稳定排序。"""
    normalized_keyword = " ".join(unicodedata.normalize("NFKC", keyword).split())
    if not normalized_keyword or len(normalized_keyword) > 120:
        return [], 0

    words = normalized_keyword.split(" ")
    if len(words) > 8:
        return [], 0
    # ILIKE folds both operands using the database's rules. Python casefold
    # alone would make even identical Unicode text unmatchable on SQLite.
    tokens = list(dict.fromkeys(words))

    def escape_like(value: str) -> str:
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    token_matches = []
    title_matches = []
    tag_matches = []
    summary_matches = []
    content_matches = []
    for token in tokens:
        pattern = f"%{escape_like(token)}%"
        title_match = Post.title.ilike(pattern, escape="\\")
        tag_match = Post.tags.any(Tag.name.ilike(pattern, escape="\\"))
        summary_match = Post.summary.ilike(pattern, escape="\\")
        content_match = Post.content.ilike(pattern, escape="\\")
        token_matches.append(or_(title_match, tag_match, summary_match, content_match))
        title_matches.append(title_match)
        tag_matches.append(tag_match)
        summary_matches.append(summary_match)
        content_matches.append(content_match)

    match_conditions = [Post.is_published == True, *token_matches]
    relevance = case(
        (or_(*title_matches), 4),
        (or_(*tag_matches), 3),
        (or_(*summary_matches), 2),
        (or_(*content_matches), 1),
        else_=0,
    )
    query = select(Post).options(
        selectinload(Post.author),
        selectinload(Post.tags)
    ).where(*match_conditions).order_by(
        relevance.desc(),
        Post.created_at.desc(),
        Post.id.desc(),
    )

    count_query = select(func.count(Post.id)).where(*match_conditions)
    
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    result = await db.execute(query)
    posts = result.scalars().all()
    
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    
    return list(posts), total
