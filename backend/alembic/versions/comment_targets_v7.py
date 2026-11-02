"""Share comments across manual articles and Notion documents without losing threads."""

from alembic import op
import sqlalchemy as sa

revision = "comment_targets_v7"
down_revision = "notion_admin_fields_v6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("comments") as batch:
        batch.alter_column("post_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("notion_document_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_comments_notion_document", "notion_documents", ["notion_document_id"], ["id"], ondelete="CASCADE")
        batch.create_check_constraint("ck_comment_one_article", "(post_id IS NOT NULL AND notion_document_id IS NULL) OR (post_id IS NULL AND notion_document_id IS NOT NULL)")
        batch.create_index("ix_comments_post_id", ["post_id"])
        batch.create_index("ix_comments_notion_document_id", ["notion_document_id"])

    connection = op.get_bind()
    # Preserve stable comment IDs and parent IDs while moving legacy discussions.
    connection.execute(sa.text("""
        UPDATE comments SET notion_document_id = (
            SELECT notion_documents.id FROM notion_documents JOIN posts
            ON posts.slug = notion_documents.legacy_post_slug WHERE posts.id = comments.post_id
        ), post_id = NULL
        WHERE post_id IN (
            SELECT posts.id FROM posts JOIN notion_documents
            ON posts.slug = notion_documents.legacy_post_slug
        )
    """))
    connection.execute(sa.text("""
        UPDATE notion_documents SET
            author_id = COALESCE(author_id, (SELECT author_id FROM posts WHERE posts.slug = notion_documents.legacy_post_slug)),
            view_count = view_count + COALESCE((SELECT view_count FROM posts WHERE posts.slug = notion_documents.legacy_post_slug), 0)
        WHERE legacy_post_slug IS NOT NULL
    """))


def downgrade():
    connection = op.get_bind()
    unmappable = connection.execute(sa.text("""
        SELECT COUNT(*) FROM comments JOIN notion_documents ON comments.notion_document_id = notion_documents.id
        WHERE NOT EXISTS (SELECT 1 FROM posts WHERE posts.slug = notion_documents.legacy_post_slug)
    """)).scalar_one()
    if unmappable:
        raise RuntimeError("Notion comments have no legacy post; downgrade would lose comments")
    connection.execute(sa.text("""
        UPDATE comments SET post_id = (
            SELECT posts.id FROM posts JOIN notion_documents ON posts.slug = notion_documents.legacy_post_slug
            WHERE notion_documents.id = comments.notion_document_id
        ), notion_document_id = NULL WHERE notion_document_id IS NOT NULL
    """))
    with op.batch_alter_table("comments") as batch:
        batch.drop_constraint("ck_comment_one_article", type_="check")
        batch.drop_constraint("fk_comments_notion_document", type_="foreignkey")
        batch.drop_index("ix_comments_notion_document_id")
        batch.drop_index("ix_comments_post_id")
        batch.drop_column("notion_document_id")
        batch.alter_column("post_id", existing_type=sa.Integer(), nullable=False)
