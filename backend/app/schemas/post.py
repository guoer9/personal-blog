from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from app.schemas.user import UserBrief


# 标签模式
class TagBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class TagCreate(TagBase):
    pass


class TagResponse(TagBase):
    id: int
    slug: str
    
    class Config:
        from_attributes = True


# 文章基础模式
class PostBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str
    summary: Optional[str] = Field(None, max_length=500)
    cover_image: Optional[str] = None


# 文章创建
class PostCreate(PostBase):
    is_published: bool = False
    tag_ids: List[int] = []


# 文章更新
class PostUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = None
    summary: Optional[str] = Field(None, max_length=500)
    cover_image: Optional[str] = None
    is_published: Optional[bool] = None
    tag_ids: Optional[List[int]] = None


# 文章列表响应
class PostListResponse(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    cover_image: Optional[str] = None
    is_published: bool
    view_count: int
    author: UserBrief
    tags: List[TagResponse] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# 文章详情响应
class PostDetailResponse(PostListResponse):
    content: str


# 分页响应
class PostPaginatedResponse(BaseModel):
    items: List[PostListResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
