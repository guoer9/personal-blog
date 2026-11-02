from datetime import datetime, timezone
from sqlalchemy import CheckConstraint, Column, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import backref, relationship
from app.db.session import Base


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint(
            "(post_id IS NOT NULL AND notion_document_id IS NULL) OR "
            "(post_id IS NULL AND notion_document_id IS NOT NULL)",
            name="ck_comment_one_article",
        ),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=True, index=True)
    notion_document_id = Column(Integer, ForeignKey("notion_documents.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    
    # 关系
    post = relationship("Post", back_populates="comments", lazy="selectin")
    notion_document = relationship("NotionDocument", back_populates="comments")
    user = relationship("User", back_populates="comments", lazy="selectin")
    
    # 嵌套回复
    parent = relationship("Comment", remote_side=[id], backref=backref("replies", cascade="all, delete-orphan"), lazy="selectin")
