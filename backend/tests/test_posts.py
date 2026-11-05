import httpx
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
