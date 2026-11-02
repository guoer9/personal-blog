from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import asyncio
import logging
import os

from app.core.config import settings
from app.api.v1 import auth, posts, comments, files, tags, library, works, transfers, notion, documents, articles
from app.api.v1 import notion_connections
from app.services.transfers import TransferAccessLogFilter, TransferService


# StaticFiles validates the directory during application construction.
settings.validate_storage_paths()
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    settings.validate_storage_paths()
    # 确保上传目录存在
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    access_logger = logging.getLogger("uvicorn.access")
    access_filter = TransferAccessLogFilter()
    access_logger.addFilter(access_filter)
    cleaner = asyncio.create_task(TransferService().cleanup_loop())
    try:
        yield
    finally:
        cleaner.cancel()
        try:
            await cleaner
        except asyncio.CancelledError:
            pass
        access_logger.removeFilter(access_filter)


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.3.0",
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
app.include_router(works.public_router, prefix=settings.API_V1_PREFIX, tags=["公开作品"])
app.include_router(works.admin_router, prefix=settings.API_V1_PREFIX, tags=["作品管理"])
app.include_router(works.asset_admin_router, prefix=settings.API_V1_PREFIX, tags=["作品素材"])
app.include_router(library.router, prefix=f"{settings.API_V1_PREFIX}/library", tags=["私有文件库"])
app.include_router(transfers.router, prefix=f"{settings.API_V1_PREFIX}/transfers", tags=["临时访客传输"])
app.include_router(notion.router, prefix=settings.API_V1_PREFIX, tags=["Notion文章同步"])
app.include_router(notion_connections.router, prefix=settings.API_V1_PREFIX, tags=["Notion连接管理"])
app.include_router(documents.router, prefix=settings.API_V1_PREFIX, tags=["公开资料库"])
app.include_router(articles.router, prefix=settings.API_V1_PREFIX, tags=["统一文章管理"])


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
