from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal["code", "film", "music"]


class WorkDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=150)
    category: Category
    caption: str = Field(default="", max_length=150)
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list, max_length=12)
    accent: Literal["lime", "blue", "paper"] = "paper"
    repository: str | None = Field(default=None, max_length=1000)
    externalWatch: str | None = Field(default=None, max_length=1000)
    notes: list[str] = Field(default_factory=list, max_length=20)
    featured: bool = False
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    cover_asset_id: UUID | None = None
    video_asset_id: UUID | None = None
    audio_asset_id: UUID | None = None

    @field_validator("repository", "externalWatch")
    @classmethod
    def safe_link(cls, value):
        if value is None or value == "":
            return None
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or any(ord(c) < 33 for c in value):
            raise ValueError("链接必须是完整的 HTTPS 地址")
        return value

    @field_validator("tags", "notes")
    @classmethod
    def bounded_text(cls, value):
        if any(not item.strip() or len(item) > 2000 for item in value):
            raise ValueError("文本项目不能为空或超过2000字")
        return [item.strip() for item in value]


class WorkCreate(WorkDraft):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=100)


class WorkUpdate(WorkDraft):
    version: int = Field(ge=1)


class WorkVersion(BaseModel):
    version: int = Field(ge=1)


class AdminWork(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    draft: WorkDraft
    published: WorkDraft | None
    version: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None


class PublicWork(BaseModel):
    slug: str
    title: str
    category: Category
    caption: str
    description: str
    tags: list[str]
    accent: Literal["lime", "blue", "paper"]
    repository: str | None = None
    externalWatch: str | None = None
    notes: list[str]
    featured: bool
    sort_order: int
    cover: str | None = None
    video: str | None = None
    audio: str | None = None
    duration: float | None = None


class PublicWorkList(BaseModel):
    items: list[PublicWork]


class AdminWorkList(BaseModel):
    items: list[AdminWork]


class AssetCreate(BaseModel):
    entry_id: UUID
    role: Literal["cover", "video", "audio"]


class AssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    role: str
    mime_type: str
    size: int
    duration: float | None
