"""Prepare copies of explicitly selected library files; never publish raw MOV."""
import json
import math
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import subprocess
from uuid import uuid4

import anyio
from fastapi import HTTPException
from app.models.work import WorkAsset
from app.models.work import Work
from app.core.config import settings
from sqlalchemy import select
from app.services.library import LibraryService
from app.services.library_storage import PrivateStorage
from app.services.works import asset_path


@asynccontextmanager
async def publication_write(db):
    # All local workers share this lock; keep it through the database commit.
    async with PrivateStorage().lock('work-assets'):
        if db.in_transaction():
            await db.rollback()
        try:
            yield
            await db.commit()
        except BaseException:
            await db.rollback()
            raise


def storage_status():
    directory = asset_path(uuid4()).parent
    used = 0
    for path in directory.iterdir():
        if path.is_symlink() or not path.is_file():
            raise HTTPException(409, '发布素材目录含不安全条目')
        used += path.stat().st_size
    return {'used_bytes': used, 'quota_bytes': settings.WORK_ASSET_QUOTA_BYTES}


async def cleanup_assets(db):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    references = set()
    for work in (await db.scalars(select(Work))).all():
        for snapshot in (work.draft, work.published):
            if snapshot:
                references.update(snapshot[role + '_asset_id'] for role in ('cover', 'audio', 'video') if snapshot.get(role + '_asset_id'))
    records = {str(asset.id): asset for asset in (await db.scalars(select(WorkAsset))).all()}
    directory = asset_path(uuid4()).parent
    removed = 0
    for path in directory.iterdir():
        from uuid import UUID
        try:
            key = str(UUID(path.stem if path.suffix == '.tmp' else path.name))
        except ValueError:
            continue
        asset = records.get(key)
        if path.is_symlink() or not path.is_file() or key in references or path.stat().st_mtime > cutoff.timestamp():
            continue
        if asset and (asset.created_at.replace(tzinfo=timezone.utc) if asset.created_at.tzinfo is None else asset.created_at) > cutoff:
            continue
        path.unlink()
        if asset and path.suffix != '.tmp':
            await db.delete(asset)
        removed += 1
    await db.flush()
    return {'removed': removed, **storage_status()}


def inspect(path, role):
    executable = os.environ.get("FFPROBE_BIN", "ffprobe")
    try:
        result = subprocess.run([executable, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height", "-of", "json", str(path)], capture_output=True, text=True, timeout=20, check=True)
        data = json.loads(result.stdout)
    except FileNotFoundError:
        raise HTTPException(503, "本地缺少 ffprobe，请先安装媒体工具或设置 FFPROBE_BIN") from None
    except (subprocess.SubprocessError, ValueError):
        raise HTTPException(400, "无法识别素材，请选择有效的图片或网页播放文件") from None
    streams = data.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    with open(path, "rb") as source:
        header = source.read(128)
    duration = None
    if role == "cover":
        mime = "image/jpeg" if header.startswith(b"\xff\xd8\xff") else "image/png" if header.startswith(b"\x89PNG\r\n\x1a\n") else "image/webp" if header[:4] == b"RIFF" and header[8:12] == b"WEBP" else None
        if not mime or len(video) != 1 or video[0].get("codec_name") not in {"mjpeg", "png", "webp"} or path.stat().st_size > 10 * 1024**2:
            raise HTTPException(400, "封面仅接受10MiB以内的 JPEG、PNG、WebP 图片")
    else:
        try:
            duration = float(data["format"]["duration"])
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "媒体时长无效") from None
        if role == "video":
            # ISO base media brand is checked as ffprobe identifies MOV and MP4 as one family.
            if header[4:8] != b"ftyp" or header[8:12] not in {b"isom", b"iso2", b"mp41", b"mp42", b"avc1"} or len(video) != 1 or video[0].get("codec_name") != "h264" or any(s.get("codec_name") != "aac" for s in audio):
                raise HTTPException(400, "视频需要 H.264/AAC 的 MP4 网页播放版，MOV 原件请先导出")
            mime = "video/mp4"
        else:
            if not audio or any(s.get("codec_name") not in {"aac", "mp3"} for s in audio):
                raise HTTPException(400, "音频需要 AAC/M4A 或 MP3 格式")
            if any(s.get("codec_name") != "mjpeg" for s in video):
                raise HTTPException(400, "请选择纯音频文件")
            is_mp3 = audio[0].get("codec_name") == "mp3" and data.get("format", {}).get("format_name") == "mp3"
            if not is_mp3 and (header[4:8] != b"ftyp" or header[8:12] not in {b"M4A ", b"isom", b"mp42", b"mp41"}):
                raise HTTPException(400, "音频需要 M4A 或 MP3 容器")
            mime = "audio/mpeg" if is_mp3 else "audio/mp4"
    return mime, duration


async def prepare(db, entry_id, role):
    entry, source = await LibraryService(db).open_download(entry_id)
    if entry.size > 512 * 1024**2:
        source.close()
        raise HTTPException(413, "首版单个发布素材最多512MiB；原件可留在私有文件库")
    if storage_status()['used_bytes'] + entry.size > settings.WORK_ASSET_QUOTA_BYTES:
        source.close()
        raise HTTPException(409, '发布素材空间不足，请在作品管理清理过期且未引用的副本')
    asset_id = uuid4()
    destination = asset_path(asset_id)
    temporary = destination.with_suffix(".tmp")
    try:
        def copy():
            with source, open(temporary, "xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
        await anyio.to_thread.run_sync(copy)
        if temporary.stat().st_size != entry.size:
            raise HTTPException(409, "素材复制长度不匹配")
        mime, duration = await anyio.to_thread.run_sync(inspect, temporary, role)
        temporary.replace(destination)
        asset = WorkAsset(id=asset_id, source_entry_id=entry_id, role=role, mime_type=mime, duration=duration, size=entry.size)
        db.add(asset)
        await db.flush()
        return asset
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    finally:
        source.close()
        temporary.unlink(missing_ok=True)
