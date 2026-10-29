from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from app.core.config import settings
from app.api.v1 import auth, posts, comments, files, tags


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 确保上传目录存在
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录（用于文件下载）
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# 注册路由
app.include_router(auth.router, prefix=f"{settings.API_V1_PREFIX}/auth", tags=["认证"])
app.include_router(posts.router, prefix=f"{settings.API_V1_PREFIX}/posts", tags=["文章"])
app.include_router(comments.router, prefix=f"{settings.API_V1_PREFIX}/comments", tags=["评论"])
app.include_router(files.router, prefix=f"{settings.API_V1_PREFIX}/files", tags=["文件"])
app.include_router(tags.router, prefix=f"{settings.API_V1_PREFIX}/tags", tags=["标签"])


@app.get("/")
async def root():
    return {
        "message": "Welcome to Personal Blog API",
        "docs": "/docs",
        "redoc": "/redoc"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
