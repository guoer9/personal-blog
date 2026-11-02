from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, 
    ForeignKey, Table, Index
)
from sqlalchemy.orm import relationship
from app.db.session import Base


# 文章-标签关联表
post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", Integer, ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, index=True, nullable=False)
    slug = Column(String(50), unique=True, index=True, nullable=False)
    
    # 关系
    posts = relationship("Post", secondary=post_tags, back_populates="tags", lazy="selectin")


class Post(Base):
    __tablename__ = "posts"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, index=True, nullable=False)
    content = Column(Text, nullable=False)
    summary = Column(String(500), nullable=True)  # 文章摘要
    cover_image = Column(String(255), nullable=True)  # 封面图
    is_published = Column(Boolean, default=False)
    view_count = Column(Integer, default=0)
    
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )
    
    # 全文搜索向量 - 使用 PostgreSQL 的 tsvector
    # search_vector = Column(TSVector())  # 需要 sqlalchemy-searchable
    
    # 关系
    author = relationship("User", back_populates="posts", lazy="selectin")
    tags = relationship("Tag", secondary=post_tags, back_populates="posts", lazy="selectin")
    comments = relationship("Comment", back_populates="post", lazy="selectin", cascade="all, delete-orphan")


# 创建全文搜索索引（在迁移时使用）
# Index('ix_posts_search', Post.search_vector, postgresql_using='gin')
