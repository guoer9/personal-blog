"""Manual, allowlisted Notion import for the public document library."""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import json
import os
import tempfile
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from slugify import slugify
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.notion_config import NotionSettings
from app.models.notion import NotionPage
from app.models.comment import Comment
from app.models.notion_library import NotionDocument, NotionLibrarySyncState, NotionSource
from app.services.notion_credentials import (
    NotionConnectionCredential,
    NotionCredentialError,
    NotionCredentialStore,
)
from app.services.notion_sync import NotionSyncError, NotionSyncService
from app.services.notion_content import NotionContentReader


NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_API_VERSION = "2026-03-11"
MAX_API_PAGES = 100
MAX_SOURCE_PAGES = 10_000


class NotionLibraryError(RuntimeError):
    """Sanitized Notion library failure; safe for admin responses."""


class NotionLibraryBusy(NotionLibraryError):
    pass


@dataclass(frozen=True)
class ParsedNotionLink:
    kind: Literal["database_or_page"]
    entity_id: str


@dataclass(frozen=True)
class SourceSchema:
    title_property: str
    category_properties: tuple[str, ...]


@dataclass(frozen=True)
class PageResult:
    notion_page_id: str
    data_source_id: str | None
    title: str
    content: str
    categories: tuple[str, ...]
    status: Literal["published", "isolated", "archived"]
    isolation_reason: str | None
    last_edited_at: datetime | None
    blocks: list[dict[str, Any]] | None = None
    icon: str | None = None
    cover_url: str | None = None


@dataclass(frozen=True)
class SourceSnapshot:
    connection_id: str
    database_id: str
    title: str
    source_url: str
    data_sources: tuple[tuple[str, str], ...]
    source_type: Literal["database", "page"] = "database"


_NOTION_ID_RE = re.compile(
    r"(?i)(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})"
)
_SECRET_PATTERNS = (
    re.compile(r"(?i)\bntn_[a-z0-9_-]{20,}"),
    re.compile(r"(?i)\bsecret_[a-z0-9_-]{20,}"),
    re.compile(r"(?i)\bgh[pousr]_[a-z0-9]{20,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(
        r"(?im)\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)"
        r"\s*[:=]\s*['\"]?([^\s'\"]{8,})"
    ),
)
_PLACEHOLDERS = {
    "example",
    "example123",
    "placeholder",
    "changeme",
    "change-me",
    "your_password",
    "your-api-key",
    "replace-me",
    "replace_me",
    "<secret>",
    "<password>",
    "xxx",
}


def parse_notion_source_url(value: str) -> ParsedNotionLink:
    if not isinstance(value, str) or len(value) > 2048:
        raise NotionLibraryError("请粘贴有效的 Notion 链接")
    try:
        parsed = urlparse(value.strip())
        hostname = (parsed.hostname or "").lower().rstrip(".")
    except ValueError:
        raise NotionLibraryError("请粘贴有效的 Notion 链接") from None

    notion_host = hostname in {"notion.so", "notion.site", "app.notion.com"} or hostname.endswith(
        (".notion.so", ".notion.site")
    )
    if (
        parsed.scheme != "https"
        or not notion_host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or not parsed.path
        or parsed.path.startswith(("/developers/", "/library/"))
    ):
        raise NotionLibraryError("只支持 HTTPS Notion 数据库或页面链接")

    match = _NOTION_ID_RE.search(parsed.path)
    if match is None:
        raise NotionLibraryError("Notion 链接中没有可识别的数据库或页面 ID")
    compact = match.group(0).replace("-", "").lower()
    normalized = f"{compact[:8]}-{compact[8:12]}-{compact[12:16]}-{compact[16:20]}-{compact[20:]}"
    return ParsedNotionLink("database_or_page", normalized)


class NotionLibraryClient:
    """Version-pinned client that only talks to api.notion.com."""

    def __init__(
        self,
        credential: NotionConnectionCredential,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        token = credential.token.get_secret_value()
        self._client = httpx.AsyncClient(
            base_url=NOTION_API_BASE,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": NOTION_API_VERSION,
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(20.0, connect=5.0),
            transport=transport,
        )

    async def __aenter__(self) -> "NotionLibraryClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        allow_not_found: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any] | None:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.TimeoutException:
            raise NotionLibraryError("Notion 请求超时") from None
        except httpx.HTTPError:
            raise NotionLibraryError("Notion 请求失败") from None
        if response.status_code == 404 and allow_not_found:
            return None
        if response.status_code == 400 and allow_not_found and path.startswith("/databases/"):
            try:
                problem = response.json()
            except ValueError:
                problem = {}
            if problem.get("code") == "validation_error" and "is a page, not a database" in str(problem.get("message", "")):
                return None
        if response.status_code == 404:
            raise NotionLibraryError("Notion 数据库或页面无法访问")
        if response.status_code in (401, 403):
            raise NotionLibraryError("Notion 授权失败或尚未授予只读访问权限")
        if response.status_code == 429:
            raise NotionLibraryError("Notion 请求过于频繁，请稍后重试")
        if response.is_error:
            raise NotionLibraryError("Notion 暂时无法完成请求")
        try:
            payload = response.json()
        except ValueError:
            raise NotionLibraryError("Notion 返回了无法识别的数据") from None
        if not isinstance(payload, dict):
            raise NotionLibraryError("Notion 返回了无法识别的数据")
        return payload

    async def get_database(
        self, database_id: str, allow_not_found: bool = False
    ) -> dict[str, Any] | None:
        return await self.request(
            "GET",
            f"/databases/{quote(database_id, safe='-')}",
            allow_not_found=allow_not_found,
        )

    async def get_data_source(self, data_source_id: str) -> dict[str, Any]:
        result = await self.request("GET", f"/data_sources/{quote(data_source_id, safe='-')}")
        assert result is not None
        return result

    async def query_data_source(self, data_source_id: str) -> list[dict[str, Any]]:
        cursor: str | None = None
        seen: set[str] = set()
        pages: list[dict[str, Any]] = []
        for _ in range(MAX_API_PAGES):
            body: dict[str, Any] = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            payload = await self.request(
                "POST",
                f"/data_sources/{quote(data_source_id, safe='-')}/query",
                json=body,
            )
            results = payload.get("results")
            has_more = payload.get("has_more")
            if not isinstance(results, list) or not all(isinstance(row, dict) for row in results):
                raise NotionLibraryError("Notion 数据库返回的数据格式不完整")
            if not isinstance(has_more, bool):
                raise NotionLibraryError("Notion 数据库分页信息不完整")
            pages.extend(results)
            if len(pages) > MAX_SOURCE_PAGES:
                raise NotionLibraryError("目标资料库超过单次安全导入上限")
            if not has_more:
                return pages
            next_cursor = payload.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen:
                raise NotionLibraryError("Notion 数据库分页中断")
            seen.add(next_cursor)
            cursor = next_cursor
        raise NotionLibraryError("Notion 数据库分页超过安全上限")

    async def get_page(self, page_id: str, allow_not_found: bool = False) -> dict[str, Any] | None:
        return await self.request(
            "GET", f"/pages/{quote(page_id, safe='-')}", allow_not_found=allow_not_found
        )

    async def list_block_children(
        self, block_id: str, start_cursor: str | None = None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            params["start_cursor"] = start_cursor
        result = await self.request(
            "GET", f"/blocks/{quote(block_id, safe='-')}/children", params=params
        )
        assert result is not None
        return result


class NotionLibraryService:
    def __init__(
        self,
        credentials: NotionCredentialStore | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        lock_path: str | None = None,
    ) -> None:
        credential_path = os.environ.get("NOTION_CONNECTIONS_FILE", ".secrets/notion-connections.json")
        self.credentials = credentials or NotionCredentialStore(credential_path)
        self.transport = transport
        self.lock_path = lock_path
        self._local_lock = asyncio.Lock()
        # Reuse only the pure page/title renderer. The legacy sync service is
        # never asked to create its own Notion client or start a scheduler.
        self._renderer = NotionSyncService(
            config=NotionSettings(_env_file=None, NOTION_TOKEN=None, NOTION_DATA_SOURCE_ID=None),
            transport=transport,
        )

    def _credential(self, connection_id: str) -> NotionConnectionCredential:
        try:
            return self.credentials.get_connection(connection_id)
        except NotionCredentialError:
            raise NotionLibraryError("Notion connection is not configured") from None

    def list_connections(self) -> list[dict[str, Any]]:
        try:
            return [summary.model_dump() for summary in self.credentials.list_connections()]
        except NotionCredentialError:
            raise NotionLibraryError("Notion connection configuration is invalid") from None

    async def browse_workspace(
        self, connection_id: str, cursor: str | None = None, query: str | None = None
    ) -> dict[str, Any]:
        """Explicit, paginated discovery restricted to the selected connection."""
        credential = self._credential(connection_id)
        body: dict[str, Any] = {"page_size": 50}
        if cursor:
            body["start_cursor"] = cursor
        if query:
            body["query"] = query
        async with NotionLibraryClient(credential, self.transport) as client:
            payload = await client.request("POST", "/search", json=body)
        rows = payload.get("results")
        has_more = payload.get("has_more")
        next_cursor = payload.get("next_cursor")
        if (
            not isinstance(rows, list) or not isinstance(has_more, bool)
            or (has_more and (not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor))
        ):
            raise NotionLibraryError("Notion 目录分页信息不完整")
        items = []
        seen: set[tuple[str, str]] = set()
        for row in rows:
            if not isinstance(row, dict) or row.get("archived") or row.get("in_trash"):
                continue
            kind = row.get("object")
            if kind == "page":
                title_rows = next((value.get("title", []) for value in (row.get("properties") or {}).values() if isinstance(value, dict) and value.get("type") == "title"), [])
                entity_id = row.get("id")
            elif kind == "data_source":
                title_rows = row.get("title")
                entity_id = (row.get("parent") or {}).get("database_id")
            else:
                continue
            if not isinstance(entity_id, str) or not _NOTION_ID_RE.fullmatch(entity_id):
                continue
            item_kind = "page" if kind == "page" else "database"
            if (item_kind, entity_id) in seen:
                continue
            seen.add((item_kind, entity_id))
            title = self._plain_title(title_rows)[:200] or "无标题"
            items.append({
                "id": entity_id, "kind": item_kind,
                "title": "标题已隐藏" if self._contains_secret(title) else title,
                "url": f"https://www.notion.so/{entity_id.replace('-', '')}",
                "last_edited_at": self._iso(self._parse_datetime(row.get("last_edited_time"))),
            })
        return {"items": items, "next_cursor": next_cursor if has_more else None}

    async def list_sources(self, db: Any) -> list[dict[str, Any]]:
        rows = list(
            (
                await db.scalars(
                    select(NotionSource).order_by(NotionSource.created_at, NotionSource.id)
                )
            ).all()
        )
        labels = {item["id"]: item["label"] for item in self.list_connections()}
        return [
            {
                "id": row.id,
                "connection_id": row.connection_id,
                "connection_label": labels.get(row.connection_id),
                "database_id": row.database_id,
                "source_type": row.source_type,
                "title": row.title,
                "source_url": row.source_url,
                "data_source_ids": list(row.data_source_ids or []),
                "last_import_at": self._iso(row.last_import_at),
                "last_success_at": self._iso(row.last_success_at),
            }
            for row in rows
        ]

    async def inspect(self, db: Any, connection_id: str, url: str) -> dict[str, Any]:
        parsed = parse_notion_source_url(url)
        credential = self._credential(connection_id)
        async with NotionLibraryClient(credential, self.transport) as client:
            database = await client.get_database(parsed.entity_id, allow_not_found=True)
            if database is not None:
                snapshot, results = await self._read_database(client, database, connection_id, url)
                return self._preview(snapshot, results)

            page = await client.get_page(parsed.entity_id)
            if page is None:
                raise NotionLibraryError("Notion 数据库或页面无法访问")
            parent = page.get("parent")
            if isinstance(parent, dict) and parent.get("type") in {"workspace", "page_id"}:
                snapshot, results = await self._read_page_source(client, page, connection_id)
                return self._preview(snapshot, results)
            parent_database_id = parent.get("database_id") if isinstance(parent, dict) else None
            parent_data_source_id = parent.get("data_source_id") if isinstance(parent, dict) else None
            source = await db.scalar(
                select(NotionSource).where(NotionSource.database_id == parent_database_id)
            )
            if (
                source is None
                or source.connection_id != connection_id
                or parent_data_source_id not in (source.data_source_ids or [])
                or not self._page_belongs_to_source(page, parent_data_source_id, source.database_id)
            ):
                raise NotionLibraryError("Notion 页面不属于已注册的数据库来源")
            schema = await self._get_schema(client, parent_data_source_id)
            result = await self._convert_page(
                client, page, schema, parent_data_source_id, source.database_id
            )
            snapshot = SourceSnapshot(
                connection_id=connection_id,
                database_id=source.database_id,
                title=source.title,
                source_url=source.source_url,
                data_sources=tuple((item_id, "") for item_id in source.data_source_ids or []),
            )
            return {**self._preview(snapshot, [result]), "import_scope": "page"}

    async def inspect_page(self, db: Any, source_id: int, url: str) -> dict[str, Any]:
        source = await db.get(NotionSource, source_id)
        if source is None:
            raise NotionLibraryError("Notion 数据库来源不存在")
        parsed = parse_notion_source_url(url)
        async with NotionLibraryClient(self._credential(source.connection_id), self.transport) as client:
            page = await client.get_page(parsed.entity_id)
            if page is None:
                raise NotionLibraryError("Notion 页面无法访问")
            parent = page.get("parent")
            data_source_id = parent.get("data_source_id") if isinstance(parent, dict) else None
            if (
                not self._page_belongs_to_source(page, data_source_id, source.database_id)
                or data_source_id not in (source.data_source_ids or [])
            ):
                raise NotionLibraryError("Notion 页面不属于所选数据库来源")
            schema = await self._get_schema(client, data_source_id)
            result = await self._convert_page(client, page, schema, data_source_id, source.database_id)
            snapshot = SourceSnapshot(
                source.connection_id,
                source.database_id,
                source.title,
                source.source_url,
                tuple((item_id, "") for item_id in source.data_source_ids or []),
            )
            return self._preview(snapshot, [result])

    async def import_page(self, db: Any, source_id: int, url: str, admin_id: int) -> dict[str, Any]:
        source = await db.get(NotionSource, source_id)
        if source is None:
            raise NotionLibraryError("Notion 数据库来源不存在")
        parsed = parse_notion_source_url(url)
        async with NotionLibraryClient(self._credential(source.connection_id), self.transport) as client:
            page = await client.get_page(parsed.entity_id)
            if page is None:
                raise NotionLibraryError("Notion 页面无法访问")
            parent = page.get("parent")
            data_source_id = parent.get("data_source_id") if isinstance(parent, dict) else None
            if (
                not self._page_belongs_to_source(page, data_source_id, source.database_id)
                or data_source_id not in (source.data_source_ids or [])
            ):
                raise NotionLibraryError("Notion 页面不属于所选数据库来源")
            schema = await self._get_schema(client, data_source_id)
            result = await self._convert_page(client, page, schema, data_source_id, source.database_id)
            snapshot = SourceSnapshot(
                source.connection_id,
                source.database_id,
                source.title,
                source.source_url,
                tuple((item_id, "") for item_id in source.data_source_ids or []),
            )
            return await self._apply_results(
                db, snapshot, [result], admin_id,
                reconcile=False,
                preserve_manual_unpublish=False,
            )

    async def import_source(
        self, db: Any, connection_id: str, url: str, admin_id: int
    ) -> dict[str, Any]:
        """Explicitly import the selected database or standalone page."""
        parsed = parse_notion_source_url(url)
        async with NotionLibraryClient(self._credential(connection_id), self.transport) as client:
            database = await client.get_database(parsed.entity_id, allow_not_found=True)
            if database is None:
                page = await client.get_page(parsed.entity_id)
                parent = page.get("parent") or {}
                if parent.get("type") == "data_source_id":
                    registered = await db.scalar(select(NotionSource).where(NotionSource.database_id == parent.get("database_id")))
                    if registered is None or registered.connection_id != connection_id:
                        raise NotionLibraryError("Notion 页面不属于该连接已注册的数据库来源")
                    return await self.import_page(db, registered.id, url, admin_id)
                source, pages = await self._read_page_source(client, page, connection_id)
            else:
                source, pages = await self._read_database(client, database, connection_id, url)
            return await self._apply_results(
                db, source, pages, admin_id,
                reconcile=True,
                preserve_manual_unpublish=False,
            )

    async def sync(self, db: Any, source_id: int, admin_id: int) -> dict[str, Any]:
        source = await db.get(NotionSource, source_id)
        if source is None:
            raise NotionLibraryError("Notion 数据库来源不存在")
        try:
            async with NotionLibraryClient(self._credential(source.connection_id), self.transport) as client:
                if source.source_type == "page":
                    page = await client.get_page(source.database_id)
                    actual_source, pages = await self._read_page_source(client, page, source.connection_id)
                else:
                    database = await client.get_database(source.database_id)
                    if database is None:
                        raise NotionLibraryError("Notion 数据库无法访问")
                    actual_source, pages = await self._read_database(
                        client, database, source.connection_id, source.source_url
                    )
                return await self._apply_results(
                    db, actual_source, pages, admin_id,
                    reconcile=True,
                    preserve_manual_unpublish=True,
                )
        except NotionLibraryBusy:
            raise
        except NotionLibraryError as exc:
            await self._write_error_state(db, str(exc))
            raise

    async def _read_page_source(
        self, client: NotionLibraryClient, page: dict[str, Any], connection_id: str
    ) -> tuple[SourceSnapshot, list[PageResult]]:
        parent = page.get("parent")
        if not isinstance(parent, dict) or parent.get("type") not in {"workspace", "page_id"}:
            raise NotionLibraryError("数据库内页面请先注册其数据库来源，再使用来源内单页导入")
        page_id = page.get("id")
        properties = page.get("properties")
        if not isinstance(page_id, str) or not isinstance(properties, dict):
            raise NotionLibraryError("Notion 页面字段不完整")
        title_property = next((key for key, value in properties.items() if isinstance(value, dict) and value.get("type") == "title"), None)
        if title_property is None:
            raise NotionLibraryError("Notion 页面标题无法读取")
        if page.get("archived") or page.get("in_trash"):
            result = PageResult(page_id, None, "已归档页面", "", (), "archived", None, self._parse_datetime(page.get("last_edited_time")))
        else:
            result = await self._render_page(client, page, SourceSchema(title_property, ()), None)
        title = result.title if result.status == "published" else "已隔离或归档页面"
        snapshot = SourceSnapshot(connection_id, page_id, title, f"https://www.notion.so/{page_id.replace('-', '')}", (), "page")
        return snapshot, [result]

    async def _read_database(
        self,
        client: NotionLibraryClient,
        database: dict[str, Any],
        connection_id: str,
        source_url: str | None = None,
    ) -> tuple[SourceSnapshot, list[PageResult]]:
        title = self._plain_title(database.get("title"))
        database_id = database.get("id")
        data_sources = database.get("data_sources")
        if not isinstance(database_id, str) or not isinstance(data_sources, list) or not data_sources:
            raise NotionLibraryError("目标数据库没有可读取的数据源")
        if not title:
            raise NotionLibraryError("Notion 数据库标题无法读取")

        normalized_sources: list[tuple[str, str]] = []
        for item in data_sources:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise NotionLibraryError("目标数据库的数据源信息不完整")
            source_id = item["id"]
            name = item.get("name") if isinstance(item.get("name"), str) else ""
            normalized_sources.append((source_id, name))
        ids = [source_id for source_id, _ in normalized_sources]
        if len(ids) != len(set(ids)):
            raise NotionLibraryError("Notion 数据库返回了重复数据源")

        results: list[PageResult] = []
        seen_pages: set[str] = set()
        for data_source_id, _ in normalized_sources:
            schema = await self._get_schema(client, data_source_id)
            rows = await client.query_data_source(data_source_id)
            for page in rows:
                page_id = page.get("id")
                if not isinstance(page_id, str) or not page_id:
                    raise NotionLibraryError("Notion 数据库中有页面缺少有效标识")
                if page_id in seen_pages:
                    raise NotionLibraryError("Notion 数据库返回了重复页面")
                seen_pages.add(page_id)
                if page.get("archived") is True or page.get("in_trash") is True:
                    continue
                try:
                    results.append(
                        await self._convert_page(
                            client, page, schema, data_source_id, database_id
                        )
                    )
                except NotionLibraryError as exc:
                    results.append(self._isolated_from_page(page, str(exc)))

        canonical_url = f"https://www.notion.so/{database_id.replace('-', '')}"
        return (
            SourceSnapshot(
                connection_id=connection_id,
                database_id=database_id,
                title=title,
                source_url=source_url or canonical_url,
                data_sources=tuple(normalized_sources),
            ),
            results,
        )

    async def _get_schema(self, client: NotionLibraryClient, data_source_id: str) -> SourceSchema:
        payload = await client.get_data_source(data_source_id)
        if payload.get("id") != data_source_id:
            raise NotionLibraryError("Notion 数据源无法验证")
        properties = payload.get("properties")
        if not isinstance(properties, dict):
            raise NotionLibraryError("Notion 数据库没有可读取的字段结构")
        titles = [
            name
            for name, value in properties.items()
            if isinstance(value, dict) and value.get("type") == "title"
        ]
        if len(titles) != 1:
            raise NotionLibraryError("Notion 数据库必须包含唯一标题字段")
        categories = tuple(
            name
            for name, value in properties.items()
            if isinstance(value, dict)
            and value.get("type") in {"select", "multi_select"}
            and re.search(r"(?i)(分类|类别|标签|category|categories|tags?)", name)
        )
        return SourceSchema(titles[0], categories)

    async def _convert_page(
        self,
        client: NotionLibraryClient,
        page: dict[str, Any],
        schema: SourceSchema,
        data_source_id: str,
        database_id: str,
    ) -> PageResult:
        page_id = page.get("id")
        if not isinstance(page_id, str):
            raise NotionLibraryError("Notion 页面缺少有效标识")
        if not self._page_belongs_to_source(page, data_source_id, database_id):
            return PageResult(
                page_id,
                data_source_id,
                "已隔离页面",
                "",
                (),
                "isolated",
                "页面来源无法验证",
                self._parse_datetime(page.get("last_edited_time")),
            )
        return await self._render_page(client, page, schema, data_source_id)

    async def _render_page(
        self, client: NotionLibraryClient, page: dict[str, Any], schema: SourceSchema,
        data_source_id: str | None,
    ) -> PageResult:
        page_id = page["id"]
        properties = page.get("properties")
        if not isinstance(properties, dict):
            raise NotionLibraryError("Notion 页面字段不完整")
        try:
            title = (
                self._renderer._page_title(properties.get(schema.title_property))[:200].strip()
                or "无标题"
            )
            categories = self._extract_categories(properties, schema.category_properties)
            reader = NotionContentReader(client, media_transport=self.transport)
            native = await reader.read(page_id)
            content = native.markdown
            icon_data = page.get("icon") or {}
            icon = icon_data.get("emoji", "")[:30] if isinstance(icon_data, dict) and icon_data.get("type") == "emoji" else None
            cover = page.get("cover")
            cover_url = None
            if isinstance(cover, dict):
                cover_data = cover.get(cover.get("type"))
                if isinstance(cover_data, dict):
                    cover_url = await reader.image(page_id, cover_data.get("url"))
        except NotionSyncError as exc:
            raise NotionLibraryError("页面包含暂不支持或无法完整转换的内容") from exc
        if self._contains_secret("\n".join((title, native.plain_text, content, json.dumps(native.blocks, ensure_ascii=False), *categories))):
            return PageResult(
                page_id,
                data_source_id,
                title,
                "",
                (),
                "isolated",
                "页面内容疑似包含凭据",
                self._parse_datetime(page.get("last_edited_time")),
            )
        return PageResult(
            page_id,
            data_source_id,
            title,
            content,
            categories,
            "published",
            None,
            self._parse_datetime(page.get("last_edited_time")),
            native.blocks,
            icon,
            cover_url,
        )

    @staticmethod
    def _extract_categories(properties: dict[str, Any], names: tuple[str, ...]) -> tuple[str, ...]:
        values: list[str] = []
        for name in names:
            prop = properties.get(name)
            if not isinstance(prop, dict):
                continue
            kind = prop.get("type")
            raw = prop.get("select") if kind == "select" else prop.get("multi_select")
            if raw is None:
                continue
            rows = [raw] if kind == "select" else raw
            if not isinstance(rows, list):
                raise NotionLibraryError("Notion 分类字段格式不完整")
            for row in rows:
                label = row.get("name") if isinstance(row, dict) else None
                if isinstance(label, str) and label.strip():
                    clean = label.strip()[:100]
                    if clean not in values:
                        values.append(clean)
        return tuple(values)

    async def _apply_results(
        self,
        db: Any,
        source_data: SourceSnapshot,
        pages: list[PageResult],
        admin_id: int,
        *,
        reconcile: bool,
        preserve_manual_unpublish: bool,
    ) -> dict[str, Any]:
        async with self._sync_lock():
            current_source = await db.scalar(
                select(NotionSource).where(NotionSource.database_id == source_data.database_id)
            )
            previous = []
            if current_source is not None:
                previous = list(
                    (
                        await db.scalars(
                            select(NotionDocument).where(NotionDocument.source_id == current_source.id)
                        )
                    ).all()
                )
            page_ids = {page.notion_page_id for page in pages}
            if reconcile:
                pages.extend(
                    self._archived_result(old)
                    for old in previous
                    if old.notion_page_id not in page_ids and old.status != "archived"
                )

            now = datetime.now(timezone.utc)
            counters = self._empty_counters()
            counters["queried"] = len(pages)
            existing_docs = {
                doc.notion_page_id: doc
                for doc in list((await db.scalars(select(NotionDocument))).all())
            }
            legacy_mappings = list(
                (
                    await db.scalars(
                        select(NotionPage).options(selectinload(NotionPage.post))
                    )
                ).all()
            )
            legacy_by_id = {mapping.notion_page_id: mapping for mapping in legacy_mappings}

            async with db.begin_nested():
                source = current_source or NotionSource()
                source.connection_id = source_data.connection_id
                source.database_id = source_data.database_id
                source.source_type = source_data.source_type
                source.data_source_id = (
                    source_data.data_sources[0][0] if source_data.data_sources else None
                )
                source.data_source_ids = [item_id for item_id, _ in source_data.data_sources]
                source.title = source_data.title
                source.source_url = source_data.source_url
                source.verified_at = now
                source.last_import_at = now
                source.last_success_at = now
                db.add(source)
                await db.flush()

                reserved_slugs: set[str] = set()
                for page in pages:
                    document = existing_docs.get(page.notion_page_id)
                    mapping = legacy_by_id.get(page.notion_page_id)
                    legacy_post = mapping.post if mapping is not None else None
                    is_new = document is None
                    if document is None:
                        legacy_slug = legacy_post.slug if legacy_post is not None else None
                        document = NotionDocument(
                            source_id=source.id,
                            data_source_id=page.data_source_id,
                            notion_page_id=page.notion_page_id,
                            slug=await self._unique_slug(
                                db, page.title, legacy_slug, reserved_slugs=reserved_slugs
                            ),
                            legacy_post_slug=legacy_slug,
                            title=page.title,
                            content="",
                            categories=list(page.categories),
                            author_id=legacy_post.author_id if legacy_post is not None else admin_id,
                            view_count=(legacy_post.view_count or 0) if legacy_post is not None else 0,
                            status=page.status,
                            last_synced_at=now,
                            created_at=now,
                            updated_at=now,
                        )
                        db.add(document)
                        await db.flush()
                        existing_docs[page.notion_page_id] = document
                    else:
                        document.source_id = source.id
                        document.data_source_id = page.data_source_id
                        if document.author_id is None:
                            document.author_id = admin_id

                    if legacy_post is not None and legacy_post.is_published is True:
                        legacy_post.is_published = False
                        legacy_post.updated_at = now.replace(tzinfo=None)
                    if legacy_post is not None:
                        await db.execute(update(Comment).where(Comment.post_id == legacy_post.id).values(
                            post_id=None, notion_document_id=document.id,
                        ))

                    manual_block = (
                        preserve_manual_unpublish
                        and document.manual_unpublished
                        and page.status == "published"
                    )
                    stored_status = "archived" if manual_block else page.status
                    document.manual_unpublished = (
                        document.manual_unpublished if preserve_manual_unpublish else False
                    )
                    document.title = page.title
                    document.content = page.content
                    document.content_blocks = page.blocks
                    document.icon = page.icon
                    document.cover_url = page.cover_url
                    document.summary = self._summary(page.content)
                    document.categories = list(dict.fromkeys([
                        *page.categories,
                        *([tag.name for tag in legacy_post.tags] if legacy_post is not None else []),
                    ]))
                    document.status = stored_status
                    document.isolation_reason = (
                        "管理员手动下架" if manual_block else page.isolation_reason
                    )
                    document.notion_last_edited_at = page.last_edited_at
                    document.last_synced_at = now
                    document.updated_at = now
                    counters[stored_status] += 1
                    if stored_status in {"isolated", "archived"}:
                        counters["unpublished"] += 1
                    if not is_new:
                        counters["updated"] += 1

                state = await db.get(NotionLibrarySyncState, 1)
                if state is None:
                    state = NotionLibrarySyncState(id=1)
                    db.add(state)
                state.status = "success"
                state.last_started_at = now
                state.last_finished_at = now
                state.last_success_at = now
                state.last_error = None
                state.counters = counters
                await db.flush()
            return await self.get_status(db)

    async def get_status(self, db: Any) -> dict[str, Any]:
        state = await db.get(NotionLibrarySyncState, 1)
        source = await db.scalar(select(NotionSource).order_by(NotionSource.id))
        counters = self._empty_counters()
        if state and isinstance(state.counters, dict):
            counters.update(
                {key: int(value) for key, value in state.counters.items() if key in counters}
            )
        try:
            ready = bool(self.list_connections())
        except NotionLibraryError:
            ready = False
        return {
            "ready": ready,
            "source_configured": source is not None,
            "source_title": source.title if source else None,
            "status": state.status if state else "never",
            "last_started_at": self._iso(state.last_started_at) if state else None,
            "last_finished_at": self._iso(state.last_finished_at) if state else None,
            "last_success_at": self._iso(state.last_success_at) if state else None,
            "last_error": state.last_error if state else None,
            "counters": counters,
        }

    async def _write_error_state(self, db: Any, message: str) -> None:
        state = await db.get(NotionLibrarySyncState, 1)
        if state is None:
            state = NotionLibrarySyncState(id=1, status="error", counters=self._empty_counters())
            db.add(state)
        state.status = "error"
        state.last_finished_at = datetime.now(timezone.utc)
        state.last_error = message
        counters = self._empty_counters()
        counters["failed"] = 1
        state.counters = counters
        await db.flush()

    @staticmethod
    def _preview(snapshot: SourceSnapshot, pages: list[PageResult]) -> dict[str, Any]:
        categories = sorted(
            {
                category
                for page in pages
                if page.status == "published"
                for category in page.categories
            }
        )
        return {
            "title": snapshot.title,
            "source_type": snapshot.source_type,
            "import_scope": snapshot.source_type,
            "page_count": len(pages),
            "data_source_count": len(snapshot.data_sources),
            "publishable_count": sum(page.status == "published" for page in pages),
            "isolated_count": sum(page.status == "isolated" for page in pages),
            "categories": categories,
            "isolation_reasons": dict(
                sorted(
                    (
                        reason,
                        sum(page.isolation_reason == reason for page in pages),
                    )
                    for reason in {
                        page.isolation_reason
                        for page in pages
                        if page.isolation_reason
                    }
                )
            ),
        }

    @staticmethod
    def _plain_title(value: Any) -> str:
        if not isinstance(value, list):
            return ""
        parts = [row.get("plain_text") for row in value if isinstance(row, dict)]
        return "".join(part for part in parts if isinstance(part, str)).strip()

    @staticmethod
    def _page_belongs_to_source(
        page: dict[str, Any], data_source_id: str | None, database_id: str | None
    ) -> bool:
        parent = page.get("parent")
        if not isinstance(parent, dict) or parent.get("type") != "data_source_id":
            return False
        if data_source_id is not None and parent.get("data_source_id") != data_source_id:
            return False
        if database_id is not None and parent.get("database_id") != database_id:
            return False
        return True

    @classmethod
    def _contains_secret(cls, text: str) -> bool:
        for pattern in _SECRET_PATTERNS:
            for match in pattern.finditer(text):
                value = match.group(1) if match.lastindex else match.group(0)
                normalized = value.strip("'\" `.,;:)}]").lower()
                if normalized not in _PLACEHOLDERS:
                    return True
        return False

    @classmethod
    def _isolated_from_page(cls, page: dict[str, Any], reason: str) -> PageResult:
        page_id = page.get("id")
        if not isinstance(page_id, str):
            raise NotionLibraryError("Notion 页面缺少有效标识")
        parent = page.get("parent")
        data_source_id = parent.get("data_source_id") if isinstance(parent, dict) else None
        return PageResult(
            page_id,
            data_source_id,
            "已隔离页面",
            "",
            (),
            "isolated",
            reason,
            cls._parse_datetime(page.get("last_edited_time")),
        )

    @staticmethod
    def _archived_result(document: NotionDocument) -> PageResult:
        return PageResult(
            document.notion_page_id,
            document.data_source_id,
            document.title,
            "",
            (),
            "archived",
            None,
            document.notion_last_edited_at,
        )

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return result if result.tzinfo else result.replace(tzinfo=timezone.utc)

    @staticmethod
    async def _unique_slug(
        db: Any,
        title: str,
        preferred: str | None = None,
        *,
        reserved_slugs: set[str] | None = None,
    ) -> str:
        # autoflush=False means pending documents are invisible to SELECTs.
        reserved = reserved_slugs if reserved_slugs is not None else set()
        base = slugify(preferred or title, allow_unicode=True) or "document"
        candidate = base[:200]
        suffix = 1
        while candidate in reserved or await db.scalar(
            select(NotionDocument.id).where(NotionDocument.slug == candidate)
        ) is not None:
            suffix_text = f"-{suffix}"
            candidate = f"{base[:200 - len(suffix_text)]}{suffix_text}"
            suffix += 1
        reserved.add(candidate)
        return candidate

    @staticmethod
    def _empty_counters() -> dict[str, int]:
        return {
            "queried": 0,
            "published": 0,
            "updated": 0,
            "isolated": 0,
            "archived": 0,
            "unpublished": 0,
            "skipped": 0,
            "failed": 0,
        }

    @staticmethod
    def _summary(content: str) -> str | None:
        first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
        return first_line[:500] or None

    @staticmethod
    def _iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    @contextlib.asynccontextmanager
    async def _sync_lock(self):
        if self._local_lock.locked():
            raise NotionLibraryBusy("另一个 Notion 导入正在进行")
        await self._local_lock.acquire()
        descriptor: int | None = None
        try:
            lock_path = self.lock_path or os.path.join(
                tempfile.gettempdir(), "personal-blog-notion-library.lock"
            )
            flags = os.O_CREAT | os.O_RDWR
            if hasattr(os, "O_CLOEXEC"):
                flags |= os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(lock_path, flags, 0o600)
            os.fchmod(descriptor, 0o600)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise NotionLibraryBusy("另一个 Notion 导入正在进行") from None
            yield
        finally:
            if descriptor is not None:
                with contextlib.suppress(OSError):
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
            self._local_lock.release()


notion_library_service = NotionLibraryService()
