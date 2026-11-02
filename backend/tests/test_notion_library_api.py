import pytest


@pytest.mark.asyncio
async def test_multi_connection_admin_routes_are_authenticated_and_separate_preview_from_import(
    client, admin_token, monkeypatch
):
    from app.api.v1 import notion as notion_api

    class FakeLibraryService:
        def list_connections(self):
            return [{"id": "journal", "label": "日记连接", "configured": True}]

        async def list_sources(self, db):
            return [{
                "id": 3,
                "connection_id": "journal",
                "connection_label": "日记连接",
                "database_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "title": "日记和文档",
                "source_url": "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "data_source_ids": ["cccccccc-cccc-cccc-cccc-cccccccccccc"],
                "last_import_at": None,
                "last_success_at": None,
            }]

        async def inspect(self, db, connection_id, url):
            return {"title": "日记和文档", "page_count": 1, "data_source_count": 1}

        async def import_source(self, db, connection_id, url, admin_id):
            return {"status": "success", "counters": {"published": 1}}

        async def sync(self, db, source_id, admin_id):
            return {"status": "success", "counters": {"published": 1}}

        async def inspect_page(self, db, source_id, url):
            return {"title": "单页", "page_count": 1}

        async def import_page(self, db, source_id, url, admin_id):
            return {"status": "success", "counters": {"published": 1}}

    monkeypatch.setattr(notion_api, "notion_library_service", FakeLibraryService())
    headers = {"Authorization": f"Bearer {admin_token}"}

    assert (await client.get("/api/v1/admin/notion/connections")).status_code == 401
    connections = await client.get("/api/v1/admin/notion/connections", headers=headers)
    assert connections.status_code == 200
    assert connections.json() == [{"id": "journal", "label": "日记连接", "configured": True}]
    assert "token" not in connections.text

    sources = await client.get("/api/v1/admin/notion/sources", headers=headers)
    assert sources.status_code == 200
    assert sources.json()[0]["data_source_ids"] == ["cccccccc-cccc-cccc-cccc-cccccccccccc"]

    inspected = await client.post(
        "/api/v1/admin/notion/sources/inspect",
        json={"connection_id": "journal", "url": "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        headers=headers,
    )
    assert inspected.status_code == 200
    assert inspected.json()["title"] == "日记和文档"

    imported = await client.post(
        "/api/v1/admin/notion/sources",
        json={"connection_id": "journal", "url": "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        headers=headers,
    )
    assert imported.status_code == 200

    synced = await client.post("/api/v1/admin/notion/sources/3/sync", headers=headers)
    assert synced.status_code == 200
    page_preview = await client.post(
        "/api/v1/admin/notion/sources/3/pages/inspect",
        json={"url": "https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
        headers=headers,
    )
    assert page_preview.status_code == 200
    page_import = await client.post(
        "/api/v1/admin/notion/sources/3/pages/import",
        json={"url": "https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
        headers=headers,
    )
    assert page_import.status_code == 200

@pytest.mark.asyncio
async def test_application_lifespan_does_not_start_legacy_notion_scheduler(monkeypatch):
    import app.main as main
    from app.services.notion_sync import notion_sync_service

    async def cleanup_loop(self):
        return None

    def forbidden_scheduler(*args, **kwargs):
        raise AssertionError("legacy Notion scheduler must not start")

    monkeypatch.setattr(main.TransferService, "cleanup_loop", cleanup_loop)
    monkeypatch.setattr(notion_sync_service, "scheduler", forbidden_scheduler)

    async with main.app.router.lifespan_context(main.app):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize("sync_status, last_error", [
    ("success", None),
    ("error", "Notion 请求失败"),
])
async def test_admin_status_reports_multi_connection_library_state(
    client, db_session, admin_token, monkeypatch, tmp_path, sync_status, last_error
):
    import json
    from datetime import datetime, timezone

    from app.api.v1 import notion as notion_api
    from app.models import NotionLibrarySyncState, NotionSource
    from app.services.notion_credentials import NotionCredentialStore
    from app.services.notion_library import NotionLibraryService

    path = tmp_path / "connections.json"
    path.write_text(json.dumps({"version": 1, "connections": [
        {"id": "journal", "label": "Journal", "token": "status-test-token"},
    ]}))
    monkeypatch.setattr(
        notion_api, "notion_library_service",
        NotionLibraryService(NotionCredentialStore(path)),
    )
    db_session.add(NotionSource(
        connection_id="journal", database_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title="资料库", source_url="https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        data_source_ids=["cccccccc-cccc-cccc-cccc-cccccccccccc"],
    ))
    db_session.add(NotionLibrarySyncState(
        id=1, status=sync_status, last_error=last_error,
        last_success_at=datetime(2026, 11, 2, tzinfo=timezone.utc),
        counters={"queried": 3, "published": 2, "isolated": 1},
    ))
    await db_session.commit()

    response = await client.get(
        "/api/v1/admin/notion/status", headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ready"] is True
    assert data["source_configured"] is True
    assert data["source_title"] == "资料库"
    assert data["status"] == sync_status
    assert data["last_error"] == last_error
    assert data["last_success_at"].startswith("2026-11-02")
    assert data["counters"]["published"] == 2
    assert data["counters"]["isolated"] == 1
    assert "status-test-token" not in response.text
