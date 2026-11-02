"""Metadata only: user names and paths are never used as disk object keys."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, String, Uuid

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class LibraryEntry(Base):
    __tablename__ = "library_entries"
    __table_args__ = (
        CheckConstraint("kind IN ('file', 'folder')", name="ck_library_entry_kind"),
        CheckConstraint("size >= 0", name="ck_library_entry_size"),
    )

    id = Column(Uuid, primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False)
    kind = Column(String(10), nullable=False)
    parent_id = Column(Uuid, ForeignKey("library_entries.id"), nullable=True, index=True)
    size = Column(BigInteger, nullable=False, default=0)
    mime_type = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    trash_batch_id = Column(Uuid, nullable=True, index=True)


class LibraryUpload(Base):
    __tablename__ = "library_uploads"
    __table_args__ = (
        CheckConstraint("size >= 0", name="ck_library_upload_size"),
        CheckConstraint("state IN ('pending', 'completed', 'cancelled', 'expired')", name="ck_library_upload_state"),
    )

    id = Column(Uuid, primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False)
    size = Column(BigInteger, nullable=False)
    mime_type = Column(String(255), nullable=True)
    parent_id = Column(Uuid, ForeignKey("library_entries.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    state = Column(String(10), nullable=False, default="pending", index=True)
    completed_entry_id = Column(Uuid, ForeignKey("library_entries.id"), nullable=True, unique=True)
