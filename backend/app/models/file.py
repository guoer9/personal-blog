from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base


class File(Base):
    __tablename__ = "files"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), unique=True, index=True, nullable=False)  # 存储的文件名（UUID）
    original_name = Column(String(255), nullable=False)  # 原始文件名
    file_path = Column(String(500), nullable=False)  # 文件路径
    size = Column(Integer, nullable=False)  # 文件大小（字节）
    mime_type = Column(String(100), nullable=True)  # MIME 类型
    
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 关系
    uploader = relationship("User", back_populates="files", lazy="selectin")
