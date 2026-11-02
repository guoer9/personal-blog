import asyncio
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


def test_manual_notion_settings_are_token_only_and_default_to_target_library():
    from pydantic import SecretStr
    from app.core.notion_config import NotionSettings

    config = NotionSettings(_env_file=None, NOTION_TOKEN=SecretStr("local-only-token"))

    assert config.token_configured is True
    assert config.is_ready is True
    assert config.NOTION_ALLOWED_DATABASE_TITLE == "日记和文档"
    assert config.NOTION_SYNC_ENABLED is False


def test_blank_notion_token_is_not_ready():
    from app.core.notion_config import NotionSettings

    config = NotionSettings(_env_file=None, NOTION_TOKEN="")

    assert config.token_configured is False
    assert config.is_ready is False


def test_notion_library_models_are_separate_from_blog_posts():
    from app.models import NotionDocument, NotionLibrarySyncState, NotionSource

    assert NotionSource.__tablename__ == "notion_sources"
    assert NotionDocument.__tablename__ == "notion_documents"
    assert NotionLibrarySyncState.__tablename__ == "notion_library_sync_state"
    assert NotionDocument.__table__.c.notion_page_id.unique is True
    assert NotionDocument.__table__.c.slug.unique is True
    assert NotionSource.__table__.c.id.primary_key is True


def test_notion_library_migration_is_chained_after_works_publication():
    path = Path(__file__).parents[1] / "alembic" / "versions" / "notion_library_v2.py"
    spec = importlib.util.spec_from_file_location("notion_library_v2", path)
    migration = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(migration)

    assert migration.down_revision == "notion_v1_sync"
    assert migration.revision == "notion_library_v2"


def test_multi_connection_migration_preserves_legacy_source_and_document():
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = Path(__file__).parents[1] / "alembic" / "versions" / "notion_multi_connection_v3.py"
    spec = importlib.util.spec_from_file_location("notion_multi_connection_v3", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE notion_sources (id INTEGER PRIMARY KEY, data_source_id VARCHAR(36))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE notion_documents (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO notion_sources (id, data_source_id) VALUES (1, 'legacy-data-source')"
        )
        connection.exec_driver_sql(
            "INSERT INTO notion_documents (id, source_id) VALUES (7, 1)"
        )
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.upgrade()

        source = connection.execute(sa.text("SELECT * FROM notion_sources WHERE id = 1")).mappings().one()
        document = connection.execute(sa.text("SELECT * FROM notion_documents WHERE id = 7")).mappings().one()

    assert source["connection_id"] == "legacy-unconfigured"
    assert source["data_source_ids"] == '["legacy-data-source"]'
    assert document["data_source_id"] == "legacy-data-source"


@pytest.mark.asyncio
async def test_multiple_sources_and_data_sources_have_independent_associations(notion_library_db):
    from app.models import NotionDocument, NotionSource

    factory, _ = notion_library_db
    async with factory() as db:
        journal = NotionSource(
            connection_id="journal",
            database_id="11111111-1111-1111-1111-111111111111",
            data_source_id="22222222-2222-2222-2222-222222222222",
            data_source_ids=["22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"],
            title="日记",
            source_url="https://www.notion.so/11111111111111111111111111111111",
        )
        deployment = NotionSource(
            connection_id="deployment",
            database_id="44444444-4444-4444-4444-444444444444",
            data_source_id="55555555-5555-5555-5555-555555555555",
            data_source_ids=["55555555-5555-5555-5555-555555555555"],
            title="部署文档",
            source_url="https://www.notion.so/44444444444444444444444444444444",
        )
        db.add_all([journal, deployment])
        await db.flush()
        db.add(NotionDocument(
            source_id=journal.id,
            data_source_id="33333333-3333-3333-3333-333333333333",
            notion_page_id="66666666-6666-6666-6666-666666666666",
            slug="journal-page",
            title="Journal entry",
            content="Safe content",
        ))
        await db.commit()

        sources = list((await db.scalars(select(NotionSource).order_by(NotionSource.id))).all())
        document = await db.scalar(select(NotionDocument).where(NotionDocument.slug == "journal-page"))

    assert len(sources) == 2
    assert sources[0].id != sources[1].id
    assert sources[0].connection_id == "journal"
    assert sources[0].data_source_ids == [
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
    ]
    assert sources[1].connection_id == "deployment"
    assert document.data_source_id == "33333333-3333-3333-3333-333333333333"


@pytest.mark.parametrize(
    "value",
    ["https://example.com/notion/11111111111111111111111111111111"],
)
def test_placeholder_external_link_is_not_accepted(value):
    from app.services.notion_library import NotionLibraryError, parse_notion_source_url

    with pytest.raises(NotionLibraryError):
        parse_notion_source_url(value)


@pytest.mark.parametrize(
    "value",
    [
        "http://www.notion.so/diary-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://www.notion.so.evil.test/diary-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://user:pass@www.notion.so/diary-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://www.notion.so/diary-not-a-uuid",
    ],
)
def test_notion_link_parser_rejects_unsafe_urls(value):
    from app.services.notion_library import NotionLibraryError, parse_notion_source_url

    with pytest.raises(NotionLibraryError):
        parse_notion_source_url(value)


def test_notion_link_parser_accepts_notion_database_and_page_urls():
    from app.services.notion_library import parse_notion_source_url

    database = parse_notion_source_url(
        "https://www.notion.so/diary/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=1"
    )
    page = parse_notion_source_url(
        "https://www.notion.so/diary/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?pvs=4"
    )

    assert database.kind == "database_or_page"
    assert database.entity_id == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert page.entity_id == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


DATABASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
DATA_SOURCE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
DATA_SOURCE_ID_2 = "99999999-9999-9999-9999-999999999999"
DATABASE_ID_2 = "88888888-8888-8888-8888-888888888888"
DATA_SOURCE_ID_3 = "77777777-7777-7777-7777-777777777777"
PAGE_SAFE = "dddddddd-dddd-dddd-dddd-dddddddddddd"
PAGE_SECRET = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
PAGE_SECOND_SOURCE = "66666666-6666-6666-6666-666666666666"
PAGE_SECOND_DATABASE = "55555555-5555-5555-5555-555555555555"


def library_database_url() -> str:
    return f"https://www.notion.so/diary/{DATABASE_ID.replace('-', '')}"


def library_page_url(page_id: str = PAGE_SAFE) -> str:
    return f"https://www.notion.so/diary/{page_id.replace('-', '')}"


def library_page(
    page_id: str,
    title: str,
    category: str,
    body: str,
    last_edited_at: str | None = None,
    data_source_id: str = DATA_SOURCE_ID,
    database_id: str = DATABASE_ID,
):
    return {
        "object": "page",
        "id": page_id,
        "parent": {"type": "data_source_id", "data_source_id": data_source_id, "database_id": database_id},
        "archived": False,
        "in_trash": False,
        "last_edited_time": last_edited_at or "2026-11-01T12:00:00.000Z",
        "properties": {
            "标题": {"id": "title", "type": "title", "title": [{"plain_text": title}]},
            "分类": {"id": "category", "type": "select", "select": {"name": category}},
        },
        "_test_body": body,
    }


class NotionLibraryScenario:
    def __init__(self):
        self.pages = {
            PAGE_SAFE: library_page(PAGE_SAFE, "部署手册", "部署", "安全正文"),
            PAGE_SECRET: library_page(PAGE_SECRET, "环境配置", "部署", "password = 'not-a-placeholder-secret'") ,
        }
        self.database_failure = False
        self.query_failure = False
        self.block_failure: set[str] = set()
        self.requests: list[httpx.Request] = []

    def transport(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            path = request.url.path
            if path == f"/v1/databases/{DATABASE_ID}":
                if self.database_failure:
                    return httpx.Response(502, json={"message": "private upstream detail"})
                return httpx.Response(200, json={
                    "object": "database", "id": DATABASE_ID,
                    "title": [{"plain_text": "日记和文档"}],
                    "data_sources": [{"id": DATA_SOURCE_ID, "name": "日记和文档"}],
                    "in_trash": False,
                })
            if path.startswith("/v1/databases/"):
                return httpx.Response(404, json={})
            if path == f"/v1/data_sources/{DATA_SOURCE_ID}":
                return httpx.Response(200, json={
                    "object": "data_source", "id": DATA_SOURCE_ID,
                    "properties": {
                        "标题": {"id": "title", "type": "title", "title": {}},
                        "分类": {"id": "category", "type": "select", "select": {"options": [{"name": "部署"}, {"name": "随笔"}]}},
                    },
                })
            if path == f"/v1/data_sources/{DATA_SOURCE_ID}/query":
                if self.query_failure:
                    return httpx.Response(502, json={"message": "private query details"})
                return httpx.Response(200, json={
                    "results": [self.pages[PAGE_SAFE], self.pages[PAGE_SECRET]],
                    "has_more": False, "next_cursor": None,
                })
            if path.startswith("/v1/pages/"):
                page_id = path.removeprefix("/v1/pages/")
                page = self.pages.get(page_id)
                return httpx.Response(200, json=page) if page else httpx.Response(404, json={})
            if path.startswith("/v1/blocks/") and path.endswith("/children"):
                block_id = path.removeprefix("/v1/blocks/").removesuffix("/children")
                if block_id in self.block_failure:
                    return httpx.Response(502, json={"message": "private block detail"})
                page = self.pages.get(block_id)
                body = page.get("_test_body", "") if page else ""
                return httpx.Response(200, json={"results": [
                    {"id": f"block-{block_id}", "type": "paragraph", "has_children": False,
                     "paragraph": {"rich_text": [{"plain_text": body}]}}
                ], "has_more": False, "next_cursor": None})
            raise AssertionError(f"unexpected fixed-host request: {request.method} {request.url}")

        return httpx.MockTransport(handler)


class MultiConnectionScenario:
    def __init__(self):
        self.pages = {
            PAGE_SAFE: library_page(PAGE_SAFE, "随笔一", "随笔", "第一数据源正文"),
            PAGE_SECOND_SOURCE: library_page(
                PAGE_SECOND_SOURCE, "部署指南", "部署", "第二数据源正文", data_source_id=DATA_SOURCE_ID_2
            ),
            PAGE_SECOND_DATABASE: library_page(
                PAGE_SECOND_DATABASE,
                "部署手册",
                "部署",
                "另一个数据库正文",
                data_source_id=DATA_SOURCE_ID_3,
                database_id=DATABASE_ID_2,
            ),
        }
        self.database_sources = {
            DATABASE_ID: [DATA_SOURCE_ID, DATA_SOURCE_ID_2],
            DATABASE_ID_2: [DATA_SOURCE_ID_3],
        }
        self.database_titles = {DATABASE_ID: "日记和文档", DATABASE_ID_2: "部署文档"}
        self.source_pages = {
            DATA_SOURCE_ID: [PAGE_SAFE],
            DATA_SOURCE_ID_2: [PAGE_SECOND_SOURCE],
            DATA_SOURCE_ID_3: [PAGE_SECOND_DATABASE],
        }
        self.authorized = {"journal-token": {DATABASE_ID, DATABASE_ID_2}, "deployment-token": {DATABASE_ID_2}}
        self.requests: list[httpx.Request] = []

    def transport(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            auth = request.headers.get("Authorization", "")
            token = auth.removeprefix("Bearer ")
            path = request.url.path
            for database_id, data_source_ids in self.database_sources.items():
                if path == f"/v1/databases/{database_id}":
                    if database_id not in self.authorized.get(token, set()):
                        return httpx.Response(404, json={"message": "object_not_found"})
                    return httpx.Response(200, json={
                        "object": "database",
                        "id": database_id,
                        "title": [{"plain_text": self.database_titles[database_id]}],
                        "data_sources": [{"id": source_id, "name": f"source-{index}"}
                                          for index, source_id in enumerate(data_source_ids)],
                    })
            for source_id, page_ids in self.source_pages.items():
                if path == f"/v1/data_sources/{source_id}":
                    return httpx.Response(200, json={
                        "object": "data_source",
                        "id": source_id,
                        "properties": {
                            "标题": {"id": "title", "type": "title", "title": {}},
                            "分类": {"id": "category", "type": "select", "select": {"options": []}},
                        },
                    })
                if path == f"/v1/data_sources/{source_id}/query":
                    return httpx.Response(200, json={
                        "results": [self.pages[page_id] for page_id in page_ids],
                        "has_more": False,
                        "next_cursor": None,
                    })
            if path.startswith("/v1/blocks/") and path.endswith("/children"):
                block_id = path.removeprefix("/v1/blocks/").removesuffix("/children")
                page = self.pages.get(block_id)
                body = page.get("_test_body", "") if page else ""
                return httpx.Response(200, json={"results": [
                    {"id": f"block-{block_id}", "type": "paragraph", "has_children": False,
                     "paragraph": {"rich_text": [{"plain_text": body}]}}
                ], "has_more": False, "next_cursor": None})
            return httpx.Response(404, json={})

        return httpx.MockTransport(handler)


@pytest_asyncio.fixture
async def notion_library_db():
    from app.db.session import Base
    from app.models import User

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with factory() as db:
        admin = User(username="library-admin", email="library-admin@example.com", hashed_password="unused", is_admin=True, is_active=True)
        db.add(admin)
        await db.commit()
        admin_id = admin.id
    try:
        yield factory, admin_id
    finally:
        await engine.dispose()


def library_credentials(tmp_path, connections=None):
    import json
    from app.services.notion_credentials import NotionCredentialStore

    records = connections or [{"id": "primary", "label": "Primary", "token": "unit-test-token"}]
    path = tmp_path / "notion-connections.json"
    path.write_text(json.dumps({"version": 1, "connections": records}))
    return NotionCredentialStore(path)


@pytest.mark.asyncio
async def test_inspection_is_read_only_and_reports_only_source_metadata(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, _ = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport())

    async with factory() as db:
        preview = await service.inspect(db, "primary", library_database_url())
        assert await db.scalar(select(func.count(NotionSource.id))) == 0
        assert await db.scalar(select(func.count(NotionDocument.id))) == 0

    assert preview["title"] == "日记和文档"
    assert preview["page_count"] == 2
    assert preview["data_source_count"] == 1
    assert preview["categories"] == ["部署"]
    assert "安全正文" not in str(preview)
    assert all(str(request.url.host) == "api.notion.com" for request in scenario.requests)
    assert all(request.headers.get("Notion-Version") == "2026-03-11" for request in scenario.requests)


@pytest.mark.asyncio
async def test_manual_import_publishes_safe_pages_and_isolates_credentials(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / "library.lock"))

    async with factory() as db:
        result = await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        docs = list((await db.scalars(select(NotionDocument).order_by(NotionDocument.notion_page_id))).all())
        source = await db.get(NotionSource, 1)

    assert result["counters"]["published"] == 1
    assert result["counters"]["isolated"] == 1
    assert docs[0].status == "published"
    assert docs[0].content == "安全正文"
    assert docs[0].categories == ["部署"]
    assert docs[1].status == "isolated"
    assert docs[1].content == ""
    assert docs[1].isolation_reason == "页面内容疑似包含凭据"
    assert source.title == "日记和文档"
    assert source.connection_id == "primary"
    assert "not-a-placeholder-secret" not in str(result)


@pytest.mark.asyncio
async def test_import_keeps_legacy_article_comments_author_tags_and_views(notion_library_db, tmp_path):
    from app.models import Comment, NotionDocument, NotionPage, Post, Tag
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / "library.lock"))
    async with factory() as db:
        post = Post(title="旧同步文章", slug="legacy-note", content="旧正文", author_id=admin_id,
                    is_published=True, view_count=17, tags=[Tag(name="旧标签", slug="legacy-tag")])
        db.add(post)
        await db.flush()
        comment = Comment(post_id=post.id, user_id=admin_id, content="原有评论")
        db.add_all([comment, NotionPage(notion_page_id=PAGE_SAFE, post_id=post.id, source_title=post.title)])
        await db.commit()

        await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == PAGE_SAFE))
        await db.refresh(comment)
        assert comment.post_id is None
        assert comment.notion_document_id == document.id
        assert document.author_id == admin_id
        assert document.view_count == 17
        assert document.categories == ["部署", "旧标签"]
        assert document.legacy_post_slug == post.slug
        await service.sync(db, document.source_id, admin_id)
        assert document.view_count == 17
        assert document.categories == ["部署", "旧标签"]


@pytest.mark.asyncio
async def test_source_query_failure_keeps_prior_publication(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryError, NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / "library.lock"))
    async with factory() as db:
        await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        before = await db.get(NotionDocument, 1)
        original_content = before.content
        scenario.query_failure = True
        with pytest.raises(NotionLibraryError):
            source = await db.scalar(select(NotionSource).where(NotionSource.database_id == DATABASE_ID))
            await service.sync(db, source.id, admin_id)
        await db.refresh(before)
        assert before.status == "published"
        assert before.content == original_content
        assert await db.scalar(select(func.count(NotionSource.id))) == 1


@pytest.mark.asyncio
async def test_manual_sync_is_idempotent_and_preserves_slug_after_title_change(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / "library.lock"))
    async with factory() as db:
        await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == PAGE_SAFE))
        slug = document.slug
        source = await db.scalar(select(NotionSource).where(NotionSource.database_id == DATABASE_ID))
        await service.sync(db, source.id, admin_id)
        scenario.pages[PAGE_SAFE]["properties"]["标题"]["title"][0]["plain_text"] = "新部署手册"
        scenario.pages[PAGE_SAFE]["_test_body"] = "更新后的安全正文"
        await service.sync(db, source.id, admin_id)
        await db.refresh(document)

    assert document.slug == slug
    assert document.title == "新部署手册"
    assert document.content == "更新后的安全正文"
    assert document.status == "published"


@pytest.mark.asyncio
async def test_manual_unpublish_survives_a_later_notion_sync(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / "library.lock"))
    async with factory() as db:
        await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == PAGE_SAFE))
        source = await db.scalar(select(NotionSource).where(NotionSource.database_id == DATABASE_ID))
        document.manual_unpublished = True
        document.status = "archived"
        await db.commit()

        await service.sync(db, source.id, admin_id)
        await db.refresh(document)

    assert document.manual_unpublished is True
    assert document.status == "archived"
    assert document.isolation_reason == "管理员手动下架"


@pytest.mark.asyncio
async def test_one_connection_can_import_multiple_data_sources_of_one_database(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = MultiConnectionScenario()
    credentials = library_credentials(tmp_path, [{"id": "journal", "label": "Journal", "token": "journal-token"}])
    service = NotionLibraryService(credentials, scenario.transport())

    async with factory() as db:
        preview = await service.inspect(db, "journal", library_database_url())
        assert await db.scalar(select(func.count(NotionSource.id))) == 0
        result = await service.import_source(db, "journal", library_database_url(), admin_id)
        await db.commit()
        source = await db.scalar(select(NotionSource).where(NotionSource.database_id == DATABASE_ID))
        documents = list((await db.scalars(select(NotionDocument).order_by(NotionDocument.notion_page_id))).all())

    assert preview["data_source_count"] == 2
    assert preview["page_count"] == 2
    assert result["counters"]["published"] == 2
    assert source.connection_id == "journal"
    assert source.data_source_ids == [DATA_SOURCE_ID, DATA_SOURCE_ID_2]
    assert {document.data_source_id for document in documents} == {DATA_SOURCE_ID, DATA_SOURCE_ID_2}
    assert all(request.headers.get("Authorization") == "Bearer journal-token" for request in scenario.requests)


@pytest.mark.asyncio
async def test_one_connection_can_be_reused_for_multiple_databases(notion_library_db, tmp_path):
    from app.models import NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = MultiConnectionScenario()
    credentials = library_credentials(tmp_path, [{"id": "journal", "label": "Journal", "token": "journal-token"}])
    service = NotionLibraryService(credentials, scenario.transport())
    second_url = f"https://www.notion.so/deployment/{DATABASE_ID_2.replace('-', '')}"

    async with factory() as db:
        await service.import_source(db, "journal", library_database_url(), admin_id)
        await service.import_source(db, "journal", second_url, admin_id)
        await db.commit()
        sources = list((await db.scalars(select(NotionSource).order_by(NotionSource.database_id))).all())

    assert len(sources) == 2
    assert {source.connection_id for source in sources} == {"journal"}
    assert {source.database_id for source in sources} == {DATABASE_ID, DATABASE_ID_2}


@pytest.mark.asyncio
async def test_wrong_connection_cannot_preview_or_persist_an_unshared_database(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryError, NotionLibraryService

    factory, _ = notion_library_db
    scenario = MultiConnectionScenario()
    credentials = library_credentials(tmp_path, [{"id": "deployment", "label": "Deployment", "token": "deployment-token"}])
    service = NotionLibraryService(credentials, scenario.transport())
    second_source_url = f"https://www.notion.so/journal/{DATABASE_ID.replace('-', '')}"

    async with factory() as db:
        with pytest.raises(NotionLibraryError, match="无法访问"):
            await service.inspect(db, "deployment", second_source_url)
        assert await db.scalar(select(func.count(NotionSource.id))) == 0
        assert await db.scalar(select(func.count(NotionDocument.id))) == 0


@pytest.mark.asyncio
async def test_inspect_allows_an_explicitly_selected_non_default_database(notion_library_db, tmp_path):
    from app.models import NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, _ = notion_library_db
    scenario = MultiConnectionScenario()
    credentials = library_credentials(tmp_path, [{"id": "journal", "label": "Journal", "token": "journal-token"}])
    service = NotionLibraryService(credentials, scenario.transport())
    url = f"https://www.notion.so/deployment/{DATABASE_ID_2.replace('-', '')}"

    async with factory() as db:
        preview = await service.inspect(db, "journal", url)
        assert await db.scalar(select(func.count(NotionSource.id))) == 0

    assert preview["title"] == "部署文档"


@pytest.mark.asyncio
@pytest.mark.parametrize("title, expected_slugs", [
    ("Same title", {"same-title", "same-title-1"}),
    ("A" * 210, {"a" * 200, "a" * 198 + "-1"}),
])
async def test_same_title_pages_import_with_distinct_stable_slugs(
    notion_library_db, tmp_path, title, expected_slugs
):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = MultiConnectionScenario()
    for page_id in (PAGE_SAFE, PAGE_SECOND_SOURCE):
        scenario.pages[page_id]["properties"]["标题"]["title"][0]["plain_text"] = title
    credentials = library_credentials(tmp_path, [
        {"id": "journal", "label": "Journal", "token": "journal-token"},
    ])
    service = NotionLibraryService(credentials, scenario.transport(), str(tmp_path / "library.lock"))

    async with factory() as db:
        await service.import_source(db, "journal", library_database_url(), admin_id)
        await db.commit()
        documents = list((await db.scalars(select(NotionDocument))).all())
        original_slugs = {doc.notion_page_id: doc.slug for doc in documents}
        assert set(original_slugs.values()) == expected_slugs
        assert all(doc.status == "published" for doc in documents)
        source = await db.scalar(select(NotionSource))
        await service.sync(db, source.id, admin_id)
        await db.commit()
        documents = list((await db.scalars(select(NotionDocument))).all())
        assert {doc.notion_page_id: doc.slug for doc in documents} == original_slugs


@pytest.mark.asyncio
async def test_page_preview_requires_registered_source_connection(notion_library_db, tmp_path):
    from app.models import NotionDocument, NotionSource
    from app.services.notion_library import NotionLibraryError, NotionLibraryService

    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    credentials = library_credentials(tmp_path, [
        {"id": "primary", "label": "Primary", "token": "primary-test-token"},
        {"id": "other", "label": "Other", "token": "other-test-token"},
    ])
    service = NotionLibraryService(credentials, scenario.transport(), str(tmp_path / "library.lock"))

    async with factory() as db:
        await service.import_source(db, "primary", library_database_url(), admin_id)
        await db.commit()
        preview = await service.inspect(db, "primary", library_page_url())
        assert preview["publishable_count"] == 1
        request_count = len(scenario.requests)

        with pytest.raises(NotionLibraryError, match="来源"):
            await service.inspect(db, "other", library_page_url())

        source = await db.scalar(select(NotionSource))
        assert source.connection_id == "primary"
        document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == PAGE_SAFE))
        assert document.content == "安全正文"
        assert not any("/blocks/" in request.url.path for request in scenario.requests[request_count:])
