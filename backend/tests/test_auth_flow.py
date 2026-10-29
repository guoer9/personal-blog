import httpx


async def test_register_login_and_protected_me(client: httpx.AsyncClient):
    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "username": "alice",
            "email": "alice@example.com",
            "password": "alice-password",
        },
    )

    assert register_response.status_code == 201
    assert register_response.json()["username"] == "alice"

    login_response = await client.post(
        "/api/v1/auth/login/json",
        json={"username": "alice", "password": "alice-password"},
    )

    assert login_response.status_code == 200
    tokens = login_response.json()
    assert tokens["token_type"] == "bearer"

    me_response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "alice@example.com"

    refresh_response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
    )
    assert refresh_response.status_code == 401


async def test_refresh_requires_an_active_user(client: httpx.AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "bob-password",
        },
    )
    login_response = await client.post(
        "/api/v1/auth/login/json",
        json={"username": "bob", "password": "bob-password"},
    )
    refresh_token = login_response.json()["refresh_token"]

    refresh_response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]
