"""Private library contract exercised against independent SQLite connections."""

import asyncio
import os
import errno
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings, settings
from app.core.security import create_access_token, create_refresh_token, get_password_hash
from app.db.session import Base
from app.models import User

PREFIX = "/api/v1/library"
CHUNK = 8 * 1024 * 1024


@pytest_asyncio.fixture(params=["sqlite", "postgresql"])
async def session_factory(tmp_path, request):
    schema = None
    if request.param == "postgresql":
        url = os.environ.get("LIBRARY_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set LIBRARY_TEST_POSTGRES_URL to an isolated PostgreSQL test database")
        schema = "library_test_" + uuid4().hex
        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    else:
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'library.db'}")
    async with engine.begin() as connection:
        if schema:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    finally:
        if schema:
            async with engine.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


@pytest.fixture(autouse=True)
def private_storage(tmp_path, monkeypatch):
    for key, value in {
        "PRIVATE_STORAGE_DIR": str(tmp_path / "private"),
        "PUBLIC_MEDIA_DIR": str(tmp_path / "public-media"),
        "LIBRARY_MAX_FILE_BYTES": 8 * 1024**3,
        "LIBRARY_QUOTA_BYTES": 50 * 1024**3,
        "LIBRARY_SESSION_TTL_SECONDS": 86400,
    }.items():
        monkeypatch.setitem(settings.__dict__, key, value)
    return tmp_path / "private"


@pytest_asyncio.fixture
async def admin_token(db_session):
    # Existing users.created_at is TIMESTAMP WITHOUT TIME ZONE. Keep this suite's
    # PostgreSQL seed consistent with that schema without changing auth models.
    user = User(username="admin", email="admin@example.com", hashed_password=get_password_hash("admin-password"),
                is_admin=True, is_active=True, created_at=datetime.now(timezone.utc).replace(tzinfo=None))
    db_session.add(user)
    await db_session.commit()
    return create_access_token(user.id)


@pytest_asyncio.fixture
async def admin(client, admin_token):
    client.headers["Authorization"] = f"Bearer {admin_token}"
    return client


async def folder(client, name="folder", parent_id=None):
    response = await client.post(f"{PREFIX}/folders", json={"name": name, "parent_id": parent_id})
    assert response.status_code == 200, response.text
    return response.json()


async def upload(client, data=b"hello", name="test.txt", parent_id=None):
    response = await client.post(f"{PREFIX}/uploads", json={
        "name": name, "size": len(data), "mime_type": "text/plain", "parent_id": parent_id,
    })
    assert response.status_code == 200, response.text
    session = response.json()
    for index, start in enumerate(range(0, len(data), CHUNK)):
        part = await client.put(f"{PREFIX}/uploads/{session['id']}/parts/{index}", content=data[start:start + CHUNK])
        assert part.status_code == 204, part.text
    return session


async def complete(client, session):
    response = await client.post(f"{PREFIX}/uploads/{session['id']}/complete")
    assert response.status_code == 200, response.text
    return response.json()


AUTH_ROUTES = [
    ("GET", "/entries"), ("GET", "/status"), ("POST", "/folders"),
    ("PATCH", "/entries/{id}"), ("DELETE", "/entries/{id}"),
    ("POST", "/entries/{id}/restore"), ("GET", "/entries/{id}/download"),
    ("POST", "/uploads"), ("GET", "/uploads/{id}"),
    ("PUT", "/uploads/{id}/parts/0"), ("POST", "/uploads/{id}/complete"),
    ("DELETE", "/uploads/{id}"),
]


@pytest.mark.parametrize("identity,expected", [("anonymous", 401), ("user", 403), ("refresh", 401), ("inactive", 401)])
async def test_every_endpoint_requires_active_admin(client, db_session, identity, expected):
    if identity != "anonymous":
        user = User(username="reader", email="reader@example.com", hashed_password="unused",
                    is_active=identity != "inactive", is_admin=identity != "user",
                    created_at=datetime.now(timezone.utc).replace(tzinfo=None))
        db_session.add(user)
        await db_session.commit()
        token = create_refresh_token(user.id) if identity == "refresh" else create_access_token(user.id)
        client.headers["Authorization"] = f"Bearer {token}"
    for method, path in AUTH_ROUTES:
        response = await client.request(method, PREFIX + path.format(id=uuid4()))
        assert response.status_code == expected, (method, path, response.text)


async def test_contract_folders_move_and_cycle_prevention(admin):
    root = await folder(admin, "资料")
    assert set(root) == {"id", "name", "kind", "parent_id", "size", "mime_type", "created_at", "deleted_at"}
    assert str(UUID(root["id"])) == root["id"]
    assert root["kind"] == "folder" and root["size"] == 0 and root["parent_id"] is None
    child = await folder(admin, "child", root["id"])
    grandchild = await folder(admin, "grandchild", child["id"])
    for parent in [root["id"], grandchild["id"]]:
        response = await admin.patch(f"{PREFIX}/entries/{root['id']}", json={"parent_id": parent})
        assert response.status_code == 409
    renamed = await admin.patch(f"{PREFIX}/entries/{child['id']}", json={"name": "renamed", "parent_id": None})
    assert renamed.status_code == 200 and renamed.json()["name"] == "renamed"
    listing = await admin.get(f"{PREFIX}/entries")
    assert {entry["id"] for entry in listing.json()["items"]} == {root["id"], child["id"]}
    listing = await admin.get(f"{PREFIX}/entries", params={"parent_id": child["id"]})
    assert [entry["id"] for entry in listing.json()["items"]] == [grandchild["id"]]


async def test_soft_delete_restore_batch_keeps_previously_trashed_child(admin):
    root = await folder(admin)
    child = await folder(admin, "child", root["id"])
    old = await complete(admin, await upload(admin, b"old", parent_id=child["id"]))
    live = await complete(admin, await upload(admin, b"live", parent_id=child["id"]))
    assert (await admin.delete(f"{PREFIX}/entries/{old['id']}")).status_code == 204
    assert (await admin.delete(f"{PREFIX}/entries/{root['id']}")).status_code == 204
    assert (await admin.delete(f"{PREFIX}/entries/{root['id']}")).status_code == 204
    assert (await admin.get(f"{PREFIX}/entries")).json() == {"items": []}
    trash = (await admin.get(f"{PREFIX}/entries", params={"trash": True})).json()["items"]
    assert {entry["id"] for entry in trash} == {root["id"], child["id"], live["id"], old["id"]}
    assert (await admin.get(f"{PREFIX}/entries/{live['id']}/download")).status_code == 404
    assert (await admin.post(f"{PREFIX}/entries/{child['id']}/restore")).status_code == 409
    assert (await admin.post(f"{PREFIX}/entries/{root['id']}/restore")).status_code == 200
    assert (await admin.get(f"{PREFIX}/entries/{live['id']}/download")).content == b"live"
    assert (await admin.get(f"{PREFIX}/entries/{old['id']}/download")).status_code == 404
    assert (await admin.post(f"{PREFIX}/entries/{old['id']}/restore")).status_code == 200


async def test_binary_parts_resume_exact_lengths_idempotent_completion_and_private_download(admin, private_storage):
    response = await admin.post(f"{PREFIX}/uploads", json={"name": "原片.mov", "size": CHUNK + 3, "mime_type": "video/quicktime"})
    assert response.status_code == 200
    session = response.json()
    assert set(session) == {"id", "chunk_size", "received_parts", "expires_at"}
    assert session["chunk_size"] == CHUNK and session["received_parts"] == []
    path = f"{PREFIX}/uploads/{session['id']}"
    assert (await admin.post(path + "/complete")).status_code == 409
    for index, data in [(0, b"short"), (1, b"ab"), (1, b"abcd"), (2, b"abc"), (-1, b"abc")]:
        assert (await admin.put(f"{path}/parts/{index}", content=data)).status_code == 400
    assert (await admin.get(path)).json()["received_parts"] == []
    assert (await admin.put(path + "/parts/1", content=b"end")).status_code == 204
    assert (await admin.get(path)).json()["received_parts"] == [1]
    assert (await admin.put(path + "/parts/0", content=b"A" * CHUNK)).status_code == 204
    assert (await admin.put(path + "/parts/0", content=b"B" * CHUNK)).status_code == 204
    entry = await complete(admin, session)
    assert entry["size"] == CHUNK + 3 and entry["name"] == "原片.mov"
    assert await complete(admin, session) == entry
    assert (await admin.get(path)).json()["received_parts"] == [0, 1]
    assert (await admin.put(path + "/parts/1", content=b"bad")).status_code == 409
    assert (await admin.delete(path)).status_code == 409
    download = await admin.get(f"{PREFIX}/entries/{entry['id']}/download")
    assert download.content == b"B" * CHUNK + b"end"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in download.headers["cache-control"]
    for public_path in [f"/uploads/{entry['id']}", f"/private-library/objects/{entry['id']}", f"/media/{entry['id']}"]:
        assert (await admin.get(public_path)).status_code == 404
    assert not any(file.name == "原片.mov" for file in private_storage.rglob("*"))


async def test_empty_file_and_invalid_file_parent(admin):
    entry = await complete(admin, await upload(admin, b""))
    assert (await admin.get(f"{PREFIX}/entries/{entry['id']}/download")).content == b""
    assert (await admin.post(f"{PREFIX}/folders", json={"name": "x", "parent_id": entry["id"]})).status_code == 409
    assert (await admin.get(f"{PREFIX}/entries", params={"parent_id": entry["id"]})).status_code == 409


async def test_quota_reserves_pending_and_trash_until_cancel(admin, monkeypatch):
    monkeypatch.setattr(settings, "LIBRARY_MAX_FILE_BYTES", 6)
    monkeypatch.setattr(settings, "LIBRARY_QUOTA_BYTES", 10)
    item = await complete(admin, await upload(admin, b"123456"))
    await admin.delete(f"{PREFIX}/entries/{item['id']}")
    pending = await upload(admin, b"1234")
    status = (await admin.get(f"{PREFIX}/status")).json()
    assert status == {"used_bytes": 6, "quota_bytes": 10, "max_file_bytes": 6, "chunk_size": CHUNK}
    for size, expected in [(1, 409), (7, 413), (-1, 422), (1.5, 422), (True, 422)]:
        response = await admin.post(f"{PREFIX}/uploads", json={"name": "test", "size": size, "mime_type": None})
        assert response.status_code == expected
    assert (await admin.delete(f"{PREFIX}/uploads/{pending['id']}")).status_code == 204
    assert (await admin.delete(f"{PREFIX}/uploads/{pending['id']}")).status_code == 204
    assert (await admin.get(f"{PREFIX}/uploads/{pending['id']}")).status_code == 410
    assert (await admin.post(f"{PREFIX}/uploads", json={"name": "new", "size": 4})).status_code == 200


@pytest.mark.parametrize("name", ["../secret", "..", ".", "/etc/passwd", "a/b", "a\\b", "C:secret", "bad\x00name", "bad\r\nname", "%2e%2e%2fsecret", "   "])
async def test_names_reject_path_attacks(admin, name):
    assert (await admin.post(f"{PREFIX}/folders", json={"name": name})).status_code == 422
    assert (await admin.post(f"{PREFIX}/uploads", json={"name": name, "size": 0})).status_code == 422


async def test_invalid_uuid_and_patch_cannot_write_internal_fields(admin):
    entry = await folder(admin)
    for payload in [{"name": None}, {"kind": "file"}, {"deleted_at": "2026-01-01"}, {"parent_id": "../x"}, {"name": "../x"}]:
        assert (await admin.patch(f"{PREFIX}/entries/{entry['id']}", json=payload)).status_code == 422
    assert (await admin.get(f"{PREFIX}/uploads/not-a-uuid")).status_code == 422
    assert (await admin.patch(f"{PREFIX}/entries/{entry['id']}", json={"parent_id": str(uuid4())})).status_code == 404


async def test_deleted_parent_blocks_new_entries_and_completion_until_restored(admin):
    parent = await folder(admin)
    session = await upload(admin, parent_id=parent["id"])
    await admin.delete(f"{PREFIX}/entries/{parent['id']}")
    assert (await admin.post(f"{PREFIX}/uploads/{session['id']}/complete")).status_code == 409
    assert (await admin.post(f"{PREFIX}/folders", json={"name": "x", "parent_id": parent["id"]})).status_code == 409
    assert (await admin.post(f"{PREFIX}/entries/{parent['id']}/restore")).status_code == 200
    assert (await complete(admin, session))["parent_id"] == parent["id"]


async def test_concurrent_quota_initialization_does_not_overbook(admin, monkeypatch):
    monkeypatch.setattr(settings, "LIBRARY_QUOTA_BYTES", 10)
    responses = await asyncio.gather(*[admin.post(f"{PREFIX}/uploads", json={"name": str(i), "size": 6}) for i in range(5)])
    assert sorted(response.status_code for response in responses) == [200, 409, 409, 409, 409]


async def test_concurrent_completion_returns_one_entry(admin):
    session = await upload(admin, b"concurrent")
    responses = await asyncio.gather(*[admin.post(f"{PREFIX}/uploads/{session['id']}/complete") for _ in range(4)])
    assert [response.status_code for response in responses] == [200] * 4
    assert len({response.json()["id"] for response in responses}) == 1
    assert len((await admin.get(f"{PREFIX}/entries")).json()["items"]) == 1


async def test_cancellation_waits_for_streaming_part_and_cleans_it(admin, private_storage):
    response = await admin.post(f"{PREFIX}/uploads", json={"name": "race", "size": 4})
    assert response.status_code == 200
    session_id = response.json()["id"]
    entered, finish = asyncio.Event(), asyncio.Event()

    async def body():
        yield b"ab"
        entered.set()
        await finish.wait()
        yield b"cd"

    part = asyncio.create_task(admin.put(f"{PREFIX}/uploads/{session_id}/parts/0", content=body()))
    await asyncio.wait_for(entered.wait(), 5)
    cancel = asyncio.create_task(admin.delete(f"{PREFIX}/uploads/{session_id}"))
    await asyncio.sleep(0.05)
    assert not cancel.done()
    finish.set()
    results = await asyncio.gather(part, cancel)
    assert [result.status_code for result in results] == [204, 204]
    assert (await admin.post(f"{PREFIX}/uploads/{session_id}/complete")).status_code == 410
    assert not (private_storage / "sessions" / session_id).exists()


async def test_disconnected_or_oversized_stream_never_replaces_good_part(admin):
    session = await upload(admin, b"good")
    path = f"{PREFIX}/uploads/{session['id']}/parts/0"

    async def interrupted():
        yield b"ba"
        raise httpx.ReadError("interrupted")

    with pytest.raises(httpx.ReadError):
        await admin.put(path, content=interrupted())
    async def too_long():
        yield b"1234"
        yield b"5"
    assert (await admin.put(path, content=too_long())).status_code == 400
    entry = await complete(admin, session)
    assert (await admin.get(f"{PREFIX}/entries/{entry['id']}/download")).content == b"good"


async def test_expired_cleanup_releases_reservation_and_keeps_completed_objects(admin, session_factory, private_storage):
    from app.models.library import LibraryUpload
    from app.services.library import cleanup_expired_sessions

    stale = await upload(admin, b"stale")
    done = await complete(admin, await upload(admin, b"keep"))
    async with session_factory() as db:
        row = await db.get(LibraryUpload, UUID(stale["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    assert (await admin.get(f"{PREFIX}/uploads/{stale['id']}")).status_code == 410
    assert (await admin.put(f"{PREFIX}/uploads/{stale['id']}/parts/0", content=b"stale")).status_code == 410
    assert await cleanup_expired_sessions(session_factory) == 1
    assert not (private_storage / "sessions" / stale["id"]).exists()
    assert (await admin.get(f"{PREFIX}/entries/{done['id']}/download")).content == b"keep"


async def test_filesystem_symlink_cannot_publish_or_download_outside_root(admin, private_storage, tmp_path):
    entry = await complete(admin, await upload(admin, b"real"))
    object_path = private_storage / "objects" / entry["id"]
    outside = tmp_path / "outside"
    outside.write_bytes(b"secret")
    object_path.unlink()
    object_path.symlink_to(outside)
    assert (await admin.get(f"{PREFIX}/entries/{entry['id']}/download")).status_code == 409
    assert outside.read_bytes() == b"secret"


@pytest.mark.parametrize("public_key", ["UPLOAD_DIR", "PUBLIC_MEDIA_DIR"])
@pytest.mark.parametrize("relationship", ["same", "inside", "ancestor", "symlink"])
def test_private_storage_rejects_overlap_in_either_direction(tmp_path, public_key, relationship):
    public = tmp_path / "public"
    public.mkdir()
    private = {"same": public, "inside": public / "private", "ancestor": tmp_path, "symlink": tmp_path / "alias"}[relationship]
    if relationship == "symlink":
        private.symlink_to(public, target_is_directory=True)
    with pytest.raises(ValueError, match="PRIVATE_STORAGE_DIR"):
        Settings(_env_file=None, **{public_key: str(public), "PRIVATE_STORAGE_DIR": str(private)})


def test_library_migration_only_changes_its_own_tables(tmp_path):
    from sqlalchemy import create_engine, inspect

    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as connection:
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        import importlib.util
        migration_path = Path(__file__).parents[1] / "alembic/versions/library_v1_private_storage.py"
        spec = importlib.util.spec_from_file_location("library_migration", migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        connection.exec_driver_sql("CREATE TABLE unrelated (id INTEGER PRIMARY KEY, value TEXT)")
        connection.exec_driver_sql("INSERT INTO unrelated VALUES (1, 'keep')")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert {"library_entries", "library_uploads"} <= set(inspect(connection).get_table_names())
            migration.downgrade()
        assert inspect(connection).get_table_names() == ["unrelated"]
        assert connection.exec_driver_sql("SELECT value FROM unrelated").scalar() == "keep"
    engine.dispose()


async def test_completion_waits_for_current_part_and_cancel_race_is_consistent(admin):
    initialized = await admin.post(f"{PREFIX}/uploads", json={"name": "race", "size": 4})
    assert initialized.status_code == 200
    upload_id = initialized.json()["id"]
    entered, finish = asyncio.Event(), asyncio.Event()

    async def body():
        yield b"ab"
        entered.set()
        await finish.wait()
        yield b"cd"

    part = asyncio.create_task(admin.put(f"{PREFIX}/uploads/{upload_id}/parts/0", content=body()))
    await asyncio.wait_for(entered.wait(), 5)
    completion = asyncio.create_task(admin.post(f"{PREFIX}/uploads/{upload_id}/complete"))
    await asyncio.sleep(0.05)
    assert not completion.done()
    finish.set()
    assert (await part).status_code == 204
    entry = (await completion).json()
    assert entry["size"] == 4
    assert (await admin.get(f"{PREFIX}/entries/{entry['id']}/download")).content == b"abcd"
    assert (await admin.delete(f"{PREFIX}/uploads/{upload_id}")).status_code == 409


async def test_concurrent_folder_moves_cannot_form_cycle(admin):
    one, two = await folder(admin, "one"), await folder(admin, "two")
    responses = await asyncio.gather(
        admin.patch(f"{PREFIX}/entries/{one['id']}", json={"parent_id": two["id"]}),
        admin.patch(f"{PREFIX}/entries/{two['id']}", json={"parent_id": one["id"]}),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]


async def test_storage_failure_never_exposes_half_file_and_retry_succeeds(admin, monkeypatch):
    from app.services.library_storage import PrivateStorage

    session = await upload(admin, b"whole")
    original = PrivateStorage.publish

    def disk_failure(self, temporary, entry_id):
        raise OSError(errno.ENOSPC, "test disk full")

    monkeypatch.setattr(PrivateStorage, "publish", disk_failure)
    response = await admin.post(f"{PREFIX}/uploads/{session['id']}/complete")
    assert response.status_code == 507
    assert (await admin.get(f"{PREFIX}/entries")).json()["items"] == []
    assert (await admin.get(f"{PREFIX}/uploads/{session['id']}")).json()["received_parts"] == [0]
    monkeypatch.setattr(PrivateStorage, "publish", original)
    entry = await complete(admin, session)
    assert (await admin.get(f"{PREFIX}/entries/{entry['id']}/download")).content == b"whole"


async def test_cleanup_reclaims_orphaned_object_after_publish_before_db_commit_crash(admin, session_factory, private_storage):
    from app.models.library import LibraryUpload
    from app.services.library import cleanup_expired_sessions

    session = await upload(admin, b"orphan")
    object_path = private_storage / "objects" / session["id"]
    object_path.parent.mkdir(exist_ok=True)
    object_path.write_bytes(b"orphan")
    async with session_factory() as db:
        row = await db.get(LibraryUpload, UUID(session["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    assert await cleanup_expired_sessions(session_factory) == 1
    assert not object_path.exists()


async def test_forged_or_corrupt_parts_cannot_complete(admin, private_storage):
    session = await upload(admin, b"good")
    path = private_storage / "sessions" / session["id"] / "0.part"
    path.write_bytes(b"shortened")
    assert (await admin.post(f"{PREFIX}/uploads/{session['id']}/complete")).status_code == 409
    assert (await admin.get(f"{PREFIX}/uploads/{session['id']}")).json()["received_parts"] == []
    path.unlink()
    path.symlink_to(Path(__file__))
    assert (await admin.post(f"{PREFIX}/uploads/{session['id']}/complete")).status_code == 409


async def test_cleanup_cli_operates_only_on_test_database(admin, session_factory, private_storage):
    from app.models.library import LibraryUpload

    session = await upload(admin, b"stale-cli")
    async with session_factory() as db:
        row = await db.get(LibraryUpload, UUID(session["id"]))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    bind = session_factory.kw["bind"]
    env = {**os.environ, "DATABASE_URL": bind.url.render_as_string(hide_password=False),
           "PRIVATE_STORAGE_DIR": str(private_storage), "ENVIRONMENT": "test"}
    # Preserve the isolated schema in a separately launched PostgreSQL connection.
    if bind.dialect.name == "postgresql":
        pytest.skip("CLI uses default schema; exercised against isolated SQLite instead")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "app.services.library_cleanup",
        cwd=str(Path(__file__).parents[1]), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), 15)
    assert process.returncode == 0, stderr.decode()
    assert "Expired upload sessions cleaned: 1" in stdout.decode()
    assert not (private_storage / "sessions" / session["id"]).exists()


async def test_private_session_directory_symlink_is_rejected(admin, private_storage, tmp_path):
    session = await upload(admin, b"data")
    directory = private_storage / "sessions" / session["id"]
    (directory / "0.part").unlink()
    directory.rmdir()
    outside = tmp_path / "outside-directory"
    outside.mkdir()
    (outside / "keep").write_bytes(b"keep")
    directory.symlink_to(outside, target_is_directory=True)
    assert (await admin.get(f"{PREFIX}/uploads/{session['id']}")).status_code == 409
    assert (outside / "keep").read_bytes() == b"keep"
