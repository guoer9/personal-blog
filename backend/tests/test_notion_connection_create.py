"""Connection creation uses only temporary files and mocked Notion HTTP traffic."""

import json
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest

from app.services.notion_credentials import NotionCredentialStore

URL = "/api/v1/admin/notion/connections"
TOKEN = "ntn_unit_test_connection_secret"


@pytest.fixture
def connection_setup(monkeypatch, tmp_path):
    from app.services import notion_library

    path = tmp_path / "connections.json"
    calls = []
    reply = {"status": 200, "payload": {"object": "user", "id": "bot-test", "type": "bot"}}

    def handler(request):
        calls.append(request)
        return httpx.Response(reply["status"], json=reply["payload"])

    # Patch the real client's transport, never bypass its headers/URL/error handling.
    original_init = notion_library.NotionLibraryClient.__init__

    def init(client, credential, transport=None):
        original_init(client, credential, httpx.MockTransport(handler))

    monkeypatch.setattr(notion_library.NotionLibraryClient, "__init__", init)
    monkeypatch.setattr(notion_library.notion_library_service, "credentials", NotionCredentialStore(path))
    return SimpleNamespace(path=path, calls=calls, reply=reply)


@pytest.mark.asyncio
async def test_create_verifies_read_only_and_returns_only_safe_metadata(client, admin_token, connection_setup, caplog):
    result = await client.post(URL, json={"label": " 工作空间 ", "token": f" {TOKEN} "}, headers={"Authorization": f"Bearer {admin_token}"})
    assert result.status_code == 201
    summary = result.json()
    assert set(summary) == {"id", "label", "configured"}
    UUID(summary["id"])
    assert summary["label"] == "工作空间"
    assert summary["configured"] is True
    assert TOKEN not in result.text + caplog.text
    assert [(r.method, str(r.url)) for r in connection_setup.calls] == [("GET", "https://api.notion.com/v1/users/me")]
    assert connection_setup.calls[0].headers["Authorization"] == f"Bearer {TOKEN}"
    store = NotionCredentialStore(connection_setup.path)
    assert store.get_connection(summary["id"]).token.get_secret_value() == TOKEN


@pytest.mark.asyncio
async def test_creation_requires_admin_before_any_external_or_disk_work(client, admin_token, db_session, connection_setup):
    from app.models import User
    from app.core.security import create_access_token

    result = await client.post(URL, json={"label": "test", "token": TOKEN})
    assert result.status_code == 401
    user = User(username="reader", email="reader@example.com", hashed_password="unused", is_admin=False, is_active=True)
    db_session.add(user)
    await db_session.commit()
    result = await client.post(URL, json={"label": "test", "token": TOKEN}, headers={"Authorization": f"Bearer {create_access_token(user.id)}"})
    assert result.status_code == 403
    assert connection_setup.calls == []
    assert not connection_setup.path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", [
    '{"label":"test","token":"' + TOKEN,
    json.dumps({"label": "test", "token": {"secret": TOKEN}}),
    json.dumps({"label": [TOKEN], "token": TOKEN}),
    json.dumps({"label": "", "token": TOKEN}),
    json.dumps({"label": "test", "token": TOKEN, "extra": TOKEN}),
    json.dumps([TOKEN]),
    json.dumps({"label": "test"}),
    json.dumps({"label": "test", "token": "bad\r\n" + TOKEN}),
    json.dumps({"label": TOKEN, "token": TOKEN}),
])
async def test_invalid_requests_never_echo_input(client, admin_token, connection_setup, caplog, raw):
    result = await client.post(URL, content=raw, headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    assert result.status_code == 422
    assert TOKEN not in result.text + caplog.text
    assert connection_setup.calls == []
    assert not connection_setup.path.exists()


@pytest.mark.asyncio
async def test_oversized_request_is_rejected_before_verification(client, admin_token, connection_setup):
    result = await client.post(URL, content=json.dumps({"label": "test", "token": TOKEN + "x" * 20_000}), headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    assert result.status_code == 413
    assert TOKEN not in result.text
    assert connection_setup.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status, expected", [(401, 400), (403, 400), (429, 502), (500, 502)])
async def test_upstream_errors_are_sanitized_and_never_persist(client, admin_token, connection_setup, caplog, status, expected):
    connection_setup.reply.update(status=status, payload={"message": TOKEN})
    result = await client.post(URL, json={"label": "test", "token": TOKEN}, headers={"Authorization": f"Bearer {admin_token}"})
    assert result.status_code == expected
    assert TOKEN not in result.text + caplog.text
    assert not connection_setup.path.exists()


@pytest.mark.asyncio
async def test_duplicate_is_conflict_without_overwriting_existing_connection(client, admin_token, connection_setup):
    headers = {"Authorization": f"Bearer {admin_token}"}
    first = await client.post(URL, json={"label": "first", "token": TOKEN}, headers=headers)
    assert first.status_code == 201
    before = connection_setup.path.read_bytes()
    duplicate = await client.post(URL, json={"label": "second", "token": TOKEN}, headers=headers)
    assert duplicate.status_code == 409
    assert TOKEN not in duplicate.text
    assert connection_setup.path.read_bytes() == before


@pytest.mark.asyncio
async def test_bad_file_and_write_failure_are_sanitized(client, admin_token, connection_setup, monkeypatch):
    connection_setup.path.write_text('{"token":"' + TOKEN)
    before = connection_setup.path.read_bytes()
    result = await client.post(URL, json={"label": "test", "token": TOKEN}, headers={"Authorization": f"Bearer {admin_token}"})
    assert result.status_code == 503
    assert TOKEN not in result.text
    assert connection_setup.path.read_bytes() == before

    def fail(*args):
        raise OSError(TOKEN)

    monkeypatch.setattr(NotionCredentialStore, "add", fail)
    result = await client.post(URL, json={"label": "test", "token": TOKEN}, headers={"Authorization": f"Bearer {admin_token}"})
    assert result.status_code == 503
    assert TOKEN not in result.text


def test_openapi_exposes_password_only_as_write_only():
    from app.main import app

    operation = app.openapi()["paths"][URL]["post"]
    schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert schema["properties"]["token"]["writeOnly"] is True
    assert schema["properties"]["token"]["format"] == "password"
