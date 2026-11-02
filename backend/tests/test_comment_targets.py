import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import NotionDocument, NotionSource, Post, User


@pytest_asyncio.fixture
async def targets(db_session, admin_token):
    admin = await db_session.scalar(select(User).where(User.username == "admin"))
    source = NotionSource(connection_id="test", database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                          title="资料", source_url="https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    post = Post(title="手动文章", slug="manual", content="正文", is_published=True, author_id=admin.id)
    db_session.add_all([source, post])
    await db_session.flush()
    document = NotionDocument(source_id=source.id, notion_page_id="11111111-1111-1111-1111-111111111111",
                              slug="note", title="资料", content="正文", categories=[], status="published")
    db_session.add(document)
    await db_session.commit()
    return post, document, {"Authorization": f"Bearer {admin_token}"}


@pytest.mark.asyncio
async def test_comments_require_exactly_one_target(client, targets):
    post, document, headers = targets
    for payload in ({}, {"post_id": post.id, "notion_document_id": document.id}):
        response = await client.post("/api/v1/comments", json={**payload, "content": "评论"}, headers=headers)
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_replies_cannot_cross_article_types_even_with_same_numeric_id(client, targets):
    post, document, headers = targets
    first = await client.post("/api/v1/comments", json={"post_id": post.id, "content": "普通文章评论"}, headers=headers)
    assert first.status_code == 201
    crossed = await client.post("/api/v1/comments", json={"notion_document_id": document.id,
                                "content": "错误回复", "parent_id": first.json()["id"]}, headers=headers)
    assert crossed.status_code == 400
    assert (await client.get(f"/api/v1/comments/notion/{document.id}")).json() == []


@pytest.mark.asyncio
async def test_notion_discussion_supports_nested_replies_and_cascading_delete(client, targets):
    _, document, headers = targets
    parent_id = None
    ids = []
    for text in ("评论", "回复", "嵌套回复"):
        response = await client.post("/api/v1/comments", json={"notion_document_id": document.id,
                                     "content": text, "parent_id": parent_id}, headers=headers)
        assert response.status_code == 201
        parent_id = response.json()["id"]
        ids.append(parent_id)
    tree = (await client.get(f"/api/v1/comments/notion/{document.id}")).json()
    assert tree[0]["replies"][0]["replies"][0]["content"] == "嵌套回复"
    assert (await client.delete(f"/api/v1/comments/{ids[0]}", headers=headers)).status_code == 204
    assert (await client.get(f"/api/v1/comments/notion/{document.id}")).json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["post", "notion"])
async def test_unpublished_comments_are_available_only_in_admin_management(client, targets, db_session, kind):
    post, document, headers = targets
    target = {"post_id": post.id} if kind == "post" else {"notion_document_id": document.id}
    article_id = post.id if kind == "post" else document.id
    created = await client.post("/api/v1/comments", json={**target, "content": "保留评论"}, headers=headers)
    assert created.status_code == 201
    if kind == "post":
        post.is_published = False
    else:
        document.status = "archived"
        document.manual_unpublished = True
    await db_session.commit()
    assert (await client.get(f"/api/v1/comments/{kind}/{article_id}")).status_code == 404
    assert (await client.post("/api/v1/comments", json={**target, "content": "隐藏后评论"}, headers=headers)).status_code == 404
    admin_url = f"/api/v1/admin/articles/{kind}/{article_id}/comments"
    assert (await client.get(admin_url)).status_code == 401
    managed = await client.get(admin_url, headers=headers)
    assert managed.status_code == 200
    assert managed.json()[0]["content"] == "保留评论"
