import os
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.file import FileUploadResponse, FileResponse as FileResponseSchema, FilePaginatedResponse
from app.crud.file import (
    save_upload_file, get_file_by_filename, get_file_by_id,
    get_files, delete_file
)
from app.api.deps import get_current_user, get_current_admin
from app.models.user import User
from app.core.config import settings

router = APIRouter()


def validate_file(file: UploadFile) -> None:
    """验证上传的文件"""
    # 检查文件大小
    # 注意：实际文件大小检查需要在读取内容后进行
    
    # 检查文件扩展名
    if file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in settings.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的文件类型。允许的类型: {', '.join(settings.ALLOWED_EXTENSIONS)}"
            )


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """上传文件"""
    # 验证文件
    validate_file(file)
    
    # 读取内容检查大小
    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件大小超过限制（最大 {settings.MAX_UPLOAD_SIZE // 1024 // 1024}MB）"
        )
    
    # 重置文件指针
    await file.seek(0)
    
    # 保存文件
    uploader_id = current_user.id if current_user else None
    file_record = await save_upload_file(db, file, uploader_id)
    
    return FileUploadResponse(
        id=file_record.id,
        filename=file_record.filename,
        original_name=file_record.original_name,
        url=f"/uploads/{file_record.filename}",
        size=file_record.size,
        mime_type=file_record.mime_type,
    )


@router.get("/list", response_model=FilePaginatedResponse)
async def list_files(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """获取文件列表（管理员）"""
    files, total = await get_files(db, page, page_size)
    
    return FilePaginatedResponse(
        items=files,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total > 0 else 0
    )


@router.get("/{filename}")
async def download_file(
    filename: str,
    db: AsyncSession = Depends(get_db)
):
    """下载/访问文件"""
    file_record = await get_file_by_filename(db, filename)
    
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件不存在"
        )
    
    if not os.path.exists(file_record.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件不存在"
        )
    
    return FileResponse(
        path=file_record.file_path,
        filename=file_record.original_name,
        media_type=file_record.mime_type,
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """删除文件（管理员）"""
    file_record = await get_file_by_id(db, file_id)
    
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件不存在"
        )
    
    await delete_file(db, file_record)
    return None
