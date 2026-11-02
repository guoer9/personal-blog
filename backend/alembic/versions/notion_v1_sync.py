"""Read-only Notion page mappings and sync status."""

from alembic import op
import sqlalchemy as sa


revision = "notion_v1_sync"
down_revision = "works_v1_publication"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notion_pages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("notion_page_id", sa.String(length=36), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_title", sa.String(length=200), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("notion_page_id", name="uq_notion_pages_notion_page_id"),
        sa.UniqueConstraint("post_id", name="uq_notion_pages_post_id"),
    )
    op.create_index("ix_notion_pages_notion_page_id", "notion_pages", ["notion_page_id"])
    op.create_index("ix_notion_pages_post_id", "notion_pages", ["post_id"])
    op.create_table(
        "notion_sync_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("counters", sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table("notion_sync_state")
    op.drop_index("ix_notion_pages_post_id", table_name="notion_pages")
    op.drop_index("ix_notion_pages_notion_page_id", table_name="notion_pages")
    op.drop_table("notion_pages")
