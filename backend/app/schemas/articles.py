from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief
from app.schemas.post import PostListResponse


ArticleKind = Literal["post", "notion"]
ArticleStatus = Literal["published", "draft", "isolated", "archived"]


class PublicArticleTag(BaseModel):
    name: str
    slug: str


class PublicArticleResponse(PostListResponse):
    key: str
    kind: ArticleKind
    public_url: str
    author: UserBrief | None
    tags: list[PublicArticleTag] = []


class PublicArticlePage(BaseModel):
    items: list[PublicArticleResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminArticleResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    key: str
    kind: ArticleKind
    title: str
    slug: str
    summary: str | None
    status: ArticleStatus
    is_published: bool
    author: UserBrief | None
    author_label: str
    tags: list[str]
    comment_count: int
    view_count: int
    public_url: str
    external_url: str | None
    source_label: str
    created_at: datetime
    updated_at: datetime


class AdminArticlePage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AdminArticleResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
