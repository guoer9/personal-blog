"""Visitor transfers use real disk storage and the public HTTP contract."""

import hashlib
import json
import os
import subprocess
import tracemalloc

import httpx
import pytest
import pytest_asyncio

from app.core.config import settings
from app.main import app

PREFIX = "/api/v1/transfers"
GIB = 1024**3
CHUNK = 8 * 1024**2


@pytest.fixture
def transfer_root(tmp_path, monkeypatch):
    root = tmp_path / "transfers"
    monkeypatch.setitem(settings.__dict__, "TRANSFER_STORAGE_DIR", str(root))
    return root


@pytest_asyncio.fixture
async def visitor(transfer_root):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        yield client


async def create(visitor, size=4, **changes):
    return await visitor.post(PREFIX + "/uploads", json={
        "filename": "example.bin", "size": size,
        "fingerprint": hashlib.sha256(b"data").hexdigest(), **changes,
    })


def browser_sample_fingerprint(filename, data, modified_ms):
    length = min(len(data), 65536)
    offsets = list(dict.fromkeys([0, (len(data) - length) // 2, len(data) - length]))
    metadata = json.dumps([filename, len(data), modified_ms, offsets], separators=(",", ":")).encode()
    samples = b"".join(data[offset:offset + length] for offset in offsets)
    return "sha256:" + hashlib.sha256(metadata + samples).hexdigest()


@pytest.mark.asyncio
async def test_public_config_and_no_public_inventory(visitor):
    response = await visitor.get(PREFIX + "/config")
    assert response.status_code == 200
    assert response.json() == {
        "max_file_bytes": 10737418240, "chunk_bytes": 8388608, "retention_seconds": 21600,
    }
    assert (await visitor.get(PREFIX + "/uploads")).status_code in (404, 405)
    assert (await visitor.get(PREFIX)).status_code == 404


@pytest.mark.asyncio
async def test_rejects_over_ten_gib_before_reserving_disk(visitor, transfer_root):
    response = await create(visitor, 10737418241)
    assert response.status_code == 413
    assert not list(transfer_root.glob("objects/*"))


@pytest.mark.asyncio
async def test_exact_ten_gib_reserves_without_allocating_the_file(visitor, transfer_root):
    tracemalloc.start()
    try:
        response = await create(visitor, 10737418240)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert response.status_code == 201, response.text
    upload = response.json()
    assert {"upload_id", "upload_token", "code", "chunk_bytes", "expires_at"} <= upload.keys()
    assert peak < 16 * 1024**2
    assert sum(p.stat().st_size for p in transfer_root.rglob("*") if p.is_file()) < 1024**2
    status = await visitor.get(PREFIX + "/uploads/" + upload["upload_id"],
                               headers={"X-Upload-Token": upload["upload_token"]})
    assert status.status_code == 200
    assert status.json()["size"] == 10737418240
    assert status.json()["received_bytes"] == 0


@pytest.mark.asyncio
async def test_credentials_are_returned_once_and_only_their_hashes_reach_disk(visitor, transfer_root):
    response = await create(visitor)
    assert response.status_code == 201
    upload = response.json()
    stored = b"".join(path.read_bytes() for path in transfer_root.rglob("*") if path.is_file())
    assert upload["upload_token"].encode() not in stored
    assert upload["code"].encode() not in stored


@pytest.mark.asyncio
async def test_upload_token_is_required_for_status_chunks_and_cancel(visitor):
    upload = (await create(visitor)).json()
    path = f"{PREFIX}/uploads/{upload['upload_id']}"
    assert (await visitor.get(path)).status_code == 401
    assert (await visitor.get(path, headers={"X-Upload-Token": "wrong"})).status_code == 403
    assert (await visitor.put(path + "/chunks/0", content=b"data")).status_code == 401
    assert (await visitor.delete(path)).status_code == 401


@pytest.mark.asyncio
async def test_raw_chunks_are_sequential_and_same_chunk_retry_is_idempotent(visitor):
    data = b"a" * CHUNK + b"tail"
    upload = (await create(visitor, size=len(data), fingerprint=hashlib.sha256(data).hexdigest())).json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.put(url + "/chunks/1", content=b"tail", headers=headers)).status_code == 409
    first = await visitor.put(url + "/chunks/0", content=b"a" * CHUNK, headers=headers)
    assert first.status_code == 204
    assert (await visitor.put(url + "/chunks/0", content=b"a" * CHUNK, headers=headers)).status_code == 204
    assert (await visitor.put(url + "/chunks/0", content=b"b" * CHUNK, headers=headers)).status_code == 409
    assert (await visitor.get(url, headers=headers)).json()["received_bytes"] == CHUNK
    assert (await visitor.put(url + "/chunks/1", content=b"tail", headers=headers)).status_code == 204
    assert (await visitor.get(url, headers=headers)).json()["received_bytes"] == len(data)


@pytest.mark.asyncio
async def test_completed_file_lookup_has_short_ticket_and_supports_attachment_ranges(visitor):
    data = b"temporary visitor transfer"
    upload = (await create(visitor, size=len(data), fingerprint=hashlib.sha256(data).hexdigest())).json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.post(url + "/complete", headers=headers)).status_code == 409
    assert (await visitor.put(url + "/chunks/0", content=data, headers=headers)).status_code == 204
    assert (await visitor.post(url + "/complete", headers=headers)).status_code == 200
    assert (await visitor.post(PREFIX + "/lookup", json={"code": "not a real code"})).status_code == 404
    found = await visitor.post(PREFIX + "/lookup", json={"code": upload["code"]})
    assert found.status_code == 200
    result = found.json()
    assert result["filename"] == "example.bin" and result["size"] == len(data)
    assert upload["code"] not in result["download_url"]
    assert "/download/" in result["download_url"]
    downloaded = await visitor.get(result["download_url"], headers={"Range": "bytes=3-8"})
    assert downloaded.status_code == 206 and downloaded.content == data[3:9]
    assert downloaded.headers["content-range"] == f"bytes 3-8/{len(data)}"
    assert "attachment" in downloaded.headers["content-disposition"]
    assert downloaded.headers["cache-control"] == "private, no-store"
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    full = await visitor.get(result["download_url"])
    assert full.status_code == 200 and full.content == data


@pytest.mark.asyncio
async def test_browser_sample_fingerprint_finishes_and_returns_frontend_status(visitor):
    filename = "browser-workflow.bin"
    data = b"browser metadata-and-samples fingerprint workflow"
    fingerprint = browser_sample_fingerprint(filename, data, 1700000000123)
    assert fingerprint.startswith("sha256:") and len(fingerprint) == 71
    response = await visitor.post(PREFIX + "/uploads", json={
        "filename": filename, "size": len(data), "fingerprint": fingerprint,
    })
    assert response.status_code == 201, response.text
    upload = response.json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.put(url + "/chunks/0", content=data, headers=headers)).status_code == 204
    completed = await visitor.post(url + "/complete", headers=headers)
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["received_bytes"] == len(data)
    assert (await visitor.get(url, headers=headers)).json() == completed.json()


@pytest.mark.asyncio
async def test_expired_upload_cannot_be_accessed_and_cleanup_removes_its_files(visitor, transfer_root, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.services import transfers

    upload = (await create(visitor)).json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.put(url + "/chunks/0", content=b"data", headers=headers)).status_code == 204
    future = datetime.now(timezone.utc) + timedelta(hours=7)
    monkeypatch.setattr(transfers, "utc_now", lambda: future)
    assert (await visitor.get(url, headers=headers)).status_code == 410
    from app.services.transfers import TransferService
    assert await TransferService().cleanup_expired() == 1
    assert not list(transfer_root.glob("uploads/*"))


@pytest.mark.asyncio
async def test_expired_download_ticket_and_transfer_code_are_rejected(visitor, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.services import transfers

    data = b"data"
    upload = (await create(visitor)).json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    await visitor.put(url + "/chunks/0", content=data, headers=headers)
    await visitor.post(url + "/complete", headers=headers)
    found = (await visitor.post(PREFIX + "/lookup", json={"code": upload["code"]})).json()
    future = datetime.now(timezone.utc) + timedelta(hours=7)
    monkeypatch.setattr(transfers, "utc_now", lambda: future)
    assert (await visitor.post(PREFIX + "/lookup", json={"code": upload["code"]})).status_code == 404
    assert (await visitor.get(found["download_url"])).status_code == 410


@pytest.mark.asyncio
async def test_six_hour_download_retention_starts_at_successful_completion(visitor, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.services import transfers

    started = datetime.now(timezone.utc)
    data = b"complete later"
    upload = (await create(visitor, size=len(data), fingerprint=browser_sample_fingerprint(
        "example.bin", data, 1700000000123,
    ))).json()
    url = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.put(url + "/chunks/0", content=data, headers=headers)).status_code == 204
    completed_at = started + timedelta(hours=5, minutes=59)
    monkeypatch.setattr(transfers, "utc_now", lambda: completed_at)
    result = await visitor.post(url + "/complete", headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["expires_at"] == (completed_at + timedelta(hours=6)).isoformat()
    monkeypatch.setattr(transfers, "utc_now", lambda: completed_at + timedelta(hours=5, minutes=59))
    assert (await visitor.get(url, headers=headers)).status_code == 200
    monkeypatch.setattr(transfers, "utc_now", lambda: completed_at + timedelta(hours=6, seconds=1))
    assert (await visitor.get(url, headers=headers)).status_code == 410


@pytest.mark.asyncio
async def test_fifty_gib_quota_counts_incomplete_reservations(visitor, monkeypatch):
    monkeypatch.setattr(settings, "TRANSFER_MAX_ACTIVE_PER_SOURCE", 10, raising=False)
    for _ in range(5):
        response = await create(visitor, 10737418240)
        assert response.status_code == 201, response.text
    over_quota = await create(visitor, 1)
    assert over_quota.status_code == 507


@pytest.mark.asyncio
async def test_persistent_per_source_rate_limit_is_bounded(visitor, monkeypatch):
    monkeypatch.setattr(settings, "TRANSFER_MAX_ACTIVE_PER_SOURCE", 10)
    for _ in range(10):
        response = await create(visitor, 1)
        assert response.status_code == 201, response.text
    assert (await create(visitor, 1)).status_code == 429


@pytest.mark.asyncio
async def test_cancel_releases_quota_and_removes_session(visitor, transfer_root):
    upload = (await create(visitor, 10737418240)).json()
    path = f"{PREFIX}/uploads/{upload['upload_id']}"
    headers = {"X-Upload-Token": upload["upload_token"]}
    assert (await visitor.delete(path, headers=headers)).status_code == 204
    assert (await visitor.get(path, headers=headers)).status_code == 404
    assert not list(transfer_root.glob(f"uploads/{upload['upload_id']}"))


@pytest.mark.asyncio
async def test_cross_process_reservations_share_the_posix_quota_lock(tmp_path):
    root = tmp_path / "shared-transfers"
    child = """
import asyncio
from fastapi import HTTPException
from app.services.transfers import TransferService
async def main():
    try:
        await TransferService().create_upload('x.bin', 7, 'a' * 64, 'worker-source')
        print('created')
    except HTTPException as error:
        print(error.status_code)
asyncio.run(main())
"""
    env = {
        **os.environ,
        "TRANSFER_STORAGE_DIR": str(root),
        "TRANSFER_QUOTA_BYTES": "10",
        "TRANSFER_MAX_ACTIVE_PER_SOURCE": "10",
    }
    processes = [
        subprocess.Popen(
            [str(__import__("sys").executable), "-c", child],
            cwd=__import__("pathlib").Path(__file__).parents[1],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(2)
    ]
    results = []
    for process in processes:
        stdout, stderr = process.communicate(timeout=20)
        assert process.returncode == 0, stderr
        results.append(stdout.strip())
    assert sorted(results) == ["507", "created"]
