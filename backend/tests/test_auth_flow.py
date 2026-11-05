import httpx
from app.core.config import settings


def set_registration_phrase(monkeypatch, phrase: str) -> None:
    monkeypatch.setitem(settings.__dict__, "REGISTRATION_PHRASE", phrase)


async def test_register_login_and_protected_me(
    client: httpx.AsyncClient, monkeypatch
):
    set_registration_phrase(monkeypatch, "正确的验证短语")
    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "username": "alice",
            "email": "alice@example.com",
            "password": "alice-password",
            "verification_phrase": "正确的验证短语",
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


async def test_refresh_requires_an_active_user(
    client: httpx.AsyncClient, monkeypatch
):
    set_registration_phrase(monkeypatch, "正确的验证短语")
    await client.post(
        "/api/v1/auth/register",
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "bob-password",
            "verification_phrase": "正确的验证短语",
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


async def test_registration_rejects_wrong_phrase_without_creating_user(
    client: httpx.AsyncClient, monkeypatch
):
    set_registration_phrase(monkeypatch, "正确的验证短语")
    registration = {
        "username": "phrase-user",
        "email": "phrase-user@example.com",
        "password": "phrase-password",
        "verification_phrase": "错误的验证短语",
    }

    rejected = await client.post("/api/v1/auth/register", json=registration)

    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "验证内容不正确"

    registration["verification_phrase"] = "正确的验证短语"
    accepted = await client.post("/api/v1/auth/register", json=registration)

    assert accepted.status_code == 201
    assert accepted.json()["username"] == "phrase-user"
    assert accepted.json()["is_admin"] is False


async def test_registration_is_closed_when_phrase_is_not_configured(
    client: httpx.AsyncClient, monkeypatch
):
    set_registration_phrase(monkeypatch, "")
    registration = {
        "username": "closed-user",
        "email": "closed-user@example.com",
        "password": "closed-password",
        "verification_phrase": "任何输入",
    }

    rejected = await client.post("/api/v1/auth/register", json=registration)

    assert rejected.status_code == 503
    assert rejected.json()["detail"] == "注册暂未开放"

    set_registration_phrase(monkeypatch, "正确的验证短语")
    registration["verification_phrase"] = "正确的验证短语"
    accepted = await client.post("/api/v1/auth/register", json=registration)

    assert accepted.status_code == 201
