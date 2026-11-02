from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class NotionConnectionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    configured: bool


class NotionSourceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    connection_id: str
    connection_label: str | None = None
    database_id: str
    source_type: Literal["database", "page"] = "database"
    title: str
    source_url: str
    data_source_ids: list[str]
    last_import_at: datetime | str | None = None
    last_success_at: datetime | str | None = None


class NotionLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_id: str = Field(min_length=1, max_length=64)
    url: str = Field(min_length=1, max_length=2048)


class NotionPageLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2048)


class NotionLibraryCounters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queried: int
    published: int
    updated: int
    isolated: int
    archived: int
    unpublished: int
    skipped: int
    failed: int


class NotionLibraryStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    source_configured: bool
    source_title: str | None
    status: Literal["never", "running", "success", "error"]
    last_started_at: datetime | None
    last_finished_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    counters: NotionLibraryCounters
