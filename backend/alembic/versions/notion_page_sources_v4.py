"""Support explicitly selected standalone Notion page sources."""
from alembic import op
import sqlalchemy as sa

revision = "notion_page_sources_v4"
down_revision = "notion_multi_conn_v3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("notion_sources", sa.Column("source_type", sa.String(12), nullable=False, server_default="database"))


def downgrade():
    op.drop_column("notion_sources", "source_type")
