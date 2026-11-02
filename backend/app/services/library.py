"""Transactional library operations and stale-upload cleanup.

File locks protect disk operations across processes. PostgreSQL additionally uses a
transaction advisory lock; SQLite starts an IMMEDIATE transaction. Every metadata
transaction starts after obtaining the file lock, including the commit, so a waiter
cannot read a stale snapshot or oversubscribe the quota. Authentication's earlier
read transaction is ended before entering this boundary.
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import anyio
from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.core.config import settings
from app.models.library import LibraryEntry, LibraryUpload
from app.schemas.library import EntryResponse, UploadResponse
from app.services.library_storage import CHUNK_SIZE, PrivateStorage, part_count

logger = logging.getLogger(__name__)
METADATA_LOCK_ID = 723091478205461


def utcnow():
    return datetime.now(timezone.utc)


def as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class LibraryService:
    def __init__(self, db):
        self.db = db
        self.storage = PrivateStorage()

    @asynccontextmanager
    async def transaction(self):
        await self.db.rollback()
        async with self.storage.lock("metadata"):
            try:
                dialect = self.db.get_bind().dialect.name
                if dialect == "postgresql":
                    await self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": METADATA_LOCK_ID})
                elif dialect == "sqlite":
                    await self.db.execute(text("BEGIN IMMEDIATE"))
                else:
                    raise RuntimeError("Private library supports PostgreSQL and SQLite only")
                yield
                await self.db.commit()
            except BaseException:
                await self.db.rollback()
                raise

    async def entry(self, entry_id: UUID, *, active=False):
        result = await self.db.execute(select(LibraryEntry).where(LibraryEntry.id == entry_id).with_for_update().execution_options(populate_existing=True))
        entry = result.scalar_one_or_none()
        if entry is None or (active and entry.deleted_at is not None):
            raise HTTPException(404, "Library entry not found")
        return entry

    async def valid_parent(self, parent_id: UUID | None, moving_id: UUID | None = None):
        seen = set()
        while parent_id is not None:
            if parent_id == moving_id or parent_id in seen:
                raise HTTPException(409, "A folder cannot be moved into itself or its descendants")
            seen.add(parent_id)
            parent = await self.entry(parent_id)
            if parent.kind != "folder" or parent.deleted_at is not None:
                raise HTTPException(409, "Parent must be an active folder; restore its ancestors first")
            parent_id = parent.parent_id

    async def descendants(self, entry_id):
        tree = select(LibraryEntry.id).where(LibraryEntry.id == entry_id).cte("library_tree", recursive=True)
        tree = tree.union_all(select(LibraryEntry.id).join(tree, LibraryEntry.parent_id == tree.c.id))
        return (await self.db.scalars(select(LibraryEntry).where(LibraryEntry.id.in_(select(tree.c.id))))).all()

    async def list_entries(self, parent_id=None, trash=False):
        async with self.transaction():
            query = select(LibraryEntry)
            if trash:
                query = query.where(LibraryEntry.deleted_at.is_not(None))
                if parent_id is not None:
                    query = query.where(LibraryEntry.parent_id == parent_id)
            else:
                await self.valid_parent(parent_id)
                query = query.where(LibraryEntry.deleted_at.is_(None), LibraryEntry.parent_id == parent_id)
            entries = (await self.db.scalars(query.order_by(LibraryEntry.kind.desc(), LibraryEntry.name, LibraryEntry.id))).all()
            return {"items": [EntryResponse.model_validate(row) for row in entries]}

    async def used_bytes(self):
        return await self.db.scalar(select(func.coalesce(func.sum(LibraryEntry.size), 0)).where(LibraryEntry.kind == "file"))

    async def status(self):
        async with self.transaction():
            return {"used_bytes": await self.used_bytes(), "quota_bytes": settings.LIBRARY_QUOTA_BYTES,
                    "max_file_bytes": settings.LIBRARY_MAX_FILE_BYTES, "chunk_size": CHUNK_SIZE}

    async def create_folder(self, data):
        async with self.transaction():
            await self.valid_parent(data.parent_id)
            entry = LibraryEntry(name=data.name, kind="folder", parent_id=data.parent_id, size=0)
            self.db.add(entry)
            await self.db.flush()
            return EntryResponse.model_validate(entry)

    async def update_entry(self, entry_id, data):
        async with self.transaction():
            entry = await self.entry(entry_id, active=True)
            if "parent_id" in data.model_fields_set:
                await self.valid_parent(data.parent_id, entry_id)
                entry.parent_id = data.parent_id
            if "name" in data.model_fields_set:
                entry.name = data.name
            await self.db.flush()
            return EntryResponse.model_validate(entry)

    async def delete_entry(self, entry_id):
        async with self.transaction():
            entry = await self.entry(entry_id)
            if entry.deleted_at is not None:
                return
            now, batch = utcnow(), uuid4()
            for descendant in await self.descendants(entry_id):
                if descendant.deleted_at is None:
                    descendant.deleted_at = now
                    descendant.trash_batch_id = batch

    async def restore_entry(self, entry_id):
        async with self.transaction():
            entry = await self.entry(entry_id)
            await self.valid_parent(entry.parent_id)
            if entry.deleted_at is not None:
                batch = entry.trash_batch_id
                for descendant in await self.descendants(entry_id):
                    if descendant.trash_batch_id == batch:
                        descendant.deleted_at = None
                        descendant.trash_batch_id = None
                await self.db.flush()
            return EntryResponse.model_validate(entry)

    async def upload(self, upload_id, *, allow_completed=False, allow_terminal=False):
        result = await self.db.execute(select(LibraryUpload).where(LibraryUpload.id == upload_id).with_for_update().execution_options(populate_existing=True))
        upload = result.scalar_one_or_none()
        if upload is None:
            raise HTTPException(404, "Upload session not found")
        if allow_terminal:
            return upload
        if upload.state == "completed":
            if allow_completed:
                return upload
            raise HTTPException(409, "Upload has already completed")
        if upload.state != "pending" or as_utc(upload.expires_at) <= utcnow():
            raise HTTPException(410, "Upload session has expired or was cancelled")
        return upload

    async def upload_response(self, upload):
        parts = (list(range(part_count(upload.size))) if upload.state == "completed"
                 else await anyio.to_thread.run_sync(self.storage.received_parts, upload))
        return UploadResponse(id=upload.id, chunk_size=CHUNK_SIZE, received_parts=parts, expires_at=as_utc(upload.expires_at))

    async def init_upload(self, data):
        if data.size > settings.LIBRARY_MAX_FILE_BYTES:
            raise HTTPException(413, "File exceeds the private library per-file limit")
        async with self.transaction():
            await self.valid_parent(data.parent_id)
            reserved = await self.db.scalar(select(func.coalesce(func.sum(LibraryUpload.size), 0)).where(
                LibraryUpload.state == "pending", LibraryUpload.expires_at > utcnow()))
            if await self.used_bytes() + reserved + data.size > settings.LIBRARY_QUOTA_BYTES:
                raise HTTPException(409, "Private library quota exceeded, including pending uploads and trash")
            upload = LibraryUpload(name=data.name, size=data.size, mime_type=data.mime_type, parent_id=data.parent_id,
                                   expires_at=utcnow() + timedelta(seconds=settings.LIBRARY_SESSION_TTL_SECONDS))
            self.db.add(upload)
            await self.db.flush()
            return await self.upload_response(upload)

    async def get_upload(self, upload_id):
        async with self.storage.lock(str(upload_id)):
            async with self.transaction():
                return await self.upload_response(await self.upload(upload_id, allow_completed=True))

    async def put_part(self, upload_id, index, request):
        async with self.storage.lock(str(upload_id)):
            async with self.transaction():
                upload = await self.upload(upload_id)
            await self.storage.write_part(upload, index, request)

    async def complete_upload(self, upload_id):
        async with self.storage.lock(str(upload_id)):
            async with self.transaction():
                upload = await self.upload(upload_id, allow_completed=True)
                if upload.state == "completed":
                    return EntryResponse.model_validate(await self.entry(upload.completed_entry_id))
                await self.valid_parent(upload.parent_id)
            # Large sequential I/O happens off the event loop, with only this session locked.
            temporary = await anyio.to_thread.run_sync(self.storage.assemble, upload)
            try:
                async with self.transaction():
                    upload = await self.upload(upload_id)
                    await self.valid_parent(upload.parent_id)
                    entry = LibraryEntry(id=upload.id, name=upload.name, kind="file", size=upload.size,
                                         mime_type=upload.mime_type, parent_id=upload.parent_id)
                    await anyio.to_thread.run_sync(self.storage.publish, temporary, entry.id)
                    self.db.add(entry)
                    await self.db.flush()
                    upload.state = "completed"
                    upload.completed_entry_id = entry.id
                    result = EntryResponse.model_validate(entry)
            finally:
                temporary.unlink(missing_ok=True)
            # DB commit precedes part cleanup. Retrying a committed complete is always safe.
            await self.clean_session(upload_id)
            return result

    async def clean_session(self, upload_id):
        try:
            await anyio.to_thread.run_sync(self.storage.remove_session_files, upload_id)
        except (OSError, HTTPException):
            # Cleanup CLI retries residue. Do not turn a committed completion into an error.
            logger.warning("Private library session cleanup deferred: %s", upload_id)

    async def cancel_upload(self, upload_id):
        async with self.storage.lock(str(upload_id)):
            async with self.transaction():
                upload = await self.upload(upload_id, allow_terminal=True)
                if upload.state == "completed":
                    raise HTTPException(409, "Completed uploads cannot be cancelled; trash the entry instead")
                upload.state = "cancelled"
                await self.clean_orphan_object(upload_id)
            await self.clean_session(upload_id)

    async def clean_orphan_object(self, upload_id):
        if await self.db.get(LibraryEntry, upload_id) is None:
            await anyio.to_thread.run_sync(self.storage.remove_orphan_object, upload_id)

    async def open_download(self, entry_id):
        from app.services.library_storage import open_regular

        async with self.transaction():
            entry = await self.entry(entry_id, active=True)
            if entry.kind != "file":
                raise HTTPException(409, "Folders cannot be downloaded")
            file = await anyio.to_thread.run_sync(open_regular, self.storage.object_path(entry.id))
            if os.fstat(file.fileno()).st_size != entry.size:
                file.close()
                raise HTTPException(409, "Stored file length is invalid")
            return EntryResponse.model_validate(entry), file


async def cleanup_expired_sessions(session_factory):
    """Expire pending sessions and retry terminal-session disk cleanup under their locks."""
    async with session_factory() as db:
        service = LibraryService(db)
        async with service.transaction():
            ids = list((await db.scalars(select(LibraryUpload.id).where(
                (LibraryUpload.expires_at <= utcnow()) | (LibraryUpload.state != "pending")))).all())
        expired = 0
        for upload_id in ids:
            async with service.storage.lock(str(upload_id)):
                async with service.transaction():
                    upload = await service.upload(upload_id, allow_terminal=True)
                    if upload.state == "pending":
                        if as_utc(upload.expires_at) > utcnow():
                            continue
                        upload.state = "expired"
                        expired += 1
                    if upload.state != "completed":
                        await service.clean_orphan_object(upload_id)
                await service.clean_session(upload_id)
        return expired
