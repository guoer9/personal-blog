import httpx


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
):
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
