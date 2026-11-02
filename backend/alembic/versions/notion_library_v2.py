"""Public-safe Notion library imported by explicit admin action."""

from alembic import op
import sqlalchemy as sa


revision = "notion_library_v2"
down_revision = "notion_v1_sync"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "notion_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("database_id", sa.String(length=36), nullable=False),
        sa.Column("data_source_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_import_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("database_id", name="uq_notion_sources_database_id"),
    )
    op.create_index("ix_notion_sources_database_id", "notion_sources", ["database_id"])
    op.create_index("ix_notion_sources_data_source_id", "notion_sources", ["data_source_id"])
    op.create_table(
        "notion_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("notion_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notion_page_id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("legacy_post_slug", sa.String(length=200), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=True),
        sa.Column("categories", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("isolation_reason", sa.Text(), nullable=True),
        sa.Column("notion_last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("notion_page_id", name="uq_notion_documents_notion_page_id"),
        sa.UniqueConstraint("slug", name="uq_notion_documents_slug"),
        sa.UniqueConstraint("legacy_post_slug", name="uq_notion_documents_legacy_post_slug"),
        sa.CheckConstraint("status IN ('published', 'isolated', 'archived')", name="ck_notion_document_status"),
    )
    for column in ("source_id", "notion_page_id", "slug", "legacy_post_slug", "status"):
        op.create_index(f"ix_notion_documents_{column}", "notion_documents", [column])
    op.create_table(
        "notion_library_sync_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("counters", sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table("notion_library_sync_state")
    for column in ("status", "legacy_post_slug", "slug", "notion_page_id", "source_id"):
        op.drop_index(f"ix_notion_documents_{column}", table_name="notion_documents")
    op.drop_table("notion_documents")
    op.drop_index("ix_notion_sources_data_source_id", table_name="notion_sources")
    op.drop_index("ix_notion_sources_database_id", table_name="notion_sources")
    op.drop_table("notion_sources")
