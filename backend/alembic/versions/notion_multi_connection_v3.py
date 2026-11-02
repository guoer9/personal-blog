"""Add named-connection and multi-data-source associations to Notion library."""

from alembic import op
import sqlalchemy as sa


revision = "notion_multi_conn_v3"
down_revision = "notion_library_v2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "notion_sources",
        sa.Column(
            "connection_id",
            sa.String(length=64),
            nullable=False,
            server_default="legacy-unconfigured",
        ),
    )
    op.add_column(
        "notion_sources",
        sa.Column("data_source_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column("notion_documents", sa.Column("data_source_id", sa.String(length=36), nullable=True))

    sources = sa.table(
        "notion_sources",
        sa.column("id", sa.Integer()),
        sa.column("data_source_id", sa.String(length=36)),
        sa.column("data_source_ids", sa.JSON()),
    )
    documents = sa.table(
        "notion_documents",
        sa.column("id", sa.Integer()),
        sa.column("source_id", sa.Integer()),
        sa.column("data_source_id", sa.String(length=36)),
    )
    bind = op.get_bind()
    source_rows = list(bind.execute(sa.select(sources.c.id, sources.c.data_source_id)))
    source_data_sources: dict[int, str | None] = {}
    for source_id, data_source_id in source_rows:
        source_data_sources[source_id] = data_source_id
        bind.execute(
            sa.update(sources)
            .where(sources.c.id == source_id)
            .values(data_source_ids=[data_source_id] if data_source_id else [])
        )
    document_rows = bind.execute(sa.select(documents.c.id, documents.c.source_id))
    for document_id, source_id in document_rows:
        bind.execute(
            sa.update(documents)
            .where(documents.c.id == document_id)
            .values(data_source_id=source_data_sources.get(source_id))
        )

    op.create_index("ix_notion_sources_connection_id", "notion_sources", ["connection_id"])
    op.create_index("ix_notion_documents_data_source_id", "notion_documents", ["data_source_id"])


def downgrade():
    op.drop_index("ix_notion_documents_data_source_id", table_name="notion_documents")
    op.drop_index("ix_notion_sources_connection_id", table_name="notion_sources")
    op.drop_column("notion_documents", "data_source_id")
    op.drop_column("notion_sources", "data_source_ids")
    op.drop_column("notion_sources", "connection_id")
