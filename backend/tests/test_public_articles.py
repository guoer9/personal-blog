"""The archive and library must expose the same Notion article identities."""

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import Comment, NotionDocument, NotionPage, NotionSource, Post, Tag, User


@pytest_asyncio.fixture
async def articles(db_session, admin_token):
    author = await db_session.scalar(select(User).where(User.username == "admin"))
    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title="文章资料库",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    db_session.add(source)
    await db_session.flush()
    sequence = 0

    async def add(kind="notion", **changes):
        nonlocal sequence
        sequence += 1
        shared = dict(
            title=f"Article {sequence}", slug=f"article-{sequence}",
            content="正文", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        if kind == "post":
            shared["created_at"] = shared["created_at"].replace(tzinfo=None)
            article = Post(**{
                **shared, "author_id": author.id, "is_published": True, "tags": [], **changes,
            })
        else:
            article = NotionDocument(**{
                **shared, "source_id": source.id, "notion_page_id": f"{sequence:08x}-1111-1111-1111-111111111111",
                "status": "published", "categories": [], **changes,
            })
        db_session.add(article)
        await db_session.commit()
        return article

    return add


async def test_public_archive_includes_library_articles_without_exposing_hidden_content(
    client, articles, admin_token,
):
    manual = await articles("post", title="手写文章")
    imported = await articles(title="Notion 文章", categories=["随笔"], view_count=7)
    await articles("post", is_published=False, title="草稿")
    await articles(status="isolated", title="隔离")
    await articles(status="archived", title="归档")
    await articles(manual_unpublished=True, title="管理员隐藏")

    for headers in ({}, {"Authorization": f"Bearer {admin_token}"}):
        response = await client.get("/api/v1/posts", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 2
        assert {row["key"] for row in payload["items"]} == {
            f"post:{manual.id}", f"notion:{imported.id}",
        }
        notion = next(row for row in payload["items"] if row["kind"] == "notion")
        library = (await client.get("/api/v1/documents")).json()["items"][0]
        assert notion["public_url"] == library["public_url"] == f"/documents/{imported.slug}"
        assert notion["id"] == library["id"]
        assert notion["view_count"] == 7
        assert notion["author"] is None
        assert [tag["name"] for tag in notion["tags"]] == ["随笔"]
        assert "content" not in notion
        assert "content_blocks" not in notion


async def test_archive_paginates_after_merging_sources_with_stable_ties(client, articles):
    old = await articles("post")
    newest = await articles(created_at=datetime(2026, 3, 1, tzinfo=timezone.utc))
    await articles("post", created_at=datetime(2026, 2, 1))
    await articles(created_at=datetime(2026, 2, 1, tzinfo=timezone.utc))

    first = (await client.get("/api/v1/posts", params={"page_size": 50})).json()
    expected = [row["key"] for row in first["items"]]
    assert expected[0] == f"notion:{newest.id}"
    assert expected[-1] == f"post:{old.id}"
    pages = [(await client.get("/api/v1/posts", params={"page": page, "page_size": 1})).json()
             for page in range(1, 6)]
    assert [row["key"] for page in pages for row in page["items"]] == expected
    assert all(page["total"] == 4 and page["total_pages"] == 4 for page in pages)


@pytest.mark.parametrize("published", [True, False])
async def test_migrated_notion_article_is_never_duplicated_or_resurrected(
    client, db_session, articles, published,
):
    legacy = await articles("post", title="Migration needle", slug="legacy", is_published=True)
    document = await articles(
        title="Migration needle", slug="canonical", legacy_post_slug="legacy",
        status="published" if published else "archived",
    )
    db_session.add(NotionPage(notion_page_id=document.notion_page_id, post_id=legacy.id, source_title=legacy.title))
    db_session.add(Comment(content="共享评论", notion_document_id=document.id, user_id=legacy.author_id))
    await db_session.commit()

    for endpoint, params in (("/api/v1/posts", {}), ("/api/v1/posts/search", {"q": "needle"})):
        payload = (await client.get(endpoint, params=params)).json()
        assert payload["total"] == int(published)
        if published:
            assert payload["items"][0]["key"] == f"notion:{document.id}"

    old_link = await client.get("/api/v1/posts/legacy", follow_redirects=False)
    if not published:
        assert old_link.status_code == 404
        return
    assert old_link.status_code == 307
    assert old_link.headers["location"] == "/api/v1/documents/canonical"
    detail = (await client.get(old_link.headers["location"])).json()
    assert detail["id"] == document.id
    assert detail["comment_count"] == 1
    assert detail["view_count"] == 1


async def test_unified_search_ranks_fields_across_sources_before_recency(client, articles):
    body = await articles("post", content="needle", created_at=datetime(2026, 5, 1))
    summary = await articles(summary="Needle", created_at=datetime(2026, 4, 1, tzinfo=timezone.utc))
    category = await articles(categories=["needle"], created_at=datetime(2026, 3, 1, tzinfo=timezone.utc))
    title = await articles("post", title="Needle", created_at=datetime(2026, 2, 1))
    await articles(title="Needle secret", manual_unpublished=True)
    expected = [f"post:{title.id}", f"notion:{category.id}", f"notion:{summary.id}", f"post:{body.id}"]
    pages = [(await client.get("/api/v1/posts/search", params={"q": "needle", "page": page, "page_size": 1})).json()
             for page in range(1, 6)]
    assert [row["key"] for page in pages for row in page["items"]] == expected
    assert all(page["total"] == 4 for page in pages)


@pytest.mark.parametrize("keyword", ["ＰＹＴＨＯＮ　技术 cache 100%", "python 技术 cache 100%"])
async def test_notion_search_matches_all_tokens_and_literal_wildcards(client, articles, keyword):
    match = await articles(title="Python", categories=["技术"], summary="cache", content="100% cache_key")
    await articles(title="Python", categories=["技术"], summary="cache", content="1000 cacheXkey")
    payload = (await client.get("/api/v1/posts/search", params={"q": keyword})).json()
    assert payload["total"] == 1
    assert payload["items"][0]["key"] == f"notion:{match.id}"
    for query, count in (("cache_key", 1), (" ", 0), ("a b c d e f g h i", 0)):
        assert (await client.get("/api/v1/posts/search", params={"q": query})).json()["total"] == count


async def test_public_topics_and_tag_lists_share_notion_categories(client, db_session, articles):
    tag = Tag(name="技术", slug="tech")
    manual = await articles("post", tags=[tag])
    imported = await articles(categories=["技术", "随笔"])
    await articles(categories=["私密分类"], manual_unpublished=True)
    topics_response = await client.get("/api/v1/posts/topics/list")
    assert topics_response.status_code == 200
    topics = {topic["name"]: topic for topic in topics_response.json()}
    assert set(topics) == {"技术", "随笔"}
    assert topics["技术"]["slug"] == "tech"
    shared = (await client.get("/api/v1/posts", params={"tag": "tech"})).json()
    assert {row["key"] for row in shared["items"]} == {f"post:{manual.id}", f"notion:{imported.id}"}
    category = (await client.get("/api/v1/posts", params={"tag": topics["随笔"]["slug"]})).json()
    assert category["total"] == 1
    assert category["items"][0]["key"] == f"notion:{imported.id}"
    # The administrator's tag picker still receives real database tag IDs only.
    assert [row["id"] for row in (await client.get("/api/v1/tags")).json()] == [tag.id]


async def test_creating_post_reserves_deleted_legacy_permalink(client, articles, admin_token):
    document = await articles(title="Original", legacy_post_slug="reserved-article")
    response = await client.post("/api/v1/posts", headers={"Authorization": f"Bearer {admin_token}"}, json={
        "title": "Reserved article", "content": "New article body", "is_published": True,
    })
    assert response.status_code == 201
    created = response.json()
    assert created["slug"] == "reserved-article-1"
    assert (await client.get(f'/api/v1/posts/{created["slug"]}')).json()["id"] == created["id"]
    old = await client.get("/api/v1/posts/reserved-article", follow_redirects=False)
    assert old.status_code == 307
    assert old.headers["location"] == f"/api/v1/documents/{document.slug}"


@pytest.mark.parametrize("published", [True, False])
async def test_unmapped_existing_slug_collision_keeps_manual_article_visible(client, articles, published):
    await articles(legacy_post_slug="reused", status="published" if published else "archived")
    manual = await articles("post", slug="reused", title="New manual article", content="Unrelated body")
    for endpoint, params in (("/api/v1/posts", {}), ("/api/v1/posts/search", {"q": "manual"})):
        payload = (await client.get(endpoint, params=params)).json()
        assert f"post:{manual.id}" in {row["key"] for row in payload["items"]}
    detail = await client.get("/api/v1/posts/reused", follow_redirects=False)
    assert detail.status_code == 200
    assert detail.json()["id"] == manual.id
    assert detail.json()["content"] == "Unrelated body"


async def test_existing_category_permalink_survives_matching_tag_creation(client, db_session, articles):
    document = await articles(categories=["随笔"])
    old_slug = (await client.get("/api/v1/posts/topics/list")).json()[0]["slug"]
    manual = await articles("post", tags=[Tag(name="随笔", slug="essays")])
    for slug in (old_slug, "essays"):
        payload = (await client.get("/api/v1/posts", params={"tag": slug})).json()
        assert {row["key"] for row in payload["items"]} == {f"post:{manual.id}", f"notion:{document.id}"}

    document.manual_unpublished = True
    await db_session.commit()
    for slug in (old_slug, "essays"):
        payload = (await client.get("/api/v1/posts", params={"tag": slug})).json()
        assert [row["key"] for row in payload["items"]] == [f"post:{manual.id}"]
    assert (await client.get("/api/v1/posts/topics/list")).json() == [{"name": "随笔", "slug": "essays"}]
