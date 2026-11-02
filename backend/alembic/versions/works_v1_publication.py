"""Admin-created work drafts and independently prepared publication assets."""
from alembic import op
import sqlalchemy as sa

revision = "works_v1_publication"
down_revision = "library_v1_private_storage"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("works",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("published", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_works_slug", "works", ["slug"], unique=True)
    op.create_table("work_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_entry_id", sa.Uuid(), sa.ForeignKey("library_entries.id"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("mime_type", sa.String(50), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("duration", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("work_assets")
    op.drop_index("ix_works_slug", table_name="works")
    op.drop_table("works")
