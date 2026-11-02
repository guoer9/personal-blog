"""Private, UUID-addressed storage. Never mount this directory with StaticFiles.

Local POSIX filesystems only. All workers must use the same root and database.
Lock order is session file lock -> metadata file lock -> database transaction lock.
Lock files are permanent: unlinking one would let different processes lock different inodes.
"""

import asyncio
import errno
import fcntl
import os
import stat
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import anyio
from fastapi import HTTPException, Request

from app.core.config import settings

CHUNK_SIZE = 8 * 1024 * 1024
IO_BLOCK_SIZE = 1024 * 1024


def conflict():
    return HTTPException(409, "Private storage object is unavailable or unsafe")


def open_regular(path: Path, flags=os.O_RDONLY):
    try:
        fd = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise conflict()
        return os.fdopen(fd, "rb" if flags == os.O_RDONLY else "wb")
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.ENOENT, errno.ENOTDIR):
            raise conflict() from None
        raise


class PrivateStorage:
    def __init__(self):
        settings.validate_storage_paths()
        self.root = Path(settings.PRIVATE_STORAGE_DIR).expanduser().resolve()

    def directory(self, *components: str) -> Path:
        path = self.root
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        for component in components:
            path = path / component
            try:
                path.mkdir(mode=0o700, exist_ok=True)
                if not stat.S_ISDIR(path.lstat().st_mode):
                    raise conflict()
            except (FileExistsError, NotADirectoryError):
                raise conflict() from None
        return path

    def session_directory(self, session_id: UUID) -> Path:
        return self.directory("sessions", str(UUID(str(session_id))))

    def object_path(self, entry_id: UUID) -> Path:
        return self.directory("objects") / str(UUID(str(entry_id)))

    @asynccontextmanager
    async def lock(self, key: str):
        # key is always a UUID or the internal literal 'metadata'.
        path = self.directory("locks") / f"{key}.lock"
        try:
            fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        except OSError:
            raise conflict() from None
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise conflict()
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.01)
            yield
        finally:
            os.close(fd)

    def received_parts(self, upload) -> list[int]:
        directory = self.session_directory(upload.id)
        result = []
        for path in directory.iterdir():
            if not path.name.endswith(".part") or not path.stem.isdecimal():
                continue
            index = int(path.stem)
            if index >= part_count(upload.size):
                continue
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_size == part_length(upload.size, index):
                result.append(index)
        return sorted(result)

    async def write_part(self, upload, index: int, request: Request):
        expected = part_length(upload.size, index)
        if expected is None:
            raise HTTPException(400, "Part index is outside the declared file")
        length = request.headers.get("content-length")
        if length is not None and (len(length) > 20 or not length.isdecimal() or int(length) != expected):
            raise HTTPException(400, "Part length does not match the declared file")
        directory = self.session_directory(upload.id)
        temporary = directory / f"{uuid4()}.tmp"
        file = open_regular(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        received = 0
        try:
            async for chunk in request.stream():
                received += len(chunk)
                if received > expected:
                    raise HTTPException(400, "Part exceeds its expected length")
                for start in range(0, len(chunk), IO_BLOCK_SIZE):
                    await anyio.to_thread.run_sync(file.write, chunk[start:start + IO_BLOCK_SIZE])
            if received != expected:
                raise HTTPException(400, "Part length does not match the declared file")
            await anyio.to_thread.run_sync(file.flush)
            await anyio.to_thread.run_sync(os.fsync, file.fileno())
            file.close()
            os.replace(temporary, directory / f"{index}.part")
            fsync_directory(directory)
        finally:
            file.close()
            temporary.unlink(missing_ok=True)

    def assemble(self, upload) -> Path:
        directory = self.session_directory(upload.id)
        if self.received_parts(upload) != list(range(part_count(upload.size))):
            raise HTTPException(409, "Upload parts are incomplete or have invalid lengths")
        temporary = directory / f"{uuid4()}.assembling"
        try:
            with open_regular(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL) as output:
                total = 0
                for index in range(part_count(upload.size)):
                    with open_regular(directory / f"{index}.part") as part:
                        expected = part_length(upload.size, index)
                        if os.fstat(part.fileno()).st_size != expected:
                            raise HTTPException(409, "Upload part length changed")
                        remaining = expected
                        while remaining:
                            block = part.read(min(IO_BLOCK_SIZE, remaining))
                            if not block:
                                raise HTTPException(409, "Upload part ended early")
                            output.write(block)
                            total += len(block)
                            remaining -= len(block)
                        if part.read(1):
                            raise HTTPException(409, "Upload part grew during completion")
                if total != upload.size:
                    raise HTTPException(409, "Assembled file length is invalid")
                output.flush()
                os.fsync(output.fileno())
            return temporary
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise

    def publish(self, temporary: Path, entry_id: UUID):
        target = self.object_path(entry_id)
        if target.is_symlink():
            raise conflict()
        os.replace(temporary, target)
        fsync_directory(target.parent)

    def remove_orphan_object(self, entry_id: UUID):
        # Caller holds metadata lock and has verified no library entry references this UUID.
        target = self.object_path(entry_id)
        target.unlink(missing_ok=True)
        fsync_directory(target.parent)

    def remove_session_files(self, session_id: UUID):
        # Only UUID session directories and generated files; never follow symlinks.
        directory = self.session_directory(session_id)
        for path in directory.iterdir():
            if path.is_dir() and not path.is_symlink():
                raise conflict()
            path.unlink(missing_ok=True)
        directory.rmdir()


def fsync_directory(directory: Path):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def part_count(size: int) -> int:
    return (size + CHUNK_SIZE - 1) // CHUNK_SIZE


def part_length(size: int, index: int) -> int | None:
    if index < 0 or index >= part_count(size):
        return None
    return min(CHUNK_SIZE, size - index * CHUNK_SIZE)
