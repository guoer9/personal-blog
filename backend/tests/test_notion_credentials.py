import importlib.util
import json
import stat
from pathlib import Path

import pytest


def test_missing_file_has_no_configured_connections(tmp_path):
    from app.services.notion_credentials import NotionCredentialStore

    assert NotionCredentialStore(tmp_path / "missing.json").list_connections() == []


def test_store_supports_multiple_connections_without_serializing_tokens(tmp_path):
    from app.services.notion_credentials import NotionCredentialStore

    secret_one = "ntn-test-secret-one-not-for-real-use"
    secret_two = "ntn-test-secret-two-not-for-real-use"
    path = tmp_path / "connections.json"
    path.write_text(json.dumps({
        "version": 1,
        "connections": [
            {"id": "journal", "label": "日记资料库", "token": secret_one},
            {"id": "deployment", "label": "部署文档", "token": secret_two},
        ],
    }))

    store = NotionCredentialStore(path)
    summaries = store.list_connections()

    assert [summary.model_dump() for summary in summaries] == [
        {"id": "journal", "label": "日记资料库", "configured": True},
        {"id": "deployment", "label": "部署文档", "configured": True},
    ]
    assert secret_one not in repr(summaries)
    assert secret_two not in repr(summaries)
    assert store.get_connection("journal").token.get_secret_value() == secret_one
    assert store.get_connection("deployment").token.get_secret_value() == secret_two


def test_duplicate_connection_ids_fail_closed_without_echoing_tokens(tmp_path):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    token = "ntn-test-duplicate-must-not-leak"
    path = tmp_path / "connections.json"
    path.write_text(json.dumps({
        "version": 1,
        "connections": [
            {"id": "same", "label": "first", "token": token},
            {"id": "same", "label": "second", "token": token},
        ],
    }))

    with pytest.raises(NotionCredentialError) as error:
        NotionCredentialStore(path).list_connections()

    assert token not in str(error.value)


def test_invalid_json_does_not_leak_file_contents(tmp_path):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    secret = "ntn-invalid-json-secret-must-not-appear"
    path = tmp_path / "connections.json"
    path.write_text('{"connections": ["' + secret)

    with pytest.raises(NotionCredentialError) as error:
        NotionCredentialStore(path).list_connections()

    assert secret not in str(error.value)


def test_unknown_connection_id_returns_sanitized_error(tmp_path):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    path = tmp_path / "connections.json"
    path.write_text(json.dumps({"version": 1, "connections": []}))

    with pytest.raises(NotionCredentialError, match="Notion connection is not configured"):
        NotionCredentialStore(path).get_connection("missing")


def test_local_init_creates_ignored_secret_file_with_private_permissions(tmp_path):
    script = Path(__file__).parents[2] / "scripts" / "local" / "dev.py"
    spec = importlib.util.spec_from_file_location("local_dev", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    path = module.ensure_notion_connections_file(tmp_path)

    assert path == tmp_path / ".secrets" / "notion-connections.json"
    assert json.loads(path.read_text()) == {"version": 1, "connections": []}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_compose_mounts_private_directory_for_atomic_connection_creation():
    root = Path(__file__).parents[2]
    compose = (root / "compose.local.yml").read_text()

    assert "./.secrets:/run/secrets" in compose
    assert "NOTION_CONNECTIONS_FILE: /run/secrets/notion-connections.json" in compose
    assert "COPY .secrets" not in (root / "backend" / "Dockerfile.local").read_text()


def test_add_creates_uuid_private_file_and_preserves_existing_connections(tmp_path):
    from uuid import UUID
    from app.services.notion_credentials import NotionCredentialStore

    path = tmp_path / "connections.json"
    existing = {"id": "legacy-id", "label": "旧连接", "token": "old-test-secret"}
    path.write_text(json.dumps({"version": 1, "connections": [existing]}))
    store = NotionCredentialStore(path)
    result = store.add(" 新连接 ", " new-test-secret ")
    UUID(result.id)
    assert result.model_dump() == {"id": result.id, "label": "新连接", "configured": True}
    payload = json.loads(path.read_text())
    assert payload == {"version": 1, "connections": [existing, {"id": result.id, "label": "新连接", "token": "new-test-secret"}]}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert store.get_connection(result.id).token.get_secret_value() == "new-test-secret"
    assert "new-test-secret" not in repr(result)


@pytest.mark.parametrize("content", [
    '{"token":"sentinel-secret',
    '{"version":2,"connections":[]}',
    '{"version":true,"connections":[]}',
    '{"version":1.0,"connections":[]}',
    '{"version":1,"connections":[{"id":"a","label":"test","token":"old","extra":"sentinel-secret"}]}',
])
def test_add_never_overwrites_invalid_files(tmp_path, content):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    path = tmp_path / "connections.json"
    path.write_text(content)
    before = path.read_bytes()
    with pytest.raises(NotionCredentialError) as error:
        NotionCredentialStore(path).add("test", "new-test-secret")
    assert path.read_bytes() == before
    assert "sentinel-secret" not in str(error.value)


def test_add_rejects_same_token_without_changing_file(tmp_path):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    store = NotionCredentialStore(tmp_path / "connections.json")
    store.add("first", "unit-test-secret")
    before = store.path.read_bytes()
    with pytest.raises(NotionCredentialError, match="already configured"):
        store.add("another label", " unit-test-secret ")
    assert store.path.read_bytes() == before


def test_add_concurrent_writers_do_not_lose_updates(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from app.services.notion_credentials import NotionCredentialStore

    path = tmp_path / "connections.json"
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda n: NotionCredentialStore(path).add(f"name-{n}", f"test-secret-{n}"), range(12)))
    assert len({result.id for result in results}) == 12
    assert {item.label for item in NotionCredentialStore(path).list_connections()} == {f"name-{n}" for n in range(12)}


def test_add_failed_replace_preserves_original_and_removes_temporary_file(tmp_path, monkeypatch):
    import os
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    store = NotionCredentialStore(tmp_path / "connections.json")
    store.add("first", "first-test-secret")
    before = store.path.read_bytes()
    files_before = set(tmp_path.iterdir())

    def fail_replace(*args):
        raise OSError("second-test-secret")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(NotionCredentialError) as error:
        store.add("second", "second-test-secret")
    assert "second-test-secret" not in str(error.value)
    assert store.path.read_bytes() == before
    assert set(tmp_path.iterdir()) == files_before


@pytest.mark.parametrize("label,token", [(None, "secret"), ("test", 123), ("", "secret"), ("test", ""), ("x" * 101, "secret"), ("test", "s" * 4097), ("test", "secret\nheader")])
def test_add_validates_inputs_without_exposing_them(tmp_path, label, token):
    from app.services.notion_credentials import NotionCredentialError, NotionCredentialStore

    store = NotionCredentialStore(tmp_path / "connections.json")
    with pytest.raises(NotionCredentialError):
        store.add(label, token)
    assert not store.path.exists()
