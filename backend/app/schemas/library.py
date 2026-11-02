import re
import unicodedata
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NamedInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def safe_name(cls, value: str) -> str:
        value = value.strip()
        if (not value or value in {".", ".."} or len(value.encode("utf-8")) > 255
                or any(ch in value for ch in "/\\:")
                or any(unicodedata.category(ch).startswith("C") for ch in value)
                or re.search(r"%(?:2e|2f|5c|00|25)", value, re.IGNORECASE)):
            raise ValueError("Name must be a plain file or folder name")
        return value


class FolderCreate(NamedInput):
    parent_id: UUID | None = None


class EntryUpdate(NamedInput):
    # Omitted name is permitted; an explicit null still fails the string validator.
    name: str = Field(default="", min_length=1, max_length=255)
    parent_id: UUID | None = None


class UploadCreate(NamedInput):
    size: int = Field(ge=0, strict=True)
    mime_type: str | None = Field(default=None, max_length=255)
    parent_id: UUID | None = None

    @field_validator("mime_type")
    @classmethod
    def safe_mime(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[a-zA-Z0-9!#$&^_.+\-]+/[a-zA-Z0-9!#$&^_.+\-]+", value):
            raise ValueError("Invalid MIME type")
        return value


class EntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    kind: Literal["file", "folder"]
    parent_id: UUID | None
    size: int
    mime_type: str | None
    created_at: datetime
    deleted_at: datetime | None

    @field_validator("created_at", "deleted_at")
    @classmethod
    def utc_timestamp(cls, value):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class EntryList(BaseModel):
    items: list[EntryResponse]


class UploadResponse(BaseModel):
    id: UUID
    chunk_size: int
    received_parts: list[int]
    expires_at: datetime


class StorageStatus(BaseModel):
    used_bytes: int
    quota_bytes: int
    max_file_bytes: int
    chunk_size: int
