from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Uuid, BigInteger
from app.db.session import Base


def now():
    return datetime.now(timezone.utc)


class Work(Base):
    __tablename__ = "works"
    id = Column(Uuid, primary_key=True, default=uuid4)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    draft = Column(JSON, nullable=False)
    published = Column(JSON, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now)
    published_at = Column(DateTime(timezone=True), nullable=True)


class WorkAsset(Base):
    __tablename__ = "work_assets"
    id = Column(Uuid, primary_key=True, default=uuid4)
    source_entry_id = Column(Uuid, ForeignKey("library_entries.id"), nullable=False)
    role = Column(String(10), nullable=False)
    mime_type = Column(String(50), nullable=False)
    size = Column(BigInteger, nullable=False)
    duration = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
