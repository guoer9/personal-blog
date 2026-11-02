from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.user import UserBrief


# 评论基础模式
class CommentBase(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


# 评论创建
class CommentCreate(CommentBase):
    post_id: int | None = Field(None, gt=0)
    notion_document_id: int | None = Field(None, gt=0)
    parent_id: int | None = Field(None, gt=0)

    @model_validator(mode="after")
    def one_article_target(self):
        if (self.post_id is None) == (self.notion_document_id is None):
            raise ValueError("请指定唯一的评论文章")
        return self


# 评论响应
class CommentResponse(CommentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    post_id: int | None
    notion_document_id: int | None = None
    user: UserBrief
    parent_id: Optional[int] = None
    created_at: datetime
    replies: List["CommentResponse"] = []
    
# 解决循环引用
CommentResponse.model_rebuild()
