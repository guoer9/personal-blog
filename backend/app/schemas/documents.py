from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from app.schemas.user import UserBrief


class PublicDocumentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    slug: str
    title: str
    summary: str | None = None
    categories: list[str]
    created_at: datetime
    updated_at: datetime
    icon: str | None = None
    cover_url: str | None = None
    author: UserBrief | None = None
    author_label: str
    view_count: int
    comment_count: int
    public_url: str
    external_url: str


class PublicDocumentDetail(PublicDocumentSummary):
    content: str
    blocks: list[dict[str, Any]] | None = None


class PublicDocumentList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PublicDocumentSummary]
    total: int
    page: int
    page_size: int
    total_pages: int
