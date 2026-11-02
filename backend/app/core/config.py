import json
from pathlib import Path
from typing import List
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # 数据库
    DATABASE_URL: str = "postgresql+asyncpg://bloguser:local-dev-password@localhost:5433/blogdb"
    
    # JWT
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS
    CORS_ORIGINS: str = '["http://localhost:5173","http://localhost:3000"]'
    
    @property
    def cors_origins_list(self) -> List[str]:
        return json.loads(self.CORS_ORIGINS)
    
    # 文件上传
    UPLOAD_DIR: str = "uploads"
    PUBLIC_MEDIA_DIR: str = "public-media"
    WORK_ASSET_QUOTA_BYTES: int = Field(default=10 * 1024**3, gt=0)
    PRIVATE_STORAGE_DIR: str = "private-library"
    LIBRARY_MAX_FILE_BYTES: int = Field(default=8 * 1024**3, gt=0)
    LIBRARY_QUOTA_BYTES: int = Field(default=50 * 1024**3, gt=0)
    LIBRARY_SESSION_TTL_SECONDS: int = Field(default=86400, gt=0)
    # Temporary visitor transfers use an isolated, local POSIX volume.
    TRANSFER_STORAGE_DIR: str = "visitor-transfers"
    TRANSFER_MAX_FILE_BYTES: int = Field(default=10 * 1024**3, gt=0)
    TRANSFER_CHUNK_BYTES: int = Field(default=8 * 1024**2, gt=0)
    TRANSFER_RETENTION_SECONDS: int = Field(default=6 * 60 * 60, gt=0)
    TRANSFER_QUOTA_BYTES: int = Field(default=50 * 1024**3, gt=0)
    TRANSFER_MAX_ACTIVE_PER_SOURCE: int = Field(default=3, gt=0)
    TRANSFER_CREATES_PER_HOUR: int = Field(default=10, gt=0)
    TRANSFER_LOOKUPS_PER_MINUTE: int = Field(default=60, gt=0)
    TRANSFER_MAX_TRACKED_SOURCES: int = Field(default=4096, gt=0)
    TRANSFER_MAX_UPLOADS: int = Field(default=4096, gt=0)
    TRANSFER_SOURCE_TTL_SECONDS: int = Field(default=86400, gt=0)
    TRANSFER_DOWNLOAD_TICKET_SECONDS: int = Field(default=120, gt=0)
    MAX_UPLOAD_SIZE: int = 10485760  # 10MB
    ALLOWED_EXTENSIONS: List[str] = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp",  # 图片
        ".pdf", ".doc", ".docx", ".xls", ".xlsx",  # 文档
        ".zip", ".rar", ".7z",  # 压缩包
        ".mp4", ".mp3", ".wav",  # 媒体
    ]
    
    # 环境
    ENVIRONMENT: str = "development"
    
    # 项目信息
    PROJECT_NAME: str = "Personal Blog API"
    API_V1_PREFIX: str = "/api/v1"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_storage_paths(self) -> "Settings":
        storage_paths = [
            ("UPLOAD_DIR", Path(self.UPLOAD_DIR).expanduser().resolve()),
            ("PUBLIC_MEDIA_DIR", Path(self.PUBLIC_MEDIA_DIR).expanduser().resolve()),
            ("PRIVATE_STORAGE_DIR", Path(self.PRIVATE_STORAGE_DIR).expanduser().resolve()),
            ("TRANSFER_STORAGE_DIR", Path(self.TRANSFER_STORAGE_DIR).expanduser().resolve()),
        ]
        for index, (first_name, first) in enumerate(storage_paths):
            for second_name, second in storage_paths[index + 1:]:
                if first == second or first in second.parents or second in first.parents:
                    raise ValueError(f"{first_name} and {second_name} storage paths must not overlap")
        return self

    @model_validator(mode="after")
    def validate_production_secret(self) -> "Settings":
        if self.ENVIRONMENT.lower() == "production":
            insecure_markers = (
                "change-in-production",
                "generate-a-local-secret",
                "your-super-secret",
            )
            if len(self.SECRET_KEY) < 32 or any(
                marker in self.SECRET_KEY.lower() for marker in insecure_markers
            ):
                raise ValueError(
                    "SECRET_KEY must be a strong, non-placeholder value in production"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
