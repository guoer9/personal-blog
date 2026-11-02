import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_comment_migration_preserves_legacy_threads_and_read_counts():
    path = Path(__file__).parents[1] / "alembic/versions/comment_targets_v7.py"
    spec = importlib.util.spec_from_file_location("comment_targets_v7", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE posts (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, author_id INTEGER, view_count INTEGER)")
        connection.exec_driver_sql("CREATE TABLE notion_documents (id INTEGER PRIMARY KEY, legacy_post_slug TEXT UNIQUE, author_id INTEGER, view_count INTEGER NOT NULL)")
        connection.exec_driver_sql("CREATE TABLE comments (id INTEGER PRIMARY KEY, content TEXT NOT NULL, post_id INTEGER NOT NULL REFERENCES posts(id), parent_id INTEGER REFERENCES comments(id))")
        connection.exec_driver_sql("INSERT INTO posts VALUES (1, 'old-notion', 4, 9), (2, 'manual', 5, 2)")
        connection.exec_driver_sql("INSERT INTO notion_documents VALUES (7, 'old-notion', NULL, 3)")
        connection.exec_driver_sql("INSERT INTO comments VALUES (1, '原评论', 1, NULL), (2, '原回复', 1, 1), (3, '普通文章评论', 2, NULL)")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        rows = connection.execute(sa.text("SELECT id, post_id, notion_document_id, parent_id, content FROM comments ORDER BY id")).all()
        assert rows == [(1, None, 7, None, "原评论"), (2, None, 7, 1, "原回复"), (3, 2, None, None, "普通文章评论")]
        assert connection.execute(sa.text("SELECT author_id, view_count FROM notion_documents WHERE id=7")).one() == (4, 12)
