import base64
import os
from uuid import UUID
import pytest
import pytest_asyncio
from app.core.config import settings


@pytest_asyncio.fixture(params=['sqlite', 'postgresql'])
async def session_factory(request, db_engine):
    from uuid import uuid4
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db.session import Base
    if request.param == 'sqlite':
        yield async_sessionmaker(db_engine, expire_on_commit=False, autoflush=False)
        return
    url = os.environ.get('LIBRARY_TEST_POSTGRES_URL')
    if not url:
        pytest.skip('Set LIBRARY_TEST_POSTGRES_URL for isolated PostgreSQL verification')
    schema = 'works_test_' + uuid4().hex
    engine = create_async_engine(url, connect_args={'server_settings': {'search_path': schema}})
    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


@pytest_asyncio.fixture
async def admin_token(db_session):
    from datetime import datetime, timezone
    from app.models import User
    from app.core.security import create_access_token, get_password_hash
    user = User(username='admin', email='admin@example.com', is_admin=True, is_active=True,
                hashed_password=get_password_hash('test-password'), created_at=datetime.now(timezone.utc).replace(tzinfo=None))
    db_session.add(user)
    await db_session.commit()
    return create_access_token(user.id)


@pytest.fixture(autouse=True)
def work_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "PRIVATE_STORAGE_DIR", str(tmp_path / "private"))
    monkeypatch.setattr(settings, "PUBLIC_MEDIA_DIR", str(tmp_path / "publication"))


def draft(**changes):
    return {"title": "真实测试作品", "category": "code", "caption": "Code", "description": "测试公开与草稿边界", "tags": ["Python"], "accent": "lime", "repository": "https://github.com/guoer9/money-agent", "notes": [], "featured": True, "sort_order": 0, **changes}


@pytest.mark.asyncio
async def test_admin_creates_publishes_updates_and_unpublishes(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    assert (await client.post("/api/v1/admin/works", json={"slug": "lifecycle", **draft()})).status_code == 401
    created = await client.post("/api/v1/admin/works", json={"slug": "lifecycle", **draft()}, headers=headers)
    assert created.status_code == 201, created.text
    record = created.json()
    assert (await client.get("/api/v1/works")).json() == {"items": []}
    assert (await client.get("/api/v1/works/lifecycle", headers=headers)).status_code == 404
    published = await client.post(f"/api/v1/admin/works/{record['id']}/publish", json={"version": record["version"]}, headers=headers)
    assert published.status_code == 200, published.text
    record = published.json()
    public = (await client.get("/api/v1/works/lifecycle")).json()
    assert public["title"] == "真实测试作品"
    assert "draft" not in public and "cover_asset_id" not in public
    assert len((await client.get("/api/v1/works?featured=true&category=code")).json()["items"]) == 1
    edited = await client.put(f"/api/v1/admin/works/{record['id']}", json={"version": record["version"], **draft(title="更新后的草稿")}, headers=headers)
    assert edited.status_code == 200, edited.text
    assert (await client.get("/api/v1/works/lifecycle")).json()["title"] == "真实测试作品"
    stale = await client.put(f"/api/v1/admin/works/{record['id']}", json={"version": record["version"], **draft(title="过时标签页")}, headers=headers)
    assert stale.status_code == 409
    record = edited.json()
    result = await client.post(f"/api/v1/admin/works/{record['id']}/publish", json={"version": record["version"]}, headers=headers)
    assert result.status_code == 200
    assert (await client.get("/api/v1/works/lifecycle")).json()["title"] == "更新后的草稿"
    result = await client.post(f"/api/v1/admin/works/{record['id']}/unpublish", json={"version": result.json()["version"]}, headers=headers)
    assert result.status_code == 200
    assert (await client.get("/api/v1/works/lifecycle")).status_code == 404
    assert (await client.get("/api/v1/works")).json() == {"items": []}


@pytest.mark.asyncio
async def test_duplicate_slug_invalid_links_and_incomplete_media(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    payload = {"slug": "unique-slug", **draft()}
    assert (await client.post("/api/v1/admin/works", json=payload, headers=headers)).status_code == 201
    assert (await client.post("/api/v1/admin/works", json=payload, headers=headers)).status_code == 409
    assert (await client.post("/api/v1/admin/works", json={**payload, "slug": "../bad"}, headers=headers)).status_code == 422
    assert (await client.post("/api/v1/admin/works", json={**payload, "slug": "bad-link", "repository": "javascript:alert(1)"}, headers=headers)).status_code == 422
    result = await client.post("/api/v1/admin/works", json={"slug": "unfinished-film", **draft(category="film", repository=None)}, headers=headers)
    record = result.json()
    assert (await client.post(f"/api/v1/admin/works/{record['id']}/publish", json={"version": record["version"]}, headers=headers)).status_code == 409


@pytest.mark.asyncio
async def test_asset_privacy_range_preview_and_snapshot_independence(client, admin_token, monkeypatch):
    # File preparation's protocol boundary is tested with a bounded valid image;
    # its decoder is exercised separately with the real exported media in E2E.
    from app.services import work_assets
    monkeypatch.setattr(work_assets, "inspect", lambda path, role: ("image/png", None))
    headers = {"Authorization": f"Bearer {admin_token}"}
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V6cAAAAASUVORK5CYII=")
    session = (await client.post("/api/v1/library/uploads", json={"name": "cover.png", "size": len(png), "mime_type": "image/png"}, headers=headers)).json()
    assert (await client.put(f"/api/v1/library/uploads/{session['id']}/parts/0", content=png, headers=headers)).status_code == 204
    entry = (await client.post(f"/api/v1/library/uploads/{session['id']}/complete", headers=headers)).json()
    prepared = await client.post("/api/v1/admin/work-assets", json={"entry_id": entry["id"], "role": "cover"}, headers=headers)
    assert prepared.status_code == 201, prepared.text
    asset = prepared.json()
    asset_url = f"/api/v1/work-assets/{asset['id']}"
    preview_url = f"/api/v1/admin/work-assets/{asset['id']}"
    assert (await client.get(asset_url)).status_code == 404
    assert (await client.get(preview_url)).status_code == 401
    response = await client.post("/api/v1/admin/work-assets/preview-session", headers=headers)
    assert response.status_code == 204
    assert "HttpOnly" in response.headers["set-cookie"] and "SameSite=strict" in response.headers["set-cookie"]
    preview = await client.get(preview_url, headers={"Range": "bytes=0-7"})
    assert preview.status_code == 206 and preview.content == png[:8]
    assert preview.headers["cache-control"] == "no-store"
    # A preview cookie is not a general administrator credential.
    assert (await client.get("/api/v1/admin/works")).status_code == 401
    work = (await client.post("/api/v1/admin/works", json={"slug": "asset-code", **draft(cover_asset_id=asset["id"])}, headers=headers)).json()
    result = await client.post(f"/api/v1/admin/works/{work['id']}/publish", json={"version": work["version"]}, headers=headers)
    assert result.status_code == 200, result.text
    assert (await client.get(asset_url)).content == png
    assert (await client.delete(f"/api/v1/library/entries/{entry['id']}", headers=headers)).status_code == 204
    assert (await client.get(asset_url)).content == png  # independent publication copy
    assert (await client.get(f"/api/v1/library/entries/{entry['id']}/download", headers=headers)).status_code == 404
    assert (await client.get("/uploads/" + entry["id"])).status_code == 404
    record = result.json()
    assert (await client.post(f"/api/v1/admin/works/{record['id']}/unpublish", json={"version": record["version"]}, headers=headers)).status_code == 200
    assert (await client.get(asset_url)).status_code == 404


def test_rejects_nonmedia_payload_and_decoder_network_protocols(tmp_path):
    from app.services.work_assets import inspect
    from fastapi import HTTPException
    path = tmp_path / "fake.mp4"
    path.write_text('<html><script>alert(1)</script></html>')
    with pytest.raises(HTTPException) as failure:
        inspect(path, "video")
    assert failure.value.status_code == 400


def test_publication_directory_cannot_bypass_publication_checks(tmp_path):
    from app.core.config import Settings
    from pydantic import ValidationError
    for upload, publication in [('uploads', 'uploads/works'), ('publication/uploads', 'publication'), ('same', 'same')]:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, PRIVATE_STORAGE_DIR=str(tmp_path / 'private'), UPLOAD_DIR=str(tmp_path / upload), PUBLIC_MEDIA_DIR=str(tmp_path / publication))


@pytest.mark.asyncio
async def test_work_writes_are_committed_before_success_response(client, admin_token):
    import httpx
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.main import app
    commits = []
    observed = []
    def committed(_session):
        commits.append(True)
    event.listen(Session, 'after_commit', committed)
    async def boundary(scope, receive, send):
        async def checked_send(message):
            if message['type'] == 'http.response.start':
                observed.append(bool(commits))
            await send(message)
        await app(scope, receive, checked_send)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=boundary), base_url='http://testserver', headers={'Authorization': f'Bearer {admin_token}'}) as browser:
            created = await browser.post('/api/v1/admin/works', json={'slug': 'commit-boundary', **draft()})
            assert created.status_code == 201
            assert observed[-1], 'create response preceded commit'
            work = created.json()
            for method, path, data in [('PUT', '', {'version': work['version'], **draft()}), ('POST', '/publish', None), ('POST', '/unpublish', None)]:
                commits.clear()
                response = await browser.request(method, '/api/v1/admin/works/' + work['id'] + path, json=data or {'version': work['version']})
                assert response.status_code == 200
                assert observed[-1], f'{path or "save"} response preceded commit'
                work = response.json()
    finally:
        event.remove(Session, 'after_commit', committed)


@pytest.mark.asyncio
async def test_asset_quota_serializes_preparations_and_cleanup_preserves_both_snapshots(client, admin_token, monkeypatch, session_factory):
    import asyncio
    from datetime import datetime, timedelta, timezone
    from app.models.work import WorkAsset
    from app.services import work_assets
    from app.services.works import asset_path
    monkeypatch.setattr(work_assets, 'inspect', lambda path, role: ('image/png', None))
    monkeypatch.setattr(settings, 'WORK_ASSET_QUOTA_BYTES', 8)
    headers = {'Authorization': f'Bearer {admin_token}'}
    upload = (await client.post('/api/v1/library/uploads', json={'name': 'cover.png', 'size': 4, 'mime_type': 'image/png'}, headers=headers)).json()
    await client.put(f"/api/v1/library/uploads/{upload['id']}/parts/0", content=b'png!', headers=headers)
    entry = (await client.post(f"/api/v1/library/uploads/{upload['id']}/complete", headers=headers)).json()
    async def prepare():
        return await client.post('/api/v1/admin/work-assets', json={'entry_id': entry['id'], 'role': 'cover'}, headers=headers)
    results = await asyncio.gather(prepare(), prepare(), prepare())
    assert sorted(r.status_code for r in results) == [201, 201, 409]
    ids = [r.json()['id'] for r in results if r.status_code == 201]
    work = (await client.post('/api/v1/admin/works', json={'slug': 'retained-cover', **draft(cover_asset_id=ids[0])}, headers=headers)).json()
    work = (await client.post(f"/api/v1/admin/works/{work['id']}/publish", json={'version': work['version']}, headers=headers)).json()
    work = (await client.put(f"/api/v1/admin/works/{work['id']}", json={'version': work['version'], **draft(cover_asset_id=ids[1])}, headers=headers)).json()
    old = datetime.now(timezone.utc) - timedelta(days=2)
    async with session_factory() as db:
        for id in ids:
            asset = await db.get(WorkAsset, UUID(id))
            asset.created_at = old
            os.utime(asset_path(id), (old.timestamp(), old.timestamp()))
        await db.commit()
    assert (await client.post('/api/v1/admin/work-assets/cleanup')).status_code == 401
    assert (await client.post('/api/v1/admin/work-assets/cleanup', headers=headers)).json()['removed'] == 0
    # Keep one reference only in public snapshot; remove the other from the draft.
    await client.put(f"/api/v1/admin/works/{work['id']}", json={'version': work['version'], **draft()}, headers=headers)
    assert (await client.post('/api/v1/admin/work-assets/cleanup', headers=headers)).json()['removed'] == 1
    assert (await client.get('/api/v1/work-assets/' + ids[0])).status_code == 200
    assert (await prepare()).status_code == 201
    status = (await client.get('/api/v1/admin/work-assets/storage', headers=headers)).json()
    assert status['used_bytes'] == 8 and status['quota_bytes'] == 8
    assert (await client.post('/api/v1/admin/work-assets/cleanup', headers=headers)).json()['removed'] == 0
