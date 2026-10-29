from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict
from app.schemas.user import UserBrief


# 文件响应
class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    original_name: str
    file_path: str
    size: int
    mime_type: Optional[str] = None
    uploader: Optional[UserBrief] = None
    created_at: datetime
    
# 文件上传响应
class FileUploadResponse(BaseModel):
    id: int
    filename: str
    original_name: str
    url: str
    size: int
    mime_type: Optional[str] = None


# 文件列表响应
class FilePaginatedResponse(BaseModel):
    items: List[FileResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
