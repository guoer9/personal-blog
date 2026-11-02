"""Explicit draft/publication snapshots. Public projections never expose source IDs."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.work import Work, WorkAsset
from app.schemas.work import AdminWork, PublicWork, WorkDraft

ROLES = ("cover", "video", "audio")


def asset_path(asset_id):
    root = Path(settings.PUBLIC_MEDIA_DIR).expanduser().resolve()
    directory = root / "assets"
    if directory.is_symlink():
        raise HTTPException(409, "素材目录不可用")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return directory / str(UUID(str(asset_id)))


async def record(db, work_id):
    result = await db.scalar(select(Work).where(Work.id == work_id).execution_options(populate_existing=True))
    if result is None:
        raise HTTPException(404, "作品不存在")
    return result


async def create(db, data):
    work = Work(slug=data.slug, draft=data.model_dump(mode="json", exclude={"slug"}))
    db.add(work)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "此作品短链已被使用") from None
    return work


async def change(db, work_id, version, values):
    result = await db.execute(update(Work).where(Work.id == work_id, Work.version == version).values(
        **values, version=version + 1, updated_at=datetime.now(timezone.utc)
    ).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        await record(db, work_id)
        raise HTTPException(409, "作品已在其他页面修改，请重新载入后再操作")
    return await record(db, work_id)


async def validate_assets(db, draft, *, publishing=False):
    assets = {}
    for role in ROLES:
        value = draft.get(role + "_asset_id")
        if value:
            asset = await db.get(WorkAsset, UUID(value))
            if asset is None or asset.role != role:
                raise HTTPException(409, f"{role}素材不存在或类型不匹配")
            path = asset_path(asset.id)
            if path.is_symlink() or not path.is_file() or path.stat().st_size != asset.size:
                raise HTTPException(409, "发布素材缺失，请重新准备")
            assets[role] = asset
    if publishing:
        if not draft["description"].strip():
            raise HTTPException(409, "请填写作品简介后再发布")
        if draft["category"] == "code" and not draft.get("repository"):
            raise HTTPException(409, "代码作品需要仓库链接")
        if draft["category"] == "film" and not {"cover", "video"}.issubset(assets):
            raise HTTPException(409, "影像作品需要封面和网页播放视频")
        if draft["category"] == "music" and ("cover" not in assets or not ("audio" in assets or "video" in assets)):
            raise HTTPException(409, "音乐作品需要封面以及音频或视频")
    return assets


async def publish(db, work_id, version):
    work = await record(db, work_id)
    await validate_assets(db, work.draft, publishing=True)
    return await change(db, work_id, version, {"published": deepcopy(work.draft), "published_at": datetime.now(timezone.utc)})


async def project(db, work, *, preview=False):
    data = deepcopy(work.draft if preview else work.published)
    assets = {}
    for role in ROLES:
        asset_id = data.pop(role + "_asset_id", None)
        if asset_id:
            asset = await db.get(WorkAsset, UUID(asset_id))
            assets[role] = asset
            if asset is not None:
                prefix = "/admin/work-assets" if preview else "/work-assets"
                data[role] = settings.API_V1_PREFIX + prefix + "/" + str(asset.id)
    timed = assets.get("video") or assets.get("audio")
    data["duration"] = timed.duration if timed else None
    return PublicWork(slug=work.slug, **data)


async def public_asset(db, asset_id):
    work_rows = (await db.scalars(select(Work).where(Work.published.is_not(None)))).all()
    if not any(work.published and any(work.published.get(role + "_asset_id") == str(asset_id) for role in ROLES) for work in work_rows):
        raise HTTPException(404, "素材未公开")
    return await get_asset(db, asset_id)


async def get_asset(db, asset_id):
    asset = await db.get(WorkAsset, asset_id)
    if asset is None:
        raise HTTPException(404, "素材不存在")
    path = asset_path(asset.id)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != asset.size:
        raise HTTPException(404, "素材不存在")
    return asset, path
