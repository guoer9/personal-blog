from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from app.schemas.user import UserBrief


# 评论基础模式
class CommentBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


# 评论创建
class CommentCreate(CommentBase):
    post_id: int
    parent_id: Optional[int] = None


# 评论响应
class CommentResponse(CommentBase):
    id: int
    post_id: int
    user: UserBrief
    parent_id: Optional[int] = None
    created_at: datetime
    replies: List["CommentResponse"] = []
    
    class Config:
        from_attributes = True


# 解决循环引用
CommentResponse.model_rebuild()
