from datetime import datetime, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_public_documents_filter_published_sources_categories_and_query(client, db_session):
    from app.models import NotionDocument, NotionSource

    journal = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    deployment = NotionSource(
        connection_id="deployment",
        database_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        data_source_ids=["dddddddd-dddd-dddd-dddd-dddddddddddd"],
        title="部署",
        source_url="https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )
    db_session.add_all([journal, deployment])
    await db_session.flush()
    db_session.add_all([
        NotionDocument(
            source_id=journal.id,
            data_source_id=journal.data_source_ids[0],
            notion_page_id="11111111-1111-1111-1111-111111111111",
            slug="safe-note",
            title="安全部署手册",
            summary="部署摘要",
            content="包含 nginx 和 systemd",
            categories=["部署"],
            status="published",
            created_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        ),
        NotionDocument(
            source_id=deployment.id,
            data_source_id=deployment.data_source_ids[0],
            notion_page_id="22222222-2222-2222-2222-222222222222",
            slug="isolated-note",
            title="私密配置",
            content="不应公开",
            categories=["配置"],
            status="isolated",
        ),
        NotionDocument(
            source_id=journal.id,
            data_source_id=journal.data_source_ids[0],
            notion_page_id="33333333-3333-3333-3333-333333333333",
            slug="another-note",
            title="随笔",
            content="日记正文",
            categories=["随笔"],
            status="published",
        ),
    ])
    await db_session.commit()

    all_documents = await client.get("/api/v1/documents")
    assert all_documents.status_code == 200
    assert all_documents.json()["total"] == 2
    assert {item["slug"] for item in all_documents.json()["items"]} == {"safe-note", "another-note"}

    filtered = await client.get("/api/v1/documents", params={"category": "部署", "q": "nginx", "source_id": journal.id})
    assert filtered.status_code == 200
    assert [item["slug"] for item in filtered.json()["items"]] == ["safe-note"]


@pytest.mark.asyncio
async def test_public_document_detail_and_legacy_post_redirect(client, db_session):
    from app.models import NotionDocument, NotionSource

    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    db_session.add(source)
    await db_session.flush()
    db_session.add(NotionDocument(
        source_id=source.id,
        data_source_id=source.data_source_ids[0],
        notion_page_id="11111111-1111-1111-1111-111111111111",
        slug="safe-note",
        legacy_post_slug="old-notion-slug",
        title="安全部署手册",
        content="# 正文",
        categories=["部署"],
        status="published",
    ))
    await db_session.commit()

    detail = await client.get("/api/v1/documents/safe-note")
    assert detail.status_code == 200
    assert detail.json()["content"] == "# 正文"

    legacy = await client.get("/api/v1/posts/old-notion-slug", follow_redirects=False)
    assert legacy.status_code in (301, 302, 307, 308)
    assert legacy.headers["location"].endswith("/api/v1/documents/safe-note")

    canonical_alias = await client.get("/api/v1/posts/safe-note", follow_redirects=False)
    assert canonical_alias.status_code in (301, 302, 307, 308)
    assert canonical_alias.headers["location"].endswith("/api/v1/documents/safe-note")

    missing = await client.get("/api/v1/documents/does-not-exist")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_notion_document_comments_are_supported_and_counted(
    client, db_session, admin_token
):
    from app.models import NotionDocument, NotionSource, User

    admin = await db_session.scalar(select(User).where(User.username == "admin"))
    source = NotionSource(
        connection_id="journal",
        database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
        title="日记",
        source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    db_session.add(source)
    await db_session.flush()
    document = NotionDocument(
        source_id=source.id,
        data_source_id=source.data_source_ids[0],
        notion_page_id="11111111-1111-1111-1111-111111111111",
        slug="commentable-note",
        title="可评论资料",
        content="正文",
        categories=["随笔"],
        status="published",
    )
    db_session.add(document)
    await db_session.commit()
    await db_session.refresh(document)

    headers = {"Authorization": f"Bearer {admin_token}"}
    created = await client.post(
        "/api/v1/comments",
        json={"notion_document_id": document.id, "content": "资料评论"},
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["notion_document_id"] == document.id
    assert created.json()["post_id"] is None

    comments = await client.get(f"/api/v1/comments/notion/{document.id}")
    assert comments.status_code == 200
    assert [item["content"] for item in comments.json()] == ["资料评论"]

    articles = await client.get(
        "/api/v1/admin/articles",
        headers=headers,
    )
    assert articles.status_code == 200
    notion_row = next(item for item in articles.json()["items"] if item["kind"] == "notion")
    assert notion_row["comment_count"] == 1
    detail = await client.get("/api/v1/documents/commentable-note")
    assert detail.json()["id"] == document.id
    assert detail.json()["comment_count"] == 1
    assert detail.json()["view_count"] == 1
    assert detail.json()["categories"] == ["随笔"]
    again = await client.get("/api/v1/documents/commentable-note")
    assert again.json()["view_count"] == 2
    assert again.json()["updated_at"] == detail.json()["updated_at"]


@pytest.mark.asyncio
async def test_media_is_public_only_while_referenced_by_a_published_document(client, db_session, tmp_path, monkeypatch):
    from app.core.config import settings
    from app.models import NotionDocument, NotionSource
    from app.services.notion_content import media_directory

    monkeypatch.setattr(settings, 'PRIVATE_STORAGE_DIR', str(tmp_path))
    page_id = '11111111-1111-1111-1111-111111111111'
    asset = 'a' * 64 + '.png'
    unused = 'b' * 64 + '.png'
    target = f'/api/v1/documents/media/{page_id}/{asset}'
    folder = media_directory(page_id)
    (folder / asset).write_bytes(b'\x89PNG\r\n\x1a\npreview-image')
    (folder / unused).write_bytes(b'unreferenced')
    assert (await client.get(target)).status_code == 404

    source = NotionSource(connection_id='test', database_id=page_id, data_source_ids=[], title='测试', source_url=f'https://notion.so/{page_id}')
    db_session.add(source)
    await db_session.flush()
    document = NotionDocument(source_id=source.id, notion_page_id=page_id, slug='media-note', title='图片资料', content='正文', categories=[], status='published', content_blocks=[{'id': 'nested', 'type': 'toggle', 'children': [{'id': 'image', 'type': 'image', 'url': target}]}])
    db_session.add(document)
    await db_session.commit()
    response = await client.get(target)
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/png'
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert (await client.get(f'/api/v1/documents/media/{page_id}/{unused}')).status_code == 404

    for status in ('isolated', 'archived'):
        document.status = status
        await db_session.commit()
        assert (await client.get(target)).status_code == 404
    document.status = 'published'
    document.content_blocks = []
    document.cover_url = target
    await db_session.commit()
    assert (await client.get(target)).status_code == 200
    document.cover_url = None
    await db_session.commit()
    assert (await client.get(target)).status_code == 404
