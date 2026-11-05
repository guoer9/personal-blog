from urllib.parse import quote

import httpx
from sqlalchemy import select

from app.models import NotionDocument, NotionSource, Post, User
from app.core.config import settings


async def test_public_routes_never_show_drafts_even_to_admin(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    draft = (await client.post("/api/v1/posts", headers=headers, json={
        "title": "Private diary", "content": "A private note", "is_published": False,
    })).json()
    for auth in ({}, headers):
        assert (await client.get("/api/v1/posts", headers=auth)).json()["total"] == 0
        assert (await client.get(f'/api/v1/posts/{draft["slug"]}', headers=auth)).status_code == 404
        assert (await client.get("/api/v1/posts/search", params={"q": "Private"}, headers=auth)).json()["total"] == 0
    assert (await client.get("/api/v1/posts/admin/list", headers=headers)).json()["total"] == 1
    assert (await client.get("/api/v1/posts/admin/list")).status_code == 401


async def test_title_edit_keeps_permalink_and_publication_can_be_withdrawn(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    created = await client.post("/api/v1/posts", headers=headers, json={
        "title": "A stable link", "content": "# Markdown\n\nArticle body.", "is_published": True,
    })
    assert created.status_code == 201
    post = created.json()
    updated = await client.put(f'/api/v1/posts/{post["id"]}', headers=headers, json={"title": "A new title"})
    assert updated.status_code == 200
    assert updated.json()["slug"] == post["slug"]
    assert (await client.get(f'/api/v1/posts/{post["slug"]}')).json()["title"] == "A new title"
    await client.put(f'/api/v1/posts/{post["id"]}', headers=headers, json={"is_published": False})
    assert (await client.get(f'/api/v1/posts/{post["slug"]}')).status_code == 404


async def test_post_url_redirects_to_same_slug_in_public_document_library(client, db_session):
    source = NotionSource(
        connection_id="primary",
        database_id="11111111-1111-1111-1111-111111111111",
        title="日记和文档",
        source_url="https://www.notion.so/11111111111111111111111111111111",
    )
    db_session.add(source)
    await db_session.flush()
    document = NotionDocument(
        source_id=source.id,
        notion_page_id="22222222-2222-2222-2222-222222222222",
        slug="镜像源配置以及docker",
        title="镜像源配置以及docker",
        content="Docker 配置正文",
        status="published",
    )
    db_session.add(document)
    await db_session.commit()

    response = await client.get(
        f"/api/v1/posts/{quote(document.slug, safe='')}",
        follow_redirects=False,
    )

    assert response.status_code == 307
    assert response.headers["location"] == f"/api/v1/documents/{quote(document.slug, safe='')}"

    canonical = await client.get(response.headers["location"])
    assert canonical.status_code == 200
    assert canonical.json()["content"] == "Docker 配置正文"


async def test_post_url_prefers_document_when_old_post_and_document_share_slug(client, db_session):
    admin = User(
        username="legacy-author",
        email="legacy-author@example.com",
        hashed_password="test-hash",
        is_admin=True,
        is_active=True,
    )
    db_session.add(admin)
    await db_session.flush()
    source = NotionSource(
        connection_id="primary",
        database_id="33333333-3333-3333-3333-333333333333",
        title="日记和文档",
        source_url="https://www.notion.so/33333333333333333333333333333333",
    )
    db_session.add(source)
    await db_session.flush()
    db_session.add_all([
        Post(
            title="旧 Docker 文章",
            slug="docker-mirror",
            content="旧副本",
            author_id=admin.id,
            is_published=True,
        ),
        NotionDocument(
            source_id=source.id,
            notion_page_id="44444444-4444-4444-4444-444444444444",
            slug="docker-mirror",
            title="Docker 镜像配置",
            content="资料库正文",
            status="published",
        ),
    ])
    await db_session.commit()

    response = await client.get("/api/v1/posts/docker-mirror", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/api/v1/documents/docker-mirror"


async def test_admin_can_publish_and_public_can_list_post(
    client: httpx.AsyncClient,
    admin_token: str,
):
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    create_response = await client.post(
        "/api/v1/posts",
        headers=admin_headers,
        json={
            "title": "Building a personal blog",
            "content": "A practical engineering note.",
            "summary": "A short note",
            "is_published": True,
        },
    )

    assert create_response.status_code == 201
    post = create_response.json()
    assert post["slug"] == "building-a-personal-blog"

    list_response = await client.get("/api/v1/posts")

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["slug"] == post["slug"]


async def test_non_admin_cannot_update_post(
    client: httpx.AsyncClient,
    admin_token: str,
    monkeypatch,
):
    monkeypatch.setitem(settings.__dict__, "REGISTRATION_PHRASE", "测试验证短语")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    create_response = await client.post(
        "/api/v1/posts",
        headers=admin_headers,
        json={
            "title": "Draft post",
            "content": "Draft content",
            "is_published": False,
        },
    )
    assert create_response.status_code == 201
    post_id = create_response.json()["id"]

    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "username": "reader",
            "email": "reader@example.com",
            "password": "reader-password",
            "verification_phrase": "测试验证短语",
        },
    )
    assert register_response.status_code == 201
    login_response = await client.post(
        "/api/v1/auth/login/json",
        json={"username": "reader", "password": "reader-password"},
    )
    reader_token = login_response.json()["access_token"]

    update_response = await client.put(
        f"/api/v1/posts/{post_id}",
        headers={"Authorization": f"Bearer {reader_token}"},
        json={"is_published": True},
    )

    assert update_response.status_code == 403

    public_list_response = await client.get("/api/v1/posts")
    assert public_list_response.status_code == 200
    assert public_list_response.json()["total"] == 0
