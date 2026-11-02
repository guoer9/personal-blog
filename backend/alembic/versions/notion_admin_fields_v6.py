"""Expose Notion documents as manageable articles with author and view metadata."""

from alembic import op
import sqlalchemy as sa


revision = "notion_admin_fields_v6"
down_revision = "notion_native_blocks_v5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "notion_documents",
        sa.Column("author_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_notion_documents_author_id",
        "notion_documents",
        ["author_id"],
    )
    op.create_foreign_key(
        "fk_notion_documents_author_id_users",
        "notion_documents",
        "users",
        ["author_id"],
        ["id"],
    )
    op.add_column(
        "notion_documents",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "notion_documents",
        sa.Column("manual_unpublished", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade():
    op.drop_column("notion_documents", "manual_unpublished")
    op.drop_column("notion_documents", "view_count")
    op.drop_constraint("fk_notion_documents_author_id_users", "notion_documents", type_="foreignkey")
    op.drop_index("ix_notion_documents_author_id", table_name="notion_documents")
    op.drop_column("notion_documents", "author_id")
