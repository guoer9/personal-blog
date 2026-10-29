from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field
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
    model_config = ConfigDict(from_attributes=True)

    id: int
    post_id: int
    user: UserBrief
    parent_id: Optional[int] = None
    created_at: datetime
    replies: List["CommentResponse"] = []
    
# 解决循环引用
CommentResponse.model_rebuild()
