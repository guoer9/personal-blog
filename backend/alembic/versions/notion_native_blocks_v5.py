"""Preserve Notion block structure and stable private image snapshots."""
from alembic import op
import sqlalchemy as sa

revision = "notion_native_blocks_v5"
down_revision = "notion_page_sources_v4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('notion_documents', sa.Column('content_blocks', sa.JSON(), nullable=True))
    op.add_column('notion_documents', sa.Column('icon', sa.String(30), nullable=True))
    op.add_column('notion_documents', sa.Column('cover_url', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('notion_documents', 'cover_url')
    op.drop_column('notion_documents', 'icon')
    op.drop_column('notion_documents', 'content_blocks')
