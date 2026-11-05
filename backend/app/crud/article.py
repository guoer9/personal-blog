"""One public index; each article keeps its original body and discussion target."""

from hashlib import sha256

from slugify import slugify
from sqlalchemy import func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, raiseload, selectinload

from app.models.notion import NotionPage
from app.models.notion_library import NotionDocument
from app.models.post import Post, Tag
from app.services.article_search import literal_pattern, search_expressions, search_tokens


async def get_article_by_slug(db: AsyncSession, slug: str) -> Post | NotionDocument | None:
    """Resolve identity before checking visibility, so stale copies stay hidden."""
    post = await db.scalar(select(Post).where(Post.slug == slug).options(
        selectinload(Post.author), selectinload(Post.tags), selectinload(Post.comments),
    ))
    document_query = select(NotionDocument).options(
        selectinload(NotionDocument.author), selectinload(NotionDocument.comments),
    )
    if post is not None:
        document = await db.scalar(document_query.join(
            NotionPage, NotionDocument.notion_page_id == NotionPage.notion_page_id,
        ).where(NotionPage.post_id == post.id))
        # A reused legacy slug alone is not proof this manual article migrated.
        return document if document is not None else post
    document = await db.scalar(document_query.where(NotionDocument.slug == slug))
    if document is None:
        document = await db.scalar(document_query.where(NotionDocument.legacy_post_slug == slug))
    return document


def public_document_conditions():
    return (NotionDocument.status == "published", NotionDocument.manual_unpublished.is_(False))


def public_post_conditions():
    # A migrated page's current visibility is authoritative, even if an old
    # posts row was left published. Never resurrect its stale body in the index.
    # Only the source-page mapping establishes identity. A legacy URL alone
    # must not hide an unrelated post that already reused that slug.
    migrated = Post.id.in_(select(NotionPage.post_id).join(
        NotionDocument, NotionDocument.notion_page_id == NotionPage.notion_page_id,
    ))
    return (Post.is_published.is_(True), ~migrated)


def category_slug(name: str, tag_slugs: dict[str, str]) -> str:
    if name in tag_slugs:
        return tag_slugs[name]
    # Categories have no persistent Tag ID. A stable suffix avoids conflating
    # distinct category names that slugify to the same value.
    base = slugify(name, allow_unicode=True) or "topic"
    candidate = f"notion-{base}-{sha256(name.encode()).hexdigest()[:12]}"
    reserved = set(tag_slugs.values())
    while candidate in reserved:
        candidate = f"notion-{candidate}"
    return candidate


async def _tag_slugs(db: AsyncSession) -> dict[str, str]:
    return dict((await db.execute(select(Tag.name, Tag.slug))).all())


async def _document_categories(db: AsyncSession):
    # Read only small category metadata, never every Notion body/blocks. This
    # keeps JSON category matching portable between PostgreSQL and SQLite.
    return (await db.execute(
        select(NotionDocument.id, NotionDocument.categories).where(*public_document_conditions())
    )).all()


async def get_public_article_tags(db: AsyncSession) -> list[dict]:
    tag_slugs = await _tag_slugs(db)
    names = set((await db.scalars(
        select(Tag.name).join(Post.tags).where(*public_post_conditions()).distinct()
    )).all())
    for _, categories in await _document_categories(db):
        names.update(categories or [])
    return [{"name": name, "slug": category_slug(name, tag_slugs)} for name in sorted(names)]


async def get_public_articles(
    db: AsyncSession, page: int = 1, page_size: int = 10,
    *, tag_slug: str | None = None, keyword: str | None = None,
) -> tuple[list[dict], int]:
    tokens = search_tokens(keyword) if keyword is not None else []
    if keyword is not None and not tokens:
        return [], 0

    tag_slugs = await _tag_slugs(db)
    categories = await _document_categories(db) if tag_slug or tokens else []
    post_conditions = list(public_post_conditions())
    document_conditions = list(public_document_conditions())
    post_relevance = document_relevance = literal(0)

    if tag_slug:
        topic_names = set(tag_slugs)
        topic_names.update(name for _, names in categories for name in names or [])
        matching_names = {
            name for name in topic_names
            if tag_slug in {category_slug(name, tag_slugs), category_slug(name, {})}
        }
        # Keep a category's original deterministic URL valid if a matching
        # real tag is later created, even after the last document is hidden.
        post_conditions.append(Post.tags.any(or_(Tag.slug == tag_slug, Tag.name.in_(matching_names))))
        document_conditions.append(NotionDocument.id.in_([
            document_id for document_id, names in categories
            if matching_names.intersection(names or [])
        ]))

    if tokens:
        matches, post_relevance = search_expressions(
            tokens, title=Post.title, summary=Post.summary, content=Post.content,
            tag_matches=[Post.tags.any(Tag.name.ilike(literal_pattern(token), escape="\\")) for token in tokens],
        )
        post_conditions.extend(matches)
        matches, document_relevance = search_expressions(
            tokens, title=NotionDocument.title, summary=NotionDocument.summary, content=NotionDocument.content,
            tag_matches=[NotionDocument.id.in_([
                document_id for document_id, names in categories
                if any(token.casefold() in name.casefold() for name in names or [])
            ]) for token in tokens],
        )
        document_conditions.extend(matches)

    index = union_all(
        select(Post.id.label("id"), literal("post").label("kind"),
               Post.created_at.label("created_at"), post_relevance.label("relevance"))
        .where(*post_conditions),
        select(NotionDocument.id, literal("notion"), NotionDocument.created_at, document_relevance)
        .where(*document_conditions),
    ).subquery()
    total = await db.scalar(select(func.count()).select_from(index))
    refs = (await db.execute(
        select(index.c.id, index.c.kind).order_by(
            index.c.relevance.desc(), index.c.created_at.desc(), index.c.id.desc(), index.c.kind.desc(),
        ).offset((page - 1) * page_size).limit(page_size)
    )).all()

    # Hydrate only the requested page, without loading bodies, block JSON or
    # comments. An ID is unique only within its source, hence the composite key.
    rows = {}
    post_ids = [ref.id for ref in refs if ref.kind == "post"]
    if post_ids:
        posts = (await db.scalars(select(Post).where(Post.id.in_(post_ids)).options(
            load_only(Post.id, Post.title, Post.slug, Post.summary, Post.cover_image, Post.view_count,
                      Post.author_id, Post.created_at, Post.updated_at),
            raiseload("*"), selectinload(Post.author), selectinload(Post.tags),
        ))).all()
        for post in posts:
            key = f"post:{post.id}"
            rows[key] = {
                "id": post.id, "key": key, "kind": "post", "title": post.title, "slug": post.slug,
                "summary": post.summary, "cover_image": post.cover_image, "is_published": True,
                "view_count": post.view_count or 0, "author": post.author,
                "tags": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
                "created_at": post.created_at, "updated_at": post.updated_at,
                "public_url": f"/documents/{post.slug}",
            }
    document_ids = [ref.id for ref in refs if ref.kind == "notion"]
    if document_ids:
        documents = (await db.scalars(select(NotionDocument).where(NotionDocument.id.in_(document_ids)).options(
            load_only(NotionDocument.id, NotionDocument.title, NotionDocument.slug, NotionDocument.summary,
                      NotionDocument.cover_url, NotionDocument.view_count, NotionDocument.author_id,
                      NotionDocument.categories, NotionDocument.created_at, NotionDocument.updated_at),
            raiseload("*"), selectinload(NotionDocument.author),
        ))).all()
        for document in documents:
            key = f"notion:{document.id}"
            rows[key] = {
                "id": document.id, "key": key, "kind": "notion", "title": document.title, "slug": document.slug,
                "summary": document.summary, "cover_image": document.cover_url, "is_published": True,
                "view_count": document.view_count or 0, "author": document.author,
                "tags": [{"name": name, "slug": category_slug(name, tag_slugs)} for name in document.categories or []],
                "created_at": document.created_at, "updated_at": document.updated_at,
                "public_url": f"/documents/{document.slug}",
            }
    return [rows[f"{ref.kind}:{ref.id}"] for ref in refs], total
