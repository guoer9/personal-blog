from typing import Optional, List, Tuple
import os
import uuid
import aiofiles
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.file import File
from app.core.config import settings


async def get_file_by_id(db: AsyncSession, file_id: int) -> Optional[File]:
    """通过 ID 获取文件"""
    result = await db.execute(
        select(File)
        .options(selectinload(File.uploader))
        .where(File.id == file_id)
    )
    return result.scalar_one_or_none()


async def get_file_by_filename(db: AsyncSession, filename: str) -> Optional[File]:
    """通过文件名获取文件"""
    result = await db.execute(
        select(File)
        .options(selectinload(File.uploader))
        .where(File.filename == filename)
    )
    return result.scalar_one_or_none()


async def get_files(
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20
) -> Tuple[List[File], int]:
    """获取文件列表（分页）"""
    query = select(File).options(
        selectinload(File.uploader)
    ).order_by(File.created_at.desc())
    
    count_query = select(func.count(File.id))
    
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    result = await db.execute(query)
    files = result.scalars().all()
    
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    
    return list(files), total


async def save_upload_file(
    db: AsyncSession,
    upload_file: UploadFile,
    uploader_id: Optional[int] = None
) -> File:
    """保存上传的文件"""
    # 生成唯一文件名
    file_ext = os.path.splitext(upload_file.filename)[1].lower()
    unique_filename = f"{uuid.uuid4().hex}{file_ext}"
    
    # 确保上传目录存在
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    
    # 文件路径
    file_path = os.path.join(settings.UPLOAD_DIR, unique_filename)
    
    bytes_written = 0
    try:
        async with aiofiles.open(file_path, 'wb') as f:
            while chunk := await upload_file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > settings.MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "文件大小超过限制（最大 "
                            f"{settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB）"
                        ),
                    )
                await f.write(chunk)
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
    
    # 创建数据库记录
    file_record = File(
        filename=unique_filename,
        original_name=upload_file.filename,
        file_path=file_path,
        size=bytes_written,
        mime_type=upload_file.content_type,
        uploader_id=uploader_id,
    )
    
    db.add(file_record)
    await db.flush()
    await db.refresh(file_record)
    
    return file_record


async def delete_file(db: AsyncSession, file: File) -> None:
    """删除文件"""
    # 删除物理文件
    if os.path.exists(file.file_path):
        os.remove(file.file_path)
    
    # 删除数据库记录
    await db.delete(file)
    await db.flush()
