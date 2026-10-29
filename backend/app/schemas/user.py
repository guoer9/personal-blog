from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field


# 用户基础模式
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr


# 用户创建（注册）
class UserCreate(UserBase):
    password: str = Field(..., min_length=6, max_length=100)


# 用户更新
class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    bio: Optional[str] = Field(None, max_length=500)
    avatar: Optional[str] = None


# 用户响应
class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_admin: bool
    is_active: bool
    avatar: Optional[str] = None
    bio: Optional[str] = None
    created_at: datetime
    
# 用户简要信息（用于嵌套）
class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    avatar: Optional[str] = None
    
# 登录请求
class LoginRequest(BaseModel):
    username: str
    password: str


# Token 响应
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: str
