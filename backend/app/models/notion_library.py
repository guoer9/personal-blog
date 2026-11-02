from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, JSON, String, Text, text
from sqlalchemy.orm import relationship

from app.db.session import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class NotionSource(Base):
    """An explicitly registered database or standalone page and connection."""

    __tablename__ = "notion_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)
    connection_id = Column(String(64), nullable=False, default="legacy-unconfigured", index=True)
    database_id = Column(String(36), nullable=False, unique=True, index=True)
    # Compatibility name: database_id identifies the root page for page sources.
    source_type = Column(String(12), nullable=False, default="database", server_default="database")
    # Kept as a compatibility pointer for rows created by the single-source
    # prototype. New code uses all IDs in data_source_ids.
    data_source_id = Column(String(36), nullable=True, index=True)
    data_source_ids = Column(JSON, nullable=False, default=list, server_default=text("'[]'"))
    title = Column(String(200), nullable=False)
    source_url = Column(Text, nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_import_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    documents = relationship("NotionDocument", back_populates="source", cascade="all, delete-orphan")


class NotionDocument(Base):
    """A public-safe page imported from the approved Notion source."""

    __tablename__ = "notion_documents"
    __table_args__ = (
        CheckConstraint("status IN ('published', 'isolated', 'archived')", name="ck_notion_document_status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("notion_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    data_source_id = Column(String(36), nullable=True, index=True)
    notion_page_id = Column(String(36), nullable=False, unique=True, index=True)
    slug = Column(String(200), nullable=False, unique=True, index=True)
    legacy_post_slug = Column(String(200), nullable=True, unique=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False, default="")
    content_blocks = Column(JSON, nullable=True)
    icon = Column(String(30), nullable=True)
    cover_url = Column(Text, nullable=True)
    summary = Column(String(500), nullable=True)
    categories = Column(JSON, nullable=False, default=list)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    view_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    manual_unpublished = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    status = Column(String(12), nullable=False, default="published", index=True)
    isolation_reason = Column(Text, nullable=True)
    notion_last_edited_at = Column(DateTime(timezone=True), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    source = relationship("NotionSource", back_populates="documents")
    author = relationship("User", lazy="selectin")
    comments = relationship("Comment", back_populates="notion_document", cascade="all, delete-orphan")


class NotionLibrarySyncState(Base):
    """Sanitized status for explicitly triggered imports/syncs."""

    __tablename__ = "notion_library_sync_state"

    id = Column(Integer, primary_key=True, default=1)
    status = Column(String(20), nullable=False, default="never")
    last_started_at = Column(DateTime(timezone=True), nullable=True)
    last_finished_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    counters = Column(JSON, nullable=False, default=dict)
