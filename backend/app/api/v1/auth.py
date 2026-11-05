from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
import secrets

from app.core.config import settings
from app.db.session import get_db
from app.schemas.user import (
    UserCreate, UserResponse, Token, TokenRefresh, LoginRequest
)
from app.crud.user import (
    create_user, get_user_by_username_or_email, authenticate_user, get_user_by_id
)
from app.core.security import (
    create_access_token, create_refresh_token, decode_token
)
from app.api.deps import get_current_user_required
from app.models.user import User

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """用户注册"""
    configured_phrase = settings.REGISTRATION_PHRASE.strip()
    if not configured_phrase:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="注册暂未开放",
        )
    if not secrets.compare_digest(
        user_in.verification_phrase.strip().encode("utf-8"),
        configured_phrase.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证内容不正确",
        )

    # 检查用户名或邮箱是否已存在
    existing_user = await get_user_by_username_or_email(
        db, user_in.username, user_in.email
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名或邮箱已被注册"
        )
    
    user = await create_user(db, user_in)
    return user


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """用户登录（OAuth2 表单）"""
    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用"
        )
    
    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login/json", response_model=Token)
async def login_json(
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """用户登录（JSON）"""
    user = await authenticate_user(db, login_data.username, login_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用"
        )
    
    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=Token)
async def refresh_token(
    token_data: TokenRefresh,
    db: AsyncSession = Depends(get_db)
):
    """刷新访问令牌"""
    payload = decode_token(token_data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的刷新令牌"
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的令牌"
        )

    try:
        user = await get_user_by_id(db, int(user_id))
    except (TypeError, ValueError):
        user = None

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被禁用"
        )
    
    return Token(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user_required)
):
    """获取当前用户信息"""
    return current_user
