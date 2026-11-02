from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from app.db.session import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class NotionPage(Base):
    """Stable source-page to local-post identity and reconciliation state."""

    __tablename__ = "notion_pages"

    id = Column(Integer, primary_key=True, index=True)
    notion_page_id = Column(String(36), nullable=False, unique=True, index=True)
    post_id = Column(
        Integer,
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    source_title = Column(String(200), nullable=False)
    is_archived = Column(Boolean, nullable=False, default=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_synced_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    post = relationship("Post", lazy="joined")


class NotionSyncState(Base):
    """Singleton status record for manual and scheduled Notion syncs."""

    __tablename__ = "notion_sync_state"

    id = Column(Integer, primary_key=True, default=1)
    status = Column(String(20), nullable=False, default="never")
    last_started_at = Column(DateTime(timezone=True), nullable=True)
    last_finished_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    counters = Column(JSON, nullable=False, default=dict)
