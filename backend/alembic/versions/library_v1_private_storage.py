"""Private library metadata, isolated from existing public file uploads.

Revision ID: library_v1_private_storage
Revises: f5076cd79f52
"""

from alembic import op
import sqlalchemy as sa

revision = "library_v1_private_storage"
down_revision = "f5076cd79f52"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "library_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trash_batch_id", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["parent_id"], ["library_entries.id"]),
        sa.CheckConstraint("kind IN ('file', 'folder')", name="ck_library_entry_kind"),
        sa.CheckConstraint("size >= 0", name="ck_library_entry_size"),
    )
    for column in ("parent_id", "deleted_at", "trash_batch_id"):
        op.create_index(f"ix_library_entries_{column}", "library_entries", [column])
    op.create_table(
        "library_uploads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=True),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("completed_entry_id", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["parent_id"], ["library_entries.id"]),
        sa.ForeignKeyConstraint(["completed_entry_id"], ["library_entries.id"]),
        sa.UniqueConstraint("completed_entry_id"),
        sa.CheckConstraint("size >= 0", name="ck_library_upload_size"),
        sa.CheckConstraint("state IN ('pending', 'completed', 'cancelled', 'expired')", name="ck_library_upload_state"),
    )
    for column in ("expires_at", "state"):
        op.create_index(f"ix_library_uploads_{column}", "library_uploads", [column])


def downgrade():
    op.drop_table("library_uploads")
    op.drop_table("library_entries")
