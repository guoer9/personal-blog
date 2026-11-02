from pathlib import Path
import os
import asyncio
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from pydantic import SecretStr, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


def test_notion_settings_are_separate_and_safe_by_default():
    from app.core.notion_config import NotionSettings

    config = NotionSettings(_env_file=None)

    assert config.NOTION_TOKEN is None
    assert config.NOTION_DATA_SOURCE_ID is None
    assert config.NOTION_SYNC_ENABLED is False
    assert config.NOTION_SYNC_INTERVAL_SECONDS == 300
    assert config.is_ready is False

    ready = NotionSettings(
        _env_file=None,
        NOTION_TOKEN=SecretStr("secret-token"),
        NOTION_DATA_SOURCE_ID=UUID("11111111-1111-1111-1111-111111111111"),
    )
    assert ready.is_ready is True
    assert ready.token_configured is True
    assert ready.data_source_configured is True


def test_notion_settings_reject_short_sync_interval():
    from app.core.notion_config import NotionSettings

    with pytest.raises(ValidationError):
        NotionSettings(_env_file=None, NOTION_SYNC_INTERVAL_SECONDS=59)


def test_notion_settings_treat_blank_compose_values_as_unconfigured():
    from app.core.notion_config import NotionSettings

    config = NotionSettings(
        _env_file=None,
        NOTION_TOKEN="",
        NOTION_DATA_SOURCE_ID="",
    )

    assert config.is_ready is False
    assert config.token_configured is False
    assert config.data_source_configured is False


def test_notion_models_are_exported_and_source_mapping_is_unique():
    from app.models import NotionPage, NotionSyncState

    assert NotionPage.__tablename__ == "notion_pages"
    assert NotionSyncState.__tablename__ == "notion_sync_state"
    assert NotionPage.__table__.c.notion_page_id.unique is True
    assert NotionPage.__table__.c.post_id.unique is True
    assert NotionSyncState.__table__.c.id.primary_key is True


def test_notion_migration_is_chained_after_works_publication():
    migration_path = Path(__file__).parents[1] / "alembic" / "versions" / "notion_v1_sync.py"
    namespace = {}
    exec(compile(migration_path.read_text(), str(migration_path), "exec"), namespace)

    assert namespace["revision"] == "notion_v1_sync"
    assert namespace["down_revision"] == "works_v1_publication"


def notion_config():
    from app.core.notion_config import NotionSettings

    return NotionSettings(
        _env_file=None,
        NOTION_TOKEN=SecretStr("test-token"),
        NOTION_DATA_SOURCE_ID=UUID("11111111-1111-1111-1111-111111111111"),
    )


def notion_enabled_config():
    from app.core.notion_config import NotionSettings

    return NotionSettings(
        _env_file=None,
        NOTION_TOKEN=SecretStr("test-token"),
        NOTION_DATA_SOURCE_ID=UUID("11111111-1111-1111-1111-111111111111"),
        NOTION_SYNC_ENABLED=True,
        NOTION_SYNC_INTERVAL_SECONDS=60,
    )


def data_source_payload():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "properties": {
            "标题": {"id": "title", "type": "title", "title": {}},
            "发布到博客": {"id": "check", "type": "checkbox", "checkbox": {}},
        },
    }


def notion_page(page_id: str, title: str, checked: bool = True, archived: bool = False, in_trash: bool = False):
    return {
        "id": page_id,
        "archived": archived,
        "in_trash": in_trash,
        "properties": {
            "标题": {
                "id": "title",
                "type": "title",
                "title": [{"type": "text", "plain_text": title, "text": {"content": title}}],
            },
            "发布到博客": {"id": "check", "type": "checkbox", "checkbox": checked},
        },
    }


PAGE_ONE = "11111111-1111-1111-1111-111111111101"
PAGE_TWO = "11111111-1111-1111-1111-111111111102"


class NotionScenario:
    def __init__(self):
        self.pages = {}
        self.contents = {}
        self.blocks = {}
        self.deleted = set()
        self.fail_query = False
        self.block_query = False
        self.query_started = asyncio.Event()
        self.release_query = asyncio.Event()

    def add_page(self, page_id=PAGE_ONE, title="First note", content="First body", checked=True, archived=False):
        self.pages[page_id] = notion_page(page_id, title, checked=checked, archived=archived)
        self.contents[page_id] = content

    def transport(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path.endswith("/data_sources/11111111-1111-1111-1111-111111111111"):
                return httpx.Response(200, json=data_source_payload())
            if path.endswith("/query") and request.method == "POST":
                self.query_started.set()
                if self.block_query:
                    await self.release_query.wait()
                if self.fail_query:
                    return httpx.Response(500, json={"message": "opaque upstream failure"})
                checked_pages = [page for page in self.pages.values() if page["properties"]["发布到博客"]["checkbox"] and not page["archived"] and not page["in_trash"]]
                return httpx.Response(200, json={"results": checked_pages, "has_more": False, "next_cursor": None})
            if request.method == "GET" and "/pages/" in path:
                page_id = path.rsplit("/", 1)[-1]
                if page_id in self.deleted:
                    return httpx.Response(404, json={"message": "not found"})
                page = self.pages.get(page_id)
                return httpx.Response(200, json=page) if page else httpx.Response(404, json={"message": "not found"})
            if request.method == "GET" and "/blocks/" in path and path.endswith("/children"):
                block_id = path.split("/blocks/", 1)[1].split("/children", 1)[0]
                if block_id in self.blocks:
                    return httpx.Response(200, json={"results": self.blocks[block_id], "has_more": False, "next_cursor": None})
                if block_id in self.contents:
                    content = self.contents[block_id]
                    blocks = [{"id": "block-" + block_id[-4:], "type": "paragraph", "has_children": False, "paragraph": {"rich_text": [{"plain_text": content}]}}]
                    return httpx.Response(200, json={"results": blocks, "has_more": False, "next_cursor": None})
                page_id = next((key for key, page in self.pages.items() if page["id"] == block_id), None)
                if page_id and page_id in self.contents:
                    content = self.contents[page_id]
                    blocks = [{"id": "block-" + page_id[-4:], "type": "paragraph", "has_children": False, "paragraph": {"rich_text": [{"plain_text": content}]}}]
                    return httpx.Response(200, json={"results": blocks, "has_more": False, "next_cursor": None})
                return httpx.Response(200, json={"results": [], "has_more": False, "next_cursor": None})
            raise AssertionError(f"unexpected Notion request: {request.method} {request.url}")

        return httpx.MockTransport(handler)


@pytest_asyncio.fixture
async def notion_database():
    from app.db.session import Base
    from app.models import User

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with factory() as db:
        admin = User(
            username="notion-admin",
            email="notion-admin@example.com",
            hashed_password="unused-test-hash",
            is_admin=True,
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        admin_id = admin.id
    try:
        yield factory, admin_id
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def notion_postgres_database():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db.session import Base
    from app.models import User

    url = os.environ.get("LIBRARY_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set LIBRARY_TEST_POSTGRES_URL for isolated PostgreSQL verification")

    schema = "notion_test_" + uuid4().hex
    engine = create_async_engine(
        url, connect_args={"server_settings": {"search_path": schema}}
    )
    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with factory() as db:
        admin = User(
            username="notion-pg-admin",
            email=f"notion-pg-{schema}@example.com",
            hashed_password="unused-test-hash",
            is_admin=True,
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        admin_id = admin.id
    try:
        yield factory, admin_id
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


@pytest_asyncio.fixture
async def notion_api_client(notion_database):
    from fastapi import FastAPI
    from app.api.v1 import notion as notion_api
    from app.core.security import create_access_token
    from app.db.session import get_db

    factory, admin_id = notion_database
    app = FastAPI()
    app.include_router(notion_api.router, prefix="/api/v1")

    async def override_get_db():
        async with factory() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        yield client, factory, admin_id, create_access_token(admin_id), notion_api
    app.dependency_overrides.clear()


async def row_counts(db):
    from app.models import NotionPage, Post

    return {
        "posts": await db.scalar(select(func.count(Post.id))),
        "mappings": await db.scalar(select(func.count(NotionPage.id))),
    }


@pytest.mark.asyncio
async def test_notion_client_fetches_paginated_pages_and_recursive_markdown():
    from app.services.notion_sync import NotionClient, NotionSyncService

    requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer test-token"
        assert request.headers["notion-version"] == "2025-09-03"
        if request.method == "GET" and request.url.path.endswith("/data_sources/11111111-1111-1111-1111-111111111111"):
            return httpx.Response(200, json=data_source_payload())
        if request.method == "POST" and request.url.path.endswith("/query"):
            body = request.read().decode()
            if '"start_cursor"' in body:
                return httpx.Response(200, json={"results": [notion_page("page-2", "第二页")], "has_more": False, "next_cursor": None})
            return httpx.Response(200, json={"results": [notion_page("page-1", "第一页")], "has_more": True, "next_cursor": "cursor-2"})
        if request.method == "GET" and request.url.path.endswith("/pages/page-1"):
            return httpx.Response(200, json=notion_page("page-1", "第一页"))
        if request.method == "GET" and request.url.path.endswith("/pages/page-2"):
            return httpx.Response(200, json=notion_page("page-2", "第二页"))
        if request.method == "GET" and request.url.path.endswith("/blocks/page-1/children"):
            if "start_cursor=block-2" in str(request.url):
                return httpx.Response(200, json={"results": [{"id": "bullet-1", "type": "bulleted_list_item", "has_children": True, "bulleted_list_item": {"rich_text": [{"plain_text": "列表项"}]}}], "has_more": False, "next_cursor": None})
            return httpx.Response(200, json={"results": [{"id": "para-1", "type": "paragraph", "has_children": False, "paragraph": {"rich_text": [{"plain_text": "正文"}]}}], "has_more": True, "next_cursor": "block-2"})
        if request.method == "GET" and request.url.path.endswith("/blocks/bullet-1/children"):
            return httpx.Response(200, json={"results": [{"id": "nested-1", "type": "paragraph", "has_children": False, "paragraph": {"rich_text": [{"plain_text": "嵌套"}]}}], "has_more": False, "next_cursor": None})
        if request.method == "GET" and request.url.path.endswith("/blocks/page-2/children"):
            return httpx.Response(200, json={"results": [{"id": "para-2", "type": "heading_2", "has_children": False, "heading_2": {"rich_text": [{"plain_text": "标题"}]}}], "has_more": False, "next_cursor": None})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async with NotionClient(notion_config(), transport=httpx.MockTransport(handler)) as client:
        service = NotionSyncService(notion_config())
        schema = await service.verify_data_source(client)
        pages = await service.fetch_checked_pages(client, schema)

    assert [page.source_id for page in pages] == ["page-1", "page-2"]
    assert pages[0].content == "正文\n- 列表项\n  嵌套"
    assert pages[1].content == "## 标题"
    query_requests = [request for request in requests if request.method == "POST"]
    assert len(query_requests) == 2
    assert '"发布到博客"' in query_requests[0].read().decode()
    assert '"equals":true' in query_requests[0].read().decode().replace(" ", "")


@pytest.mark.asyncio
async def test_data_source_query_rejects_missing_pagination_metadata():
    from app.services.notion_sync import NotionClient, NotionSyncError

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    async with NotionClient(
        notion_config(), transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(NotionSyncError, match="pagination metadata"):
            await client.query_data_source({})


@pytest.mark.asyncio
async def test_block_query_rejects_missing_pagination_metadata():
    from app.services.notion_sync import NotionClient, NotionSyncError, NotionSyncService

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    async with NotionClient(
        notion_config(), transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(NotionSyncError, match="pagination metadata"):
            await NotionSyncService(notion_config())._read_children(client, "page-1")


@pytest.mark.asyncio
async def test_private_signed_file_image_blocks_publication():
    from app.services.notion_sync import NotionClient, NotionSyncError, NotionSyncService

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/data_sources/11111111-1111-1111-1111-111111111111"):
            return httpx.Response(200, json=data_source_payload())
        if request.method == "POST":
            return httpx.Response(200, json={"results": [notion_page("page-image", "含私有图片")], "has_more": False, "next_cursor": None})
        if request.url.path.endswith("/pages/page-image"):
            return httpx.Response(200, json=notion_page("page-image", "含私有图片"))
        return httpx.Response(200, json={"results": [{"id": "image-1", "type": "image", "has_children": False, "image": {"type": "file", "file": {"url": "https://signed.notion.invalid/private"}}}], "has_more": False, "next_cursor": None})

    async with NotionClient(notion_config(), transport=httpx.MockTransport(handler)) as client:
        service = NotionSyncService(notion_config())
        schema = await service.verify_data_source(client)
        with pytest.raises(NotionSyncError, match="images"):
            await service.fetch_checked_pages(client, schema)


@pytest.mark.asyncio
async def test_notion_data_source_requires_exact_checkbox_schema():
    from app.services.notion_sync import NotionClient, NotionSyncError, NotionSyncService

    invalid_schema = data_source_payload()
    invalid_schema["properties"]["发布到博客"]["type"] = "rich_text"

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=invalid_schema)

    async with NotionClient(notion_config(), transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(NotionSyncError, match="exact 发布到博客 checkbox"):
            await NotionSyncService(notion_config()).verify_data_source(client)


@pytest.mark.asyncio
async def test_malformed_title_rich_text_blocks_partial_publication(notion_database, tmp_path):
    from app.models import Post
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(title="Complete title", content="Body")
    source.pages[PAGE_ONE]["properties"]["标题"]["title"].append({"malformed": True})
    service = NotionSyncService(
        notion_config(), source.transport(), str(tmp_path / "title-sync.lock")
    )

    async with factory() as db:
        with pytest.raises(NotionSyncError, match="title property is incomplete"):
            await service.sync(db, author_id)
        assert await db.scalar(select(func.count(Post.id))) == 0


@pytest.mark.asyncio
async def test_malformed_code_rich_text_blocks_partial_publication(notion_database, tmp_path):
    from app.models import Post
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(content="Body")
    source.blocks[PAGE_ONE] = [
        {
            "id": "code-1",
            "type": "code",
            "has_children": False,
            "code": {
                "language": "python",
                "rich_text": [{"plain_text": "complete prefix"}, {"malformed": True}],
            },
        }
    ]
    service = NotionSyncService(
        notion_config(), source.transport(), str(tmp_path / "code-sync.lock")
    )

    async with factory() as db:
        with pytest.raises(NotionSyncError, match="code block text is incomplete"):
            await service.sync(db, author_id)
        assert await db.scalar(select(func.count(Post.id))) == 0


@pytest.mark.asyncio
async def test_missing_child_metadata_blocks_partial_publication(notion_database, tmp_path):
    from app.models import Post
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(content="Body")
    source.blocks[PAGE_ONE] = [
        {
            "id": "paragraph-1",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"plain_text": "Looks complete"}]},
        }
    ]
    service = NotionSyncService(
        notion_config(), source.transport(), str(tmp_path / "children-sync.lock")
    )

    async with factory() as db:
        with pytest.raises(NotionSyncError, match="child metadata"):
            await service.sync(db, author_id)
        assert await db.scalar(select(func.count(Post.id))) == 0


@pytest.mark.asyncio
async def test_notion_tables_convert_to_markdown_without_truncating_children():
    from app.services.notion_sync import NotionClient, NotionSyncService

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/blocks/page-table/children"):
            return httpx.Response(200, json={"results": [{"id": "table-1", "type": "table", "has_children": True, "table": {}}], "has_more": False, "next_cursor": None})
        if request.url.path.endswith("/blocks/table-1/children"):
            return httpx.Response(200, json={"results": [
                {"id": "row-1", "type": "table_row", "has_children": False, "table_row": {"cells": [[{"plain_text": "A"}], [{"plain_text": "B"}]]}},
                {"id": "row-2", "type": "table_row", "has_children": False, "table_row": {"cells": [[{"plain_text": "1"}], [{"plain_text": "2"}]]}},
            ], "has_more": False, "next_cursor": None})
        raise AssertionError(f"unexpected request: {request.url}")

    async with NotionClient(notion_config(), transport=httpx.MockTransport(handler)) as client:
        markdown = await NotionSyncService(notion_config())._page_markdown(client, "page-table")

    assert markdown == "| A | B |\n| --- | --- |\n| 1 | 2 |"


def test_unknown_block_type_is_rejected_instead_of_silently_dropped():
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    with pytest.raises(NotionSyncError, match="Unsupported Notion block type"):
        NotionSyncService(notion_config())._render_block("unsupported_block", {})


@pytest.mark.asyncio
async def test_sync_publishes_public_post_idempotently_and_preserves_slug_on_title_change(notion_database, tmp_path):
    from app.crud.post import get_post_by_slug, get_posts
    from app.models import NotionPage, Post
    from app.services.notion_sync import NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page()
    service = NotionSyncService(notion_config(), source.transport(), str(tmp_path / "sync.lock"))

    async with factory() as db:
        first = await service.sync(db, author_id)
        assert first["status"] == "success"
        assert first["counters"]["published"] == 1
        post = await db.scalar(select(Post))
        original_slug = post.slug
        assert post.is_published is True
        assert post.content == "First body"
        assert await get_post_by_slug(db, original_slug) is post
        assert len((await get_posts(db, include_unpublished=False))[0]) == 1

        second = await service.sync(db, author_id)
        assert second["counters"]["published"] == 0
        assert second["counters"]["updated"] == 0
        assert second["counters"]["skipped"] == 1
        assert await db.scalar(select(func.count(Post.id))) == 1
        assert await db.scalar(select(func.count(NotionPage.id))) == 1

        source.add_page(title="Renamed note", content="Updated body")
        changed = await service.sync(db, author_id)
        post = await db.scalar(select(Post))
        assert changed["counters"]["updated"] == 1
        assert post.title == "Renamed note"
        assert post.content == "Updated body"
        assert post.slug == original_slug


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["unchecked", "archived", "missing"])
async def test_sync_unpublishes_only_after_individual_page_confirmation(notion_database, tmp_path, state):
    from app.crud.post import get_post_by_slug
    from app.models import NotionPage, Post
    from app.services.notion_sync import NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page()
    service = NotionSyncService(notion_config(), source.transport(), str(tmp_path / "sync.lock"))

    async with factory() as db:
        await service.sync(db, author_id)
        post = await db.scalar(select(Post))
        slug = post.slug
        if state == "unchecked":
            source.add_page(checked=False)
        elif state == "archived":
            source.add_page(archived=True)
        else:
            source.pages.pop(PAGE_ONE)
            source.contents.pop(PAGE_ONE)
            source.deleted.add(PAGE_ONE)

        result = await service.sync(db, author_id)
        post = await db.scalar(select(Post))
        mapping = await db.scalar(select(NotionPage))
        assert result["counters"]["unpublished"] == 1
        assert post.is_published is False
        assert mapping is not None
        assert mapping.notion_page_id == PAGE_ONE
        assert await get_post_by_slug(db, slug) is None


@pytest.mark.asyncio
async def test_failed_query_preserves_published_content_and_records_safe_error(notion_database, tmp_path):
    from app.models import NotionSyncState, Post
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(content="Published copy")
    service = NotionSyncService(notion_config(), source.transport(), str(tmp_path / "sync.lock"))

    async with factory() as db:
        await service.sync(db, author_id)
        source.fail_query = True
        with pytest.raises(NotionSyncError):
            await service.sync(db, author_id)
        post = await db.scalar(select(Post))
        state = await db.get(NotionSyncState, 1)
        assert post.is_published is True
        assert post.content == "Published copy"
        assert state.status == "error"
        assert state.last_error == "Notion returned an unsuccessful response"
        assert "token" not in state.last_error.lower()


@pytest.mark.asyncio
async def test_conversion_failure_keeps_prior_publication_and_round_atomic(notion_database, tmp_path):
    from app.models import NotionPage, Post
    from app.services.notion_sync import NotionSyncError, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(PAGE_ONE, "Good note", "Will be staged first")
    service = NotionSyncService(notion_config(), source.transport(), str(tmp_path / "sync.lock"))

    async with factory() as db:
        await service.sync(db, author_id)
        published = await db.scalar(select(Post))
        assert published is not None
        original_slug = published.slug

        source.contents[PAGE_ONE] = "Changed but must not be partially written"
        source.add_page(PAGE_TWO, "Unsupported note", "ignored")
        source.blocks[PAGE_TWO] = [{"id": "bad-1", "type": "unsupported_block", "has_children": False, "unsupported_block": {}}]
        with pytest.raises(NotionSyncError, match="Unsupported Notion block type"):
            await service.sync(db, author_id)
        await db.refresh(published)
        assert published.is_published is True
        assert published.content == "Will be staged first"
        assert published.slug == original_slug
        assert await db.scalar(select(func.count(Post.id))) == 1
        assert await db.scalar(select(func.count(NotionPage.id))) == 1


@pytest.mark.asyncio
async def test_shared_posix_lock_rejects_parallel_sync(notion_database, tmp_path):
    from app.services.notion_sync import NotionSyncBusy, NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page()
    source.block_query = True
    lock_path = str(tmp_path / "shared-sync.lock")
    first_service = NotionSyncService(notion_config(), source.transport(), lock_path)
    second_service = NotionSyncService(notion_config(), source.transport(), lock_path)

    async with factory() as first_db, factory() as second_db:
        first = asyncio.create_task(first_service.sync(first_db, author_id))
        await asyncio.wait_for(source.query_started.wait(), timeout=2)
        with pytest.raises(NotionSyncBusy):
            await second_service.sync(second_db, author_id)
        source.release_query.set()
        result = await first
        assert result["status"] == "success"


@pytest.mark.asyncio
async def test_status_contract_is_safe_and_includes_configuration_and_counters(notion_database):
    from app.services.notion_sync import NotionSyncService

    factory, _ = notion_database
    service = NotionSyncService(notion_config())
    async with factory() as db:
        status = await service.get_status(db)

    assert status == {
        "ready": True,
        "enabled": False,
        "interval_seconds": 300,
        "status": "never",
        "last_started_at": None,
        "last_finished_at": None,
        "last_success_at": None,
        "last_error": None,
        "counters": {"queried": 0, "published": 0, "updated": 0, "unpublished": 0, "skipped": 0, "failed": 0},
    }


@pytest.mark.asyncio
async def test_disabled_or_incomplete_scheduler_does_not_call_notion(notion_database):
    from app.core.notion_config import NotionSettings
    from app.services.notion_sync import NotionSyncService

    factory, _ = notion_database
    source = NotionScenario()
    disabled = NotionSyncService(notion_config(), source.transport())
    incomplete = NotionSyncService(NotionSettings(_env_file=None), source.transport())

    async with disabled.scheduler(factory):
        await asyncio.sleep(0)
    async with incomplete.scheduler(factory):
        await asyncio.sleep(0)

    assert not source.query_started.is_set()


@pytest.mark.asyncio
async def test_enabled_scheduler_runs_and_stops_cleanly(notion_database):
    from app.models import NotionSyncState
    from app.services.notion_sync import NotionSyncService

    factory, _ = notion_database
    source = NotionScenario()
    source.add_page()
    service = NotionSyncService(notion_enabled_config(), source.transport())
    session_closed = asyncio.Event()

    class ObservedSessionContext:
        def __init__(self):
            self.context = None

        async def __aenter__(self):
            self.context = factory()
            return await self.context.__aenter__()

        async def __aexit__(self, *args):
            try:
                return await self.context.__aexit__(*args)
            finally:
                session_closed.set()

    def observed_factory():
        return ObservedSessionContext()

    async with service.scheduler(observed_factory):
        await asyncio.wait_for(source.query_started.wait(), timeout=2)
        await asyncio.wait_for(session_closed.wait(), timeout=2)

    async with factory() as db:
        state = await db.get(NotionSyncState, 1)
        assert state.status == "success"


@pytest.mark.asyncio
async def test_post_timestamps_are_naive_utc_while_sync_state_uses_aware_utc(notion_database, tmp_path):
    from sqlalchemy import event
    from app.models import NotionSyncState, Post
    from app.services.notion_sync import NotionSyncService

    factory, author_id = notion_database
    source = NotionScenario()
    source.add_page(title="Timestamp note", content="first")
    service = NotionSyncService(notion_config(), source.transport(), str(tmp_path / "sync.lock"))
    captured = {"post_insert": [], "post_update": [], "sync_state": []}

    def capture_bind_values(connection, cursor, statement, parameters, context, executemany):
        if context is None:
            return
        normalized = statement.lower()
        for values in context.compiled_parameters:
            if normalized.startswith("insert into posts"):
                captured["post_insert"].append(values)
            elif normalized.startswith("update posts"):
                captured["post_update"].append(values)
            elif "notion_sync_state" in normalized:
                captured["sync_state"].append(values)

    engine = factory.kw["bind"].sync_engine
    event.listen(engine, "before_cursor_execute", capture_bind_values)
    try:
        async with factory() as db:
            await service.sync(db, author_id)
            post = await db.scalar(select(Post))
            state = await db.get(NotionSyncState, 1)
            assert post is not None
            assert state is not None

            source.add_page(title="Renamed note", content="second")
            await service.sync(db, author_id)
            await db.refresh(post)
            assert post.title == "Renamed note"
    finally:
        event.remove(engine, "before_cursor_execute", capture_bind_values)

    inserted_post = captured["post_insert"][0]
    updated_post = next(values for values in captured["post_update"] if "updated_at" in values)
    started_state_values = next(
        values for values in captured["sync_state"] if values.get("last_started_at") is not None
    )
    finished_state_values = next(
        values for values in captured["sync_state"] if values.get("last_finished_at") is not None
    )
    assert inserted_post["created_at"].tzinfo is None
    assert inserted_post["updated_at"].tzinfo is None
    assert updated_post["updated_at"].tzinfo is None
    assert started_state_values["last_started_at"].tzinfo is not None
    assert finished_state_values["last_finished_at"].tzinfo is not None


@pytest.mark.asyncio
async def test_admin_api_commits_success_and_sanitized_failure_status(
    notion_api_client, tmp_path, monkeypatch
):
    from app.models import NotionSyncState, Post
    from app.services.notion_sync import NotionSyncService

    client, factory, _, token, notion_api = notion_api_client
    source = NotionScenario()
    source.add_page(content="Mock-only published copy")
    service = NotionSyncService(
        notion_config(), source.transport(), str(tmp_path / "api-sync.lock")
    )
    monkeypatch.setattr(notion_api, "notion_sync_service", service)
    headers = {"Authorization": f"Bearer {token}"}

    unauthenticated = await client.get("/api/v1/admin/notion/legacy/status")
    assert unauthenticated.status_code == 401

    status_response = await client.get("/api/v1/admin/notion/legacy/status", headers=headers)
    assert status_response.status_code == 200
    assert set(status_response.json()) == {
        "ready", "enabled", "interval_seconds", "status", "last_started_at",
        "last_finished_at", "last_success_at", "last_error", "counters",
    }
    assert status_response.json()["status"] == "never"

    success = await client.post("/api/v1/admin/notion/sync", headers=headers)
    assert success.status_code == 200
    assert success.json()["status"] == "success"
    async with factory() as db:
        assert await db.scalar(select(func.count(Post.id))) == 1
        state = await db.get(NotionSyncState, 1)
        assert state.status == "success"

    source.fail_query = True
    failure = await client.post("/api/v1/admin/notion/sync", headers=headers)
    assert failure.status_code == 502
    failure_status = failure.json()
    assert set(failure_status) == set(status_response.json())
    assert failure_status["status"] == "error"
    assert failure_status["last_error"] == "Notion returned an unsuccessful response"
    assert failure_status["counters"]["failed"] == 1

    persisted = await client.get("/api/v1/admin/notion/legacy/status", headers=headers)
    assert persisted.status_code == 200
    assert persisted.json()["status"] == "error"
    assert persisted.json()["last_error"] == "Notion returned an unsuccessful response"
    assert "opaque upstream failure" not in persisted.text
    assert "test-token" not in persisted.text


@pytest.mark.asyncio
async def test_admin_api_enforces_admin_and_reports_not_ready_or_busy(
    notion_api_client, monkeypatch
):
    from app.core.notion_config import NotionSettings
    from app.core.security import create_access_token
    from app.models import User
    from app.services.notion_sync import NotionSyncBusy, NotionSyncService

    client, factory, _, token, notion_api = notion_api_client
    async with factory() as db:
        non_admin = User(
            username="notion-non-admin",
            email="notion-non-admin@example.com",
            hashed_password="unused-test-hash",
            is_admin=False,
            is_active=True,
        )
        db.add(non_admin)
        await db.commit()
        non_admin_token = create_access_token(non_admin.id)

    forbidden = await client.get(
        "/api/v1/admin/notion/legacy/status",
        headers={"Authorization": f"Bearer {non_admin_token}"},
    )
    assert forbidden.status_code == 403

    not_ready = NotionSyncService(NotionSettings(_env_file=None))
    monkeypatch.setattr(notion_api, "notion_sync_service", not_ready)
    response = await client.post(
        "/api/v1/admin/notion/sync",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "Notion sync is not configured"

    busy_service = NotionSyncService(notion_config())

    async def raise_busy(db, author_id=None):
        raise NotionSyncBusy("A Notion sync is already running")

    monkeypatch.setattr(busy_service, "sync", raise_busy)
    monkeypatch.setattr(notion_api, "notion_sync_service", busy_service)
    response = await client.post(
        "/api/v1/admin/notion/sync",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "A Notion sync is already running"


@pytest.mark.asyncio
async def test_notion_sync_postgresql_timestamp_compatibility(notion_postgres_database, tmp_path):
    from app.models import NotionSyncState, Post
    from app.services.notion_sync import NotionSyncService

    factory, author_id = notion_postgres_database
    source = NotionScenario()
    source.add_page(title="PostgreSQL timestamp note", content="first")
    service = NotionSyncService(
        notion_config(), source.transport(), str(tmp_path / "pg-sync.lock")
    )

    async with factory() as db:
        await service.sync(db, author_id)
        await db.commit()
        post = await db.scalar(select(Post))
        state = await db.get(NotionSyncState, 1)
        assert post is not None
        assert post.created_at.tzinfo is None
        assert post.updated_at.tzinfo is None
        assert state is not None
        assert state.last_started_at.tzinfo is not None
        assert state.last_finished_at.tzinfo is not None

        source.add_page(title="Renamed PostgreSQL timestamp note", content="second")
        await service.sync(db, author_id)
        await db.commit()
        await db.refresh(post)
        assert post.title == "Renamed PostgreSQL timestamp note"
        assert post.updated_at.tzinfo is None
