import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_admin_articles_unifies_posts_and_notion_documents_with_shared_metadata(
    client, db_session, admin_token
):
    from app.models import Comment, NotionDocument, NotionSource, Post, Tag, User

    admin = await db_session.scalar(select(User).where(User.username == "admin"))
    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记和文档",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    tag = Tag(name="技术", slug="tech")
    post = Post(
        title="手写文章",
        slug="manual-post",
        content="正文",
        is_published=True,
        author_id=admin.id,
        tags=[tag],
    )
    db_session.add_all([source, post])
    await db_session.flush()
    db_session.add(Comment(content="一条评论", post_id=post.id, user_id=admin.id))
    db_session.add(NotionDocument(
        source_id=source.id,
        data_source_id=source.data_source_ids[0],
        notion_page_id="11111111-1111-1111-1111-111111111111",
        slug="notion-post",
        title="Notion 文章",
        summary="Notion 摘要",
        content="Notion 正文",
        categories=["随笔", "技术"],
        status="published",
        author_id=admin.id,
        view_count=7,
    ))
    await db_session.commit()

    response = await client.get(
        "/api/v1/admin/articles",
        params={"page": 1, "page_size": 50},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    rows = {row["kind"]: row for row in payload["items"]}
    assert rows["post"]["author"]["username"] == "admin"
    assert rows["post"]["tags"] == ["技术"]
    assert rows["post"]["comment_count"] == 1
    assert rows["post"]["public_url"] == "/post/manual-post"
    assert rows["notion"]["author"]["username"] == "admin"
    assert rows["notion"]["tags"] == ["随笔", "技术"]
    assert rows["notion"]["comment_count"] == 0
    assert rows["notion"]["view_count"] == 7
    assert rows["notion"]["public_url"] == "/documents/notion-post"
    assert rows["notion"]["external_url"].endswith("11111111111111111111111111111111")


@pytest.mark.asyncio
async def test_admin_article_unpublish_hides_notion_document_and_is_idempotent(
    client, db_session, admin_token
):
    from app.models import NotionDocument, NotionSource

    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记和文档",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    db_session.add(source)
    await db_session.flush()
    document = NotionDocument(
        source_id=source.id,
        data_source_id=source.data_source_ids[0],
        notion_page_id="11111111-1111-1111-1111-111111111111",
        slug="notion-post",
        title="Notion 文章",
        content="正文",
        categories=[],
        status="published",
    )
    db_session.add(document)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {admin_token}"}
    response = await client.post(f"/api/v1/admin/articles/notion/{document.id}/unpublish", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "archived"
    assert response.json()["is_published"] is False
    assert response.json()["public_url"] == "/documents/notion-post"

    assert (await client.get("/api/v1/documents/notion-post")).status_code == 404
    again = await client.post(f"/api/v1/admin/articles/notion/{document.id}/unpublish", headers=headers)
    assert again.status_code == 200
    assert again.json()["status"] == "archived"


@pytest.mark.asyncio
async def test_admin_articles_deduplicate_legacy_notion_post(
    client, db_session, admin_token
):
    from app.models import NotionDocument, NotionPage, NotionSource, Post, User

    admin = await db_session.scalar(select(User).where(User.username == "admin"))
    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记和文档",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    db_session.add(source)
    await db_session.flush()
    legacy_post = Post(
        title="同一篇文章",
        slug="same-notion-page",
        content="旧版同步正文",
        is_published=False,
        author_id=admin.id,
    )
    db_session.add(legacy_post)
    await db_session.flush()
    db_session.add(NotionPage(
        notion_page_id="11111111-1111-1111-1111-111111111111",
        post_id=legacy_post.id,
        source_title="同一篇文章",
    ))
    db_session.add(NotionDocument(
        source_id=source.id,
        data_source_id=source.data_source_ids[0],
        notion_page_id="11111111-1111-1111-1111-111111111111",
        legacy_post_slug=legacy_post.slug,
        slug="same-notion-page",
        title="同一篇文章",
        content="新版资料库正文",
        categories=["随笔"],
        status="published",
        author_id=admin.id,
    ))
    await db_session.commit()

    response = await client.get(
        "/api/v1/admin/articles",
        params={"page": 1, "page_size": 50},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert [(row["kind"], row["slug"]) for row in payload["items"]] == [
        ("notion", "same-notion-page")
    ]
