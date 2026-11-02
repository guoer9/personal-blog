"""Temporary visitor transfers backed by a shared local POSIX filesystem."""

import asyncio
import anyio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import stat
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4

import fcntl
from fastapi import HTTPException, Request

from app.core.config import settings

IO_BLOCK_BYTES = 1024 * 1024
TICKET_LOG_MARKER = "/transfers/download/"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def _file(path: Path, flags: int = os.O_RDONLY, mode: int = 0o600):
    descriptor = os.open(path, flags | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, mode)
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise HTTPException(409, "Transfer storage object is unavailable")
    return os.fdopen(descriptor, "rb" if flags == os.O_RDONLY else "r+b")


class TransferAccessLogFilter(logging.Filter):
    """Hide short-lived bearer tickets from the standard Uvicorn access log."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple):
            redacted = list(args)
            changed = False
            for index, value in enumerate(redacted):
                if isinstance(value, str) and TICKET_LOG_MARKER in value:
                    redacted[index] = value.split(TICKET_LOG_MARKER, 1)[0] + TICKET_LOG_MARKER + "<redacted>"
                    changed = True
            if changed:
                record.args = tuple(redacted)
        return True


class TransferService:
    def __init__(self, storage_root: str | Path | None = None):
        settings.validate_storage_paths()
        configured = storage_root if storage_root is not None else settings.TRANSFER_STORAGE_DIR
        self.root = Path(configured).expanduser().resolve()
        self.uploads = self.root / "uploads"
        self.locks = self.root / "locks"
        self.database = self.root / "state.sqlite3"
        self._prepare_storage()

    def _prepare_storage(self) -> None:
        for directory in (self.root, self.uploads, self.locks):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not stat.S_ISDIR(directory.lstat().st_mode):
                raise OSError("Transfer storage directory is unsafe")
            os.chmod(directory, 0o700)
        lock_path = self.locks / "metadata.lock"
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError("Transfer metadata lock is unsafe")
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            if self.database.is_symlink():
                raise OSError("Transfer metadata database is unsafe")
            with self._database() as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA synchronous=FULL")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS uploads (
                        id TEXT PRIMARY KEY,
                        filename TEXT NOT NULL,
                        size INTEGER NOT NULL,
                        fingerprint_hash TEXT NOT NULL,
                        source_hash TEXT NOT NULL,
                        code_hash TEXT NOT NULL UNIQUE,
                        token_hash TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('uploading', 'completed')),
                        received_bytes INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS chunks (
                        upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
                        chunk_index INTEGER NOT NULL,
                        digest TEXT NOT NULL,
                        length INTEGER NOT NULL,
                        PRIMARY KEY(upload_id, chunk_index)
                    );
                    CREATE TABLE IF NOT EXISTS sources (
                        source_hash TEXT PRIMARY KEY,
                        create_times TEXT NOT NULL DEFAULT '[]',
                        lookup_times TEXT NOT NULL DEFAULT '[]',
                        last_seen REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires_at);
                    CREATE INDEX IF NOT EXISTS uploads_source ON uploads(source_hash, status, expires_at);
                    """
                )
                for suffix in ("", "-wal", "-shm"):
                    path = Path(str(self.database) + suffix)
                    if path.exists():
                        os.chmod(path, 0o600)
        finally:
            os.close(descriptor)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def _database(self):
        connection = self._connect()
        try:
            yield connection
        except BaseException:
            if connection.in_transaction:
                connection.rollback()
            raise
        finally:
            connection.close()

    @asynccontextmanager
    async def _lock(self, name: str):
        if name != "metadata":
            name = str(UUID(name))
        path = self.locks / f"{name}.lock"
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise HTTPException(409, "Transfer lock is unavailable")
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.01)
            yield
        finally:
            os.close(descriptor)

    @asynccontextmanager
    async def _metadata(self):
        async with self._lock("metadata"):
            yield

    def _session_directory(self, upload_id: str) -> Path:
        path = self.uploads / str(UUID(upload_id))
        path.mkdir(mode=0o700, exist_ok=True)
        if not stat.S_ISDIR(path.lstat().st_mode):
            raise HTTPException(409, "Transfer session is unavailable")
        return path

    def _source_hash(self, source: str) -> str:
        return hmac.new(settings.SECRET_KEY.encode(), source.encode(), hashlib.sha256).hexdigest()

    def _source_event(self, connection: sqlite3.Connection, source_hash: str, event: str, now: float) -> list[float]:
        row = connection.execute("SELECT * FROM sources WHERE source_hash=?", (source_hash,)).fetchone()
        if row is None:
            count = connection.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
            if count >= settings.TRANSFER_MAX_TRACKED_SOURCES:
                raise HTTPException(429, "Transfer service is busy; try again later")
            creates: list[float] = []
            lookups: list[float] = []
        else:
            creates = json.loads(row["create_times"])
            lookups = json.loads(row["lookup_times"])
        window = 3600 if event == "create_times" else 60
        values = creates if event == "create_times" else lookups
        values[:] = [stamp for stamp in values if now - stamp < window]
        limit = settings.TRANSFER_CREATES_PER_HOUR if event == "create_times" else settings.TRANSFER_LOOKUPS_PER_MINUTE
        if len(values) >= limit:
            raise HTTPException(429, "Transfer request rate exceeded")
        values.append(now)
        if event == "create_times":
            creates = values
        else:
            lookups = values
        connection.execute(
            "INSERT INTO sources(source_hash,create_times,lookup_times,last_seen) VALUES(?,?,?,?) "
            "ON CONFLICT(source_hash) DO UPDATE SET create_times=excluded.create_times, "
            "lookup_times=excluded.lookup_times, last_seen=excluded.last_seen",
            (source_hash, json.dumps(creates, separators=(",", ":")),
             json.dumps(lookups, separators=(",", ":")), now),
        )
        return values

    @staticmethod
    def _begin(connection: sqlite3.Connection) -> None:
        connection.execute("BEGIN IMMEDIATE")

    def _upload_response(self, row: sqlite3.Row) -> dict:
        return {
            "upload_id": row["id"],
            "received_bytes": row["received_bytes"],
            "size": row["size"],
            "status": row["status"],
            "expires_at": _timestamp(row["expires_at"]),
        }

    def _require_token(self, row: sqlite3.Row, token: str | None) -> None:
        if not token:
            raise HTTPException(401, "Upload token required")
        if not hmac.compare_digest(row["token_hash"], _digest(token)):
            raise HTTPException(403, "Upload token is invalid")

    def _lookup_upload(self, connection: sqlite3.Connection, upload_id: str, token: str | None = None) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Transfer not found")
        if token is not None or not token:
            self._require_token(row, token)
        return row

    def _remove_session_files(self, upload_id: str) -> None:
        directory = self.uploads / str(UUID(upload_id))
        try:
            if not stat.S_ISDIR(directory.lstat().st_mode):
                raise HTTPException(409, "Transfer session is unsafe")
        except FileNotFoundError:
            return
        for path in directory.iterdir():
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                raise HTTPException(409, "Transfer session contains an unsafe directory")
            path.unlink(missing_ok=True)
        directory.rmdir()

    def _expire_locked(self, connection: sqlite3.Connection, row: sqlite3.Row) -> None:
        try:
            self._remove_session_files(row["id"])
        except FileNotFoundError:
            pass
        connection.execute("DELETE FROM uploads WHERE id=?", (row["id"],))
        lock_path = self.locks / f"{row['id']}.lock"
        lock_path.unlink(missing_ok=True)

    def _check_expiry(self, connection: sqlite3.Connection, row: sqlite3.Row) -> None:
        if row["expires_at"] <= utc_now().timestamp():
            self._expire_locked(connection, row)
            raise HTTPException(410, "Transfer has expired")

    async def create_upload(self, filename: str, size: int, fingerprint: str, source: str) -> dict:
        if size < 1 or size > settings.TRANSFER_MAX_FILE_BYTES:
            raise HTTPException(413, "File exceeds the 10 GiB transfer limit")
        now = utc_now().timestamp()
        source_hash = self._source_hash(source)
        upload_id = str(uuid4())
        token = secrets.token_urlsafe(32)
        code = secrets.token_urlsafe(12)
        expires_at = now + settings.TRANSFER_RETENTION_SECONDS
        async with self._metadata():
            with self._database() as connection:
                self._begin(connection)
                self._source_event(connection, source_hash, "create_times", now)
                active = connection.execute(
                    "SELECT COUNT(*) FROM uploads WHERE source_hash=? AND status='uploading' AND expires_at>?",
                    (source_hash, now),
                ).fetchone()[0]
                if active >= settings.TRANSFER_MAX_ACTIVE_PER_SOURCE:
                    connection.rollback()
                    raise HTTPException(429, "Too many active transfers from this source")
                active_total = connection.execute(
                    "SELECT COUNT(*) FROM uploads WHERE expires_at>?", (now,)
                ).fetchone()[0]
                reserved = connection.execute(
                    "SELECT COALESCE(SUM(size),0) FROM uploads WHERE expires_at>?", (now,)
                ).fetchone()[0]
                if active_total >= settings.TRANSFER_MAX_UPLOADS:
                    connection.rollback()
                    raise HTTPException(507, "Transfer capacity is full")
                if reserved + size > settings.TRANSFER_QUOTA_BYTES:
                    connection.rollback()
                    raise HTTPException(507, "Transfer storage quota is full")
                connection.execute(
                    "INSERT INTO uploads(id,filename,size,fingerprint_hash,source_hash,code_hash,token_hash,created_at,expires_at,status) "
                    "VALUES(?,?,?,?,?,?,?,?,?,'uploading')",
                    (upload_id, filename, size, _digest(fingerprint), source_hash, _digest(code),
                     _digest(token), now, expires_at),
                )
                connection.commit()
        self._session_directory(upload_id)
        return {
            "upload_id": upload_id,
            "upload_token": token,
            "code": code,
            "chunk_bytes": settings.TRANSFER_CHUNK_BYTES,
            "expires_at": _timestamp(expires_at),
        }

    async def get_upload(self, upload_id: str, token: str | None) -> dict:
        upload_id = str(UUID(upload_id))
        async with self._lock(upload_id):
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    row = self._lookup_upload(connection, upload_id, token)
                    self._check_expiry(connection, row)
                    result = self._upload_response(row)
                    connection.commit()
                    return result

    async def put_chunk(self, upload_id: str, token: str | None, index: int, request: Request) -> None:
        upload_id = str(UUID(upload_id))
        if index < 0:
            raise HTTPException(400, "Chunk index is invalid")
        async with self._lock(upload_id):
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    row = self._lookup_upload(connection, upload_id, token)
                    self._check_expiry(connection, row)
                    if row["status"] != "uploading":
                        raise HTTPException(409, "Transfer is already complete")
                    chunk_bytes = settings.TRANSFER_CHUNK_BYTES
                    count = (row["size"] + chunk_bytes - 1) // chunk_bytes
                    if index >= count:
                        raise HTTPException(400, "Chunk index is outside the declared file")
                    expected = min(chunk_bytes, row["size"] - index * chunk_bytes)
                    existing = connection.execute(
                        "SELECT digest,length FROM chunks WHERE upload_id=? AND chunk_index=?",
                        (upload_id, index),
                    ).fetchone()
                    next_index = connection.execute(
                        "SELECT COUNT(*) FROM chunks WHERE upload_id=?", (upload_id,)
                    ).fetchone()[0]
                    if existing is None and index != next_index:
                        raise HTTPException(409, "Chunks must be uploaded sequentially")
                    connection.commit()

            length = request.headers.get("content-length")
            if length is not None and (not length.isdecimal() or len(length) > 20 or int(length) != expected):
                raise HTTPException(400, "Chunk length does not match the declared file")
            directory = self._session_directory(upload_id)
            temporary = directory / f"{uuid4().hex}.incoming"
            descriptor = os.open(
                temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600
            )
            received = 0
            chunk_hash = hashlib.sha256()
            try:
                with os.fdopen(descriptor, "wb") as staged:
                    async for body in request.stream():
                        for start in range(0, len(body), IO_BLOCK_BYTES):
                            block = body[start:start + IO_BLOCK_BYTES]
                            received += len(block)
                            if received > expected:
                                raise HTTPException(400, "Chunk exceeds its declared length")
                            chunk_hash.update(block)
                            await anyio.to_thread.run_sync(staged.write, block)
                    if received != expected:
                        raise HTTPException(400, "Chunk length does not match the declared file")
                    await anyio.to_thread.run_sync(staged.flush)
                    await anyio.to_thread.run_sync(os.fsync, staged.fileno())
                digest = chunk_hash.hexdigest()
                if existing is not None:
                    if existing["length"] != received or not hmac.compare_digest(existing["digest"], digest):
                        raise HTTPException(409, "Chunk retry does not match the stored bytes")
                    return

                payload_path = directory / "payload.part"
                descriptor = os.open(
                    payload_path,
                    os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                )
                try:
                    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                        raise HTTPException(409, "Transfer payload is unsafe")
                    offset = index * settings.TRANSFER_CHUNK_BYTES
                    with open(temporary, "rb") as staged:
                        while True:
                            block = await anyio.to_thread.run_sync(staged.read, IO_BLOCK_BYTES)
                            if not block:
                                break
                            position = offset
                            view = memoryview(block)
                            while view:
                                written = await anyio.to_thread.run_sync(os.pwrite, descriptor, view, position)
                                if written <= 0:
                                    raise OSError("Transfer storage write failed")
                                position += written
                                view = view[written:]
                            offset += len(block)
                    await anyio.to_thread.run_sync(os.fsync, descriptor)
                finally:
                    os.close(descriptor)
                async with self._metadata():
                    with self._database() as connection:
                        self._begin(connection)
                        current = self._lookup_upload(connection, upload_id, token)
                        self._check_expiry(connection, current)
                        if current["status"] != "uploading":
                            raise HTTPException(409, "Transfer is already complete")
                        connection.execute(
                            "INSERT INTO chunks(upload_id,chunk_index,digest,length) VALUES(?,?,?,?)",
                            (upload_id, index, digest, received),
                        )
                        connection.execute(
                            "UPDATE uploads SET received_bytes=received_bytes+? WHERE id=?",
                            (received, upload_id),
                        )
                        connection.commit()
            finally:
                temporary.unlink(missing_ok=True)

    async def complete_upload(self, upload_id: str, token: str | None) -> dict:
        upload_id = str(UUID(upload_id))
        async with self._lock(upload_id):
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    row = self._lookup_upload(connection, upload_id, token)
                    self._check_expiry(connection, row)
                    if row["status"] == "completed":
                        result = {
                            "received_bytes": row["received_bytes"],
                            "size": row["size"],
                            "status": "completed",
                            "expires_at": _timestamp(row["expires_at"]),
                        }
                        connection.commit()
                        return result
                    if row["received_bytes"] != row["size"]:
                        raise HTTPException(409, "Upload is incomplete")
                    chunks = connection.execute(
                        "SELECT chunk_index,length,digest FROM chunks WHERE upload_id=? ORDER BY chunk_index",
                        (upload_id,),
                    ).fetchall()
                    count = (row["size"] + settings.TRANSFER_CHUNK_BYTES - 1) // settings.TRANSFER_CHUNK_BYTES
                    if len(chunks) != count or any(
                        item["chunk_index"] != index
                        or item["length"] != min(settings.TRANSFER_CHUNK_BYTES, row["size"] - index * settings.TRANSFER_CHUNK_BYTES)
                        for index, item in enumerate(chunks)
                    ):
                        raise HTTPException(409, "Upload chunks are incomplete")
                    connection.commit()

            directory = self._session_directory(upload_id)
            payload = directory / "payload.part"
            completed = directory / "payload"
            source_path = completed if completed.exists() else payload
            try:
                with _file(source_path) as source_file:
                    info = os.fstat(source_file.fileno())
                    if info.st_size != row["size"]:
                        raise HTTPException(409, "Stored transfer size is invalid")
                    chunk_bytes = settings.TRANSFER_CHUNK_BYTES
                    for index, item in enumerate(chunks):
                        remaining = item["length"]
                        offset = index * chunk_bytes
                        chunk_hash = hashlib.sha256()
                        while remaining:
                            block = await anyio.to_thread.run_sync(
                                source_file.read, min(IO_BLOCK_BYTES, remaining)
                            )
                            if not block:
                                raise HTTPException(409, "Stored transfer is incomplete")
                            chunk_hash.update(block)
                            remaining -= len(block)
                        if not hmac.compare_digest(chunk_hash.hexdigest(), item["digest"]):
                            raise HTTPException(409, "Stored transfer chunk failed verification")
                    if source_file.read(1):
                        raise HTTPException(409, "Stored transfer size changed")
            except FileNotFoundError:
                raise HTTPException(409, "Stored transfer is incomplete") from None
            if source_path == payload:
                os.replace(payload, completed)
                directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    current = self._lookup_upload(connection, upload_id, token)
                    if current["status"] == "completed":
                        connection.commit()
                        return {
                            "received_bytes": current["received_bytes"],
                            "size": current["size"],
                            "status": "completed",
                            "expires_at": _timestamp(current["expires_at"]),
                        }
                    completed_at = utc_now().timestamp()
                    expires_at = completed_at + settings.TRANSFER_RETENTION_SECONDS
                    connection.execute(
                        "UPDATE uploads SET status='completed',expires_at=? WHERE id=?",
                        (expires_at, upload_id),
                    )
                    connection.commit()
                    return {
                        "received_bytes": current["received_bytes"],
                        "size": current["size"],
                        "status": "completed",
                        "expires_at": _timestamp(expires_at),
                    }

    async def cancel_upload(self, upload_id: str, token: str | None) -> None:
        upload_id = str(UUID(upload_id))
        async with self._lock(upload_id):
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    row = self._lookup_upload(connection, upload_id, token)
                    self._check_expiry(connection, row)
                    self._remove_session_files(upload_id)
                    connection.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
                    connection.commit()
            (self.locks / f"{upload_id}.lock").unlink(missing_ok=True)

    def _ticket(self, upload_id: str, expires_at: int) -> str:
        payload = f"{upload_id}.{expires_at}".encode("ascii")
        encoded = base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")
        signature = hmac.new(settings.SECRET_KEY.encode(), encoded.encode("ascii"), hashlib.sha256).digest()
        return encoded + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")

    def _verify_ticket(self, ticket: str) -> tuple[str, int]:
        try:
            encoded, signature = ticket.split(".", 1)
            supplied = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
            expected = hmac.new(settings.SECRET_KEY.encode(), encoded.encode("ascii"), hashlib.sha256).digest()
            if not hmac.compare_digest(supplied, expected):
                raise ValueError
            payload = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("ascii")
            upload_id, expiry = payload.rsplit(".", 1)
            return str(UUID(upload_id)), int(expiry)
        except (ValueError, UnicodeError, TypeError):
            raise HTTPException(404, "Download ticket is invalid") from None

    async def lookup(self, code: str, source: str, api_prefix: str) -> dict:
        now = utc_now().timestamp()
        async with self._metadata():
            with self._database() as connection:
                self._begin(connection)
                source_hash = self._source_hash(source)
                self._source_event(connection, source_hash, "lookup_times", now)
                row = connection.execute(
                    "SELECT * FROM uploads WHERE code_hash=? AND status='completed' AND expires_at>?",
                    (_digest(code), now),
                ).fetchone()
                connection.commit()
                if row is None:
                    raise HTTPException(404, "Transfer code is invalid or expired")
                ticket_expiry = min(
                    int(now) + settings.TRANSFER_DOWNLOAD_TICKET_SECONDS,
                    int(row["expires_at"]),
                )
                ticket = self._ticket(row["id"], ticket_expiry)
                return {
                    "filename": row["filename"],
                    "size": row["size"],
                    "expires_at": _timestamp(row["expires_at"]),
                    "download_url": f"{api_prefix}/transfers/download/{ticket}",
                }

    @staticmethod
    def _range(range_header: str | None, size: int) -> tuple[int, int, int]:
        if range_header is None:
            return 200, 0, size - 1
        try:
            unit, value = range_header.split("=", 1)
            if unit.strip().lower() != "bytes" or "," in value:
                raise ValueError
            first, last = value.split("-", 1)
            if not first:
                suffix = int(last)
                if suffix <= 0:
                    raise ValueError
                start = max(size - suffix, 0)
                end = size - 1
            else:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
                if start < 0 or end < start or start >= size:
                    raise ValueError
            return 206, start, end
        except (ValueError, TypeError):
            raise HTTPException(416, "Requested byte range is not satisfiable", headers={"Content-Range": f"bytes */{size}"}) from None

    async def open_download(self, ticket: str, range_header: str | None):
        upload_id, ticket_expiry = self._verify_ticket(ticket)
        now = int(utc_now().timestamp())
        if now >= ticket_expiry:
            raise HTTPException(410, "Download ticket has expired")
        async with self._lock(upload_id):
            async with self._metadata():
                with self._database() as connection:
                    self._begin(connection)
                    row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
                    if row is None or row["status"] != "completed":
                        raise HTTPException(404, "Completed transfer not found")
                    self._check_expiry(connection, row)
                    if ticket_expiry > row["expires_at"]:
                        raise HTTPException(404, "Download ticket is invalid")
                    status_code, start, end = self._range(range_header, row["size"])
                    path = self.uploads / upload_id / "payload"
                    try:
                        file_obj = _file(path)
                    except FileNotFoundError:
                        raise HTTPException(404, "Completed transfer not found") from None
                    if os.fstat(file_obj.fileno()).st_size != row["size"]:
                        file_obj.close()
                        raise HTTPException(409, "Completed transfer size is invalid")
                    connection.commit()
                    file_obj.seek(start)
                    return row, file_obj, status_code, start, end

    async def cleanup_expired(self) -> int:
        now = utc_now().timestamp()
        async with self._metadata():
            with self._database() as connection:
                ids = [row[0] for row in connection.execute("SELECT id FROM uploads WHERE expires_at<=?", (now,))]
                connection.execute("DELETE FROM sources WHERE last_seen<=?", (now - settings.TRANSFER_SOURCE_TTL_SECONDS,))
        removed = 0
        for upload_id in ids:
            async with self._lock(upload_id):
                async with self._metadata():
                    with self._database() as connection:
                        self._begin(connection)
                        row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
                        if row is None or row["expires_at"] > utc_now().timestamp():
                            connection.commit()
                            continue
                        try:
                            self._remove_session_files(upload_id)
                        except (FileNotFoundError, OSError, HTTPException):
                            connection.rollback()
                            continue
                        connection.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
                        connection.commit()
                        removed += 1
                (self.locks / f"{upload_id}.lock").unlink(missing_ok=True)
        await self._cleanup_orphan_sessions()
        return removed

    async def _cleanup_orphan_sessions(self) -> None:
        try:
            candidates = list(self.uploads.iterdir())
        except FileNotFoundError:
            return
        for directory in candidates:
            try:
                upload_id = str(UUID(directory.name))
            except ValueError:
                continue
            async with self._lock(upload_id):
                async with self._metadata():
                    with self._database() as connection:
                        row = connection.execute("SELECT 1 FROM uploads WHERE id=?", (upload_id,)).fetchone()
                        if row is None:
                            try:
                                self._remove_session_files(upload_id)
                            except (FileNotFoundError, OSError, HTTPException):
                                pass
                        else:
                            try:
                                for child in directory.iterdir():
                                    if child.name.endswith(".incoming"):
                                        info = child.lstat()
                                        if not stat.S_ISDIR(info.st_mode):
                                            child.unlink(missing_ok=True)
                            except (FileNotFoundError, OSError):
                                pass

    async def cleanup_loop(self) -> None:
        await self.cleanup_expired()
        while True:
            await asyncio.sleep(60)
            await self.cleanup_expired()


@lru_cache(maxsize=16)
def service_for_root(storage_root: str) -> TransferService:
    return TransferService(storage_root)


def get_transfer_service() -> TransferService:
    root = str(Path(settings.TRANSFER_STORAGE_DIR).expanduser().resolve())
    return service_for_root(root)
