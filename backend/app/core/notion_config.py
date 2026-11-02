from typing import Optional
from uuid import UUID

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class NotionSettings(BaseSettings):
    """Configuration owned by the read-only Notion integration."""

    NOTION_TOKEN: Optional[SecretStr] = None
    NOTION_ALLOWED_DATABASE_TITLE: str = "日记和文档"
    # Kept for compatibility with the first local prototype. The public
    # library now binds its source from an admin-pasted link instead.
    NOTION_DATA_SOURCE_ID: Optional[UUID] = None
    NOTION_SYNC_ENABLED: bool = False
    NOTION_SYNC_INTERVAL_SECONDS: int = Field(default=300, ge=60)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @field_validator("NOTION_TOKEN", "NOTION_DATA_SOURCE_ID", mode="before")
    @classmethod
    def blank_is_unconfigured(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def token_configured(self) -> bool:
        return bool(self.NOTION_TOKEN and self.NOTION_TOKEN.get_secret_value().strip())

    @property
    def data_source_configured(self) -> bool:
        return self.NOTION_DATA_SOURCE_ID is not None

    @property
    def is_ready(self) -> bool:
        return self.token_configured


notion_settings = NotionSettings()
