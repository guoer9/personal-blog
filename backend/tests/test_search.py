from datetime import datetime

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.crud.post import search_posts
from app.models import Post, Tag, User


@pytest_asyncio.fixture
async def add_post(db_session: AsyncSession):
    author = User(
        username="search-author",
        email="search@example.com",
        hashed_password="unused",
        is_admin=True,
        is_active=True,
    )
    db_session.add(author)
    await db_session.flush()
    sequence = 0

    async def add(**changes):
        nonlocal sequence
        sequence += 1
        post = Post(
            **{
                "title": "Unrelated title",
                "slug": f"search-post-{sequence}",
                "summary": None,
                "content": "Unrelated content",
                "is_published": True,
                "author_id": author.id,
                "created_at": datetime(2026, 1, 1),
                "tags": [],
                **changes,
            }
        )
        db_session.add(post)
        await db_session.commit()
        return post

    return add


@pytest.mark.parametrize(
    "keyword",
    ["  ＰＹＴＨＯＮ\u3000\nＣＡＣＨＥ\t ", "PYTHON cache", "python\tcache", "python cache python", "  python" + " " * 190 + "cache"],
)
async def test_normalizes_query_and_matches_all_words_across_fields(db_session, add_post, keyword):
    match = await add_post(title="Python notes", summary="A cache guide")
    await add_post(title="Python only")
    await add_post(content="cache only")

    posts, total = await search_posts(db_session, keyword)

    assert [post.id for post in posts] == [match.id]
    assert total == 1


@pytest.mark.parametrize("text", ["Straße", "ÉCOLE", "中文搜索"])
async def test_keeps_identical_unicode_search_text_matchable(db_session, add_post, text):
    match = await add_post(title=text)

    posts, total = await search_posts(db_session, text)

    assert [post.id for post in posts] == [match.id]
    assert total == 1


async def test_requires_every_word_across_title_tag_summary_and_body(db_session, add_post):
    match = await add_post(
        title="Python guide",
        tags=[Tag(name="Async IO", slug="not-the-search-name")],
        summary="Cache notes",
        content="An eviction example",
    )
    await add_post(title="python cache eviction", content="No matching tag")

    posts, total = await search_posts(db_session, "PYTHON async cache eviction")

    assert [post.id for post in posts] == [match.id]
    assert total == 1
    assert await search_posts(db_session, "not-the-search-name") == ([], 0)


@pytest.mark.parametrize("field", ["title", "summary", "content", "tag"])
@pytest.mark.parametrize("literal,decoy", [("100%", "1000"), ("cache_key", "cacheXkey"), ("wow!", "wow"), (r"path\file", "pathfile")])
async def test_treats_like_metacharacters_as_literal_text(db_session, add_post, field, literal, decoy):
    if field == "tag":
        match = await add_post(tags=[Tag(name=literal, slug="literal")])
        await add_post(tags=[Tag(name=decoy, slug="decoy")])
    else:
        match = await add_post(**{field: literal})
        await add_post(**{field: decoy})

    posts, total = await search_posts(db_session, literal)

    assert [post.id for post in posts] == [match.id]
    assert total == 1


async def test_ranks_title_then_tag_then_summary_then_body_before_recency(db_session, add_post):
    body = await add_post(content="needle", created_at=datetime(2026, 5, 1))
    summary = await add_post(summary="needle", created_at=datetime(2026, 4, 1))
    tag = await add_post(tags=[Tag(name="Needle", slug="needle")], created_at=datetime(2026, 3, 1))
    title = await add_post(title="Needle", created_at=datetime(2026, 2, 1))
    await add_post(title="Needle draft", is_published=False)

    posts, total = await search_posts(db_session, "needle")

    assert [post.id for post in posts] == [title.id, tag.id, summary.id, body.id]
    assert total == 4


async def test_one_title_hit_outranks_many_lower_priority_hits(db_session, add_post):
    lower = await add_post(summary="alpha beta gamma", content="alpha beta gamma")
    higher = await add_post(title="alpha", content="beta gamma")

    posts, total = await search_posts(db_session, "alpha beta gamma")

    assert [post.id for post in posts] == [higher.id, lower.id]
    assert total == 2


async def test_paginates_unique_articles_with_date_and_id_tiebreaks(db_session, add_post):
    old = await add_post(tags=[Tag(name="needle one", slug="one"), Tag(name="needle two", slug="two")])
    first = await add_post(tags=[Tag(name="needle three", slug="three")], created_at=datetime(2026, 2, 1))
    last = await add_post(tags=[Tag(name="needle four", slug="four")], created_at=datetime(2026, 2, 1))

    pages = [await search_posts(db_session, "needle", page=page, page_size=1) for page in range(1, 5)]

    assert [[post.id for post in posts] for posts, _ in pages] == [[last.id], [first.id], [old.id], []]
    assert [total for _, total in pages] == [3, 3, 3, 3]


@pytest.mark.parametrize("keyword", ["", " \n\t\u3000 ", "x" * 121, "\ufdfa" * 20, "a b c d e f g h i", "a A a A a A a A a"])
async def test_empty_or_over_limit_queries_do_not_broaden_into_a_listing(db_session, add_post, keyword):
    await add_post(title=keyword or "An article", content="a b c d e f g h i")

    assert await search_posts(db_session, keyword) == ([], 0)


async def test_accepts_queries_at_character_and_word_limits(db_session, add_post):
    character_match = await add_post(content="x" * 120)
    word_match = await add_post(content="a b c d e f g h")

    assert [post.id for post in (await search_posts(db_session, "x" * 120))[0]] == [character_match.id]
    assert [post.id for post in (await search_posts(db_session, "a b c d e f g h"))[0]] == [word_match.id]


@pytest.mark.parametrize("authenticated", [False, True])
async def test_search_api_never_exposes_drafts_or_counts_them(client: httpx.AsyncClient, add_post, authenticated):
    public = await add_post(title="public", tags=[Tag(name="privateword", slug="public-tag")])
    await add_post(title="privateword draft", content="privateword", is_published=False)
    headers = {"Authorization": f"Bearer {create_access_token(public.author_id)}"} if authenticated else {}

    response = await client.get("/api/v1/posts/search", params={"q": "privateword"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert [post["id"] for post in response.json()["items"]] == [public.id]


async def test_search_statements_compile_for_sqlite_and_postgresql(db_session, add_post):
    await add_post(title="literal 100%", tags=[Tag(name="cache_key", slug="cache")])
    statements = []

    def capture(state):
        if not state.is_relationship_load:
            statements.append(state.statement)

    event.listen(db_session.sync_session, "do_orm_execute", capture)
    try:
        posts, total = await search_posts(db_session, "100% cache_key")
    finally:
        event.remove(db_session.sync_session, "do_orm_execute", capture)

    assert len(posts) == total == 1
    assert len(statements) == 2
    for dialect in (sqlite.dialect(), postgresql.dialect()):
        for statement in statements:
            statement.compile(dialect=dialect)
