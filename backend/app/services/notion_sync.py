"""Read-only Notion API client and conservative page-to-Markdown conversion."""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from slugify import slugify
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.notion_config import NotionSettings, notion_settings
from app.models.notion import NotionPage, NotionSyncState
from app.models.post import Post
from app.models.user import User


NOTION_API_VERSION = "2025-09-03"
PUBLISH_PROPERTY_NAME = "发布到博客"
MAX_API_PAGES = 100
MAX_BLOCKS_PER_PAGE = 10_000
MAX_BLOCK_DEPTH = 16
MAX_MARKDOWN_CHARS = 500_000


class NotionSyncError(RuntimeError):
    """Sanitized error safe to persist and return from the admin API."""


class NotionSyncBusy(NotionSyncError):
    pass


@dataclass(frozen=True)
class DataSourceSchema:
    title_property_name: str
    title_property_id: str
    checkbox_property_id: str


@dataclass(frozen=True)
class PageSnapshot:
    source_id: str
    title: str
    content: str


class NotionClient:
    """Small version-pinned HTTP client; it never writes to Notion."""

    def __init__(
        self,
        config: NotionSettings = notion_settings,
        transport: httpx.AsyncBaseTransport | None = None,
        base_url: str = "https://api.notion.com/v1",
    ) -> None:
        self.config = config
        if not config.is_ready:
            raise NotionSyncError("Notion configuration is incomplete")
        token = config.NOTION_TOKEN.get_secret_value()  # type: ignore[union-attr]
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": NOTION_API_VERSION,
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(20.0, connect=5.0),
            transport=transport,
        )

    async def __aenter__(self) -> NotionClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def request(
        self, method: str, path: str, *, allow_not_found: bool = False, **kwargs: Any
    ) -> dict[str, Any] | None:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise NotionSyncError("Notion request timed out") from exc
        except httpx.HTTPError as exc:
            raise NotionSyncError("Notion request failed") from exc

        if response.status_code == 404 and allow_not_found:
            return None
        if response.status_code == 404:
            raise NotionSyncError("A configured Notion page or data source could not be verified")
        if response.status_code in (401, 403):
            raise NotionSyncError("Notion authorization failed or access was not granted")
        if response.status_code == 429:
            raise NotionSyncError("Notion rate limit reached; retry later")
        if response.is_error:
            raise NotionSyncError("Notion returned an unsuccessful response")
        try:
            payload = response.json()
        except ValueError as exc:
            raise NotionSyncError("Notion returned an invalid response") from exc
        if not isinstance(payload, dict):
            raise NotionSyncError("Notion returned an invalid response")
        return payload

    async def get_data_source(self) -> dict[str, Any]:
        source_id = str(self.config.NOTION_DATA_SOURCE_ID)
        return await self.request("GET", f"/data_sources/{source_id}")

    async def query_data_source(self, body: dict[str, Any]) -> list[dict[str, Any]]:
        source_id = str(self.config.NOTION_DATA_SOURCE_ID)
        cursor: str | None = None
        seen_cursors: set[str] = set()
        pages: list[dict[str, Any]] = []

        for _ in range(MAX_API_PAGES):
            request_body = dict(body)
            if cursor is not None:
                request_body["start_cursor"] = cursor
            payload = await self.request(
                "POST", f"/data_sources/{source_id}/query", json=request_body
            )
            results = payload.get("results")
            if not isinstance(results, list) or not all(isinstance(row, dict) for row in results):
                raise NotionSyncError("Notion returned an invalid data source page")
            has_more = payload.get("has_more")
            if not isinstance(has_more, bool):
                raise NotionSyncError("Notion data source pagination metadata is incomplete")
            pages.extend(results)
            if len(pages) > MAX_BLOCKS_PER_PAGE:
                raise NotionSyncError("Notion data source exceeds the safe sync limit")
            if not has_more:
                return pages
            next_cursor = payload.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen_cursors:
                raise NotionSyncError("Notion data source pagination was incomplete")
            seen_cursors.add(next_cursor)
            cursor = next_cursor

        raise NotionSyncError("Notion data source exceeded the safe pagination limit")

    async def get_page(self, page_id: str, allow_not_found: bool = False) -> dict[str, Any] | None:
        return await self.request(
            "GET",
            f"/pages/{quote(page_id, safe='-')}",
            allow_not_found=allow_not_found,
        )

    async def get_page_property(self, page_id: str, property_id: str) -> dict[str, Any]:
        path = f"/pages/{quote(page_id, safe='-')}/properties/{quote(property_id, safe='-')}"
        return await self.request("GET", path)

    async def list_block_children(
        self, block_id: str, start_cursor: str | None = None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            params["start_cursor"] = start_cursor
        path = f"/blocks/{quote(block_id, safe='-')}/children"
        return await self.request("GET", path, params=params)


class NotionSyncService:
    """Notion schema checks and full-page conversion before local writes."""

    def __init__(
        self,
        config: NotionSettings = notion_settings,
        transport: httpx.AsyncBaseTransport | None = None,
        lock_path: str | None = None,
    ) -> None:
        self.config = config
        self.transport = transport
        self.lock_path = lock_path
        self._local_lock = asyncio.Lock()

    async def verify_data_source(self, client: NotionClient) -> DataSourceSchema:
        payload = await client.get_data_source()
        if str(payload.get("id", "")).lower() != str(self.config.NOTION_DATA_SOURCE_ID).lower():
            raise NotionSyncError("Configured Notion data source could not be verified")
        properties = payload.get("properties")
        if not isinstance(properties, dict):
            raise NotionSyncError("Notion data source has no readable property schema")

        publish_property = properties.get(PUBLISH_PROPERTY_NAME)
        if not isinstance(publish_property, dict) or publish_property.get("type") != "checkbox":
            raise NotionSyncError("Notion data source must contain the exact 发布到博客 checkbox")

        titles = [
            (name, value)
            for name, value in properties.items()
            if isinstance(value, dict) and value.get("type") == "title"
        ]
        if len(titles) != 1:
            raise NotionSyncError("Notion data source must contain exactly one title property")
        title_name, title_property = titles[0]
        title_id = title_property.get("id")
        checkbox_id = publish_property.get("id")
        if not isinstance(title_id, str) or not isinstance(checkbox_id, str):
            raise NotionSyncError("Notion data source property schema is incomplete")
        return DataSourceSchema(title_name, title_id, checkbox_id)

    async def fetch_checked_pages(
        self, client: NotionClient, schema: DataSourceSchema
    ) -> list[PageSnapshot]:
        rows = await client.query_data_source(
            {
                "page_size": 100,
                "filter": {
                    "property": PUBLISH_PROPERTY_NAME,
                    "checkbox": {"equals": True},
                },
            }
        )
        snapshots: list[PageSnapshot] = []
        seen_page_ids: set[str] = set()

        for row in rows:
            page_id = row.get("id")
            if not isinstance(page_id, str) or not page_id:
                raise NotionSyncError("Notion returned a page without an identity")
            if page_id in seen_page_ids:
                raise NotionSyncError("Notion returned a duplicate page")
            seen_page_ids.add(page_id)
            page = await client.get_page(page_id)
            if page is None:
                raise NotionSyncError("A queried Notion page could not be retrieved")
            snapshot = await self._snapshot_page(client, page_id, page, schema)
            if snapshot is not None:
                snapshots.append(snapshot)
        return snapshots

    async def _snapshot_page(
        self,
        client: NotionClient,
        page_id: str,
        page: dict[str, Any],
        schema: DataSourceSchema,
    ) -> PageSnapshot | None:
        if page.get("archived") is True or page.get("in_trash") is True:
            return None
        properties = page.get("properties")
        if not isinstance(properties, dict):
            raise NotionSyncError("A Notion page has incomplete properties")
        checkbox = properties.get(PUBLISH_PROPERTY_NAME)
        if not isinstance(checkbox, dict) or checkbox.get("type") != "checkbox":
            raise NotionSyncError("A Notion page is missing the required checkbox property")
        if checkbox.get("checkbox") is not True:
            return None
        title = self._page_title(properties.get(schema.title_property_name))
        if not title.strip():
            raise NotionSyncError("A checked Notion page has an empty title")
        if len(title.strip()) > 200:
            raise NotionSyncError("A Notion title exceeds the blog title limit")
        content = await self._page_markdown(client, page_id)
        return PageSnapshot(page_id, title.strip(), content)

    @staticmethod
    def _page_title(value: Any) -> str:
        if not isinstance(value, dict) or value.get("type") != "title":
            raise NotionSyncError("A Notion page has an invalid title property")
        if value.get("has_more") is True:
            raise NotionSyncError("A Notion title property is incomplete")
        rich_text = value.get("title")
        if not isinstance(rich_text, list) or any(
            not isinstance(item, dict) or not isinstance(item.get("plain_text"), str)
            for item in rich_text
        ):
            raise NotionSyncError("A Notion title property is incomplete")
        return "".join(item["plain_text"] for item in rich_text)

    async def _page_markdown(self, client: NotionClient, page_id: str) -> str:
        budget = {"blocks": 0, "chars": 0}
        lines = await self._render_children(client, page_id, depth=0, ancestors=frozenset(), budget=budget)
        markdown = "\n".join(line for line in lines if line).strip()
        if len(markdown) > MAX_MARKDOWN_CHARS:
            raise NotionSyncError("A Notion page exceeds the safe content limit")
        return markdown

    async def _read_children(self, client: NotionClient, block_id: str) -> list[dict[str, Any]]:
        cursor: str | None = None
        seen_cursors: set[str] = set()
        blocks: list[dict[str, Any]] = []
        for _ in range(MAX_API_PAGES):
            payload = await client.list_block_children(block_id, cursor)
            results = payload.get("results")
            if not isinstance(results, list) or not all(isinstance(row, dict) for row in results):
                raise NotionSyncError("Notion returned an invalid block page")
            has_more = payload.get("has_more")
            if not isinstance(has_more, bool):
                raise NotionSyncError("Notion block pagination metadata is incomplete")
            blocks.extend(results)
            if len(blocks) > MAX_BLOCKS_PER_PAGE:
                raise NotionSyncError("A Notion page exceeds the safe block limit")
            if not has_more:
                return blocks
            next_cursor = payload.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen_cursors:
                raise NotionSyncError("Notion block pagination was incomplete")
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        raise NotionSyncError("Notion block content exceeded the safe pagination limit")

    async def _render_children(
        self,
        client: NotionClient,
        block_id: str,
        depth: int,
        ancestors: frozenset[str],
        budget: dict[str, int],
    ) -> list[str]:
        if depth > MAX_BLOCK_DEPTH:
            raise NotionSyncError("Notion block nesting exceeded the safe limit")
        if block_id in ancestors:
            raise NotionSyncError("Notion returned cyclic block nesting")
        children = await self._read_children(client, block_id)
        path = ancestors | {block_id}
        lines: list[str] = []
        for block in children:
            budget["blocks"] += 1
            if budget["blocks"] > MAX_BLOCKS_PER_PAGE:
                raise NotionSyncError("A Notion page exceeds the safe block limit")
            block_id_value = block.get("id")
            block_type = block.get("type")
            if not isinstance(block_id_value, str) or not isinstance(block_type, str):
                raise NotionSyncError("Notion returned an incomplete block")
            has_children = block.get("has_children")
            if not isinstance(has_children, bool):
                raise NotionSyncError("Notion block has incomplete child metadata")
            rendered, supports_children = self._render_block(block_type, block.get(block_type))
            if block_type == "table":
                if not has_children:
                    raise NotionSyncError("Notion table has incomplete row metadata")
                rendered = await self._render_table(client, block_id_value)
            elif has_children:
                if not supports_children:
                    raise NotionSyncError(f"Unsupported Notion block type: {block_type}")
                nested = await self._render_children(
                    client, block_id_value, depth + 1, path, budget
                )
                if block_type in ("bulleted_list_item", "numbered_list_item", "to_do"):
                    nested = [f"  {line}" for line in nested]
                rendered = "\n".join(part for part in (rendered, *nested) if part)
            if rendered:
                budget["chars"] += len(rendered)
                if budget["chars"] > MAX_MARKDOWN_CHARS:
                    raise NotionSyncError("A Notion page exceeds the safe content limit")
                lines.append(rendered)
        return lines

    async def _render_table(
        self,
        client: NotionClient,
        block_id: str,
    ) -> str:
        rows = await self._read_children(client, block_id)
        rendered_rows: list[list[str]] = []
        for row in rows:
            if row.get("type") != "table_row":
                raise NotionSyncError("Notion table contains an unsupported row")
            data = row.get("table_row")
            cells = data.get("cells") if isinstance(data, dict) else None
            if not isinstance(cells, list):
                raise NotionSyncError("Notion table row is incomplete")
            rendered_rows.append([self._rich_text(cell).replace("|", "\\|").replace("\n", "<br>") for cell in cells])
        if not rendered_rows:
            return ""
        width = max(len(row) for row in rendered_rows)
        normalized = [row + [""] * (width - len(row)) for row in rendered_rows]
        separator = ["---"] * width
        table_lines = ["| " + " | ".join(normalized[0]) + " |", "| " + " | ".join(separator) + " |"]
        table_lines.extend("| " + " | ".join(row) + " |" for row in normalized[1:])
        return "\n".join(table_lines)

    def _render_block(self, block_type: str, data: Any) -> tuple[str, bool]:
        if block_type == "image":
            if isinstance(data, dict) and data.get("type") == "external":
                external = data.get("external")
                url = external.get("url") if isinstance(external, dict) else None
                return f"![{self._caption(data)}]({self._safe_url(url)})", False
            raise NotionSyncError("Notion private or signed-file images cannot be published")
        if block_type in {"file", "pdf", "video", "audio"}:
            raise NotionSyncError(f"Unsupported Notion media block: {block_type}")
        if not isinstance(data, dict):
            raise NotionSyncError(f"Notion block is incomplete: {block_type}")
        if block_type in {"paragraph", "heading_1", "heading_2", "heading_3"}:
            text = self._rich_text(data.get("rich_text"))
            prefixes = {"paragraph": "", "heading_1": "# ", "heading_2": "## ", "heading_3": "### "}
            return prefixes[block_type] + text, False
        if block_type in {"bulleted_list_item", "numbered_list_item"}:
            prefix = "- " if block_type == "bulleted_list_item" else "1. "
            return prefix + self._rich_text(data.get("rich_text")), True
        if block_type == "to_do":
            checked = "x" if data.get("checked") is True else " "
            return f"- [{checked}] {self._rich_text(data.get('rich_text'))}", True
        if block_type == "quote":
            text = self._rich_text(data.get("rich_text"))
            return "\n".join("> " + line for line in text.splitlines()), True
        if block_type == "callout":
            text = self._rich_text(data.get("rich_text"))
            return "\n".join("> " + line for line in text.splitlines()), True
        if block_type == "code":
            language = data.get("language", "plain text")
            if not isinstance(language, str) or not re.fullmatch(r"[A-Za-z0-9_+.-]{1,40}|plain text", language):
                raise NotionSyncError("Notion code block has an unsupported language label")
            rich_text = data.get("rich_text")
            if not isinstance(rich_text, list) or any(
                not isinstance(item, dict) or not isinstance(item.get("plain_text"), str)
                for item in rich_text
            ):
                raise NotionSyncError("Notion code block text is incomplete")
            text = "".join(item["plain_text"] for item in rich_text)
            if "```" in text:
                raise NotionSyncError("Notion code block cannot be represented safely in Markdown")
            fence = "```" + ("" if language == "plain text" else language)
            return f"{fence}\n{text}\n```", False
        if block_type == "divider":
            return "---", False
        if block_type == "toggle":
            return self._rich_text(data.get("rich_text")), True
        if block_type == "table":
            return "", True
        raise NotionSyncError(f"Unsupported Notion block type: {block_type}")

    @staticmethod
    def _safe_url(value: Any) -> str:
        if not isinstance(value, str):
            raise NotionSyncError("Notion link has no usable URL")
        parsed = urlparse(value)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc:
            raise NotionSyncError("Notion link uses an unsupported URL")
        if parsed.hostname and parsed.hostname.endswith("notion.so"):
            raise NotionSyncError("Private Notion-hosted media cannot be published")
        return "<" + value.replace(">", "%3E") + ">"

    @classmethod
    def _rich_text(cls, rich_text: Any) -> str:
        if not isinstance(rich_text, list):
            raise NotionSyncError("Notion text content is incomplete")
        result: list[str] = []
        for item in rich_text:
            if not isinstance(item, dict) or not isinstance(item.get("plain_text"), str):
                raise NotionSyncError("Notion text content is incomplete")
            value = item["plain_text"]
            annotations = item.get("annotations") or {}
            if not isinstance(annotations, dict):
                raise NotionSyncError("Notion text annotations are incomplete")
            if annotations.get("code") is True:
                value = "`" + value.replace("`", "\\`") + "`"
            if annotations.get("bold") is True:
                value = "**" + value + "**"
            if annotations.get("italic") is True:
                value = "*" + value + "*"
            if annotations.get("strikethrough") is True:
                value = "~~" + value + "~~"
            if annotations.get("underline") is True:
                value = "<u>" + value + "</u>"
            text_data = item.get("text")
            link = text_data.get("link") if isinstance(text_data, dict) else None
            url = link.get("url") if isinstance(link, dict) else None
            if url:
                value = f"[{value}]({cls._safe_url(url)})"
            result.append(value)
        return "".join(result)

    @classmethod
    def _caption(cls, block: dict[str, Any]) -> str:
        caption = block.get("caption", [])
        if not caption:
            return ""
        return cls._rich_text(caption)

    async def sync(self, db: Any, author_id: int | None = None) -> dict[str, Any]:
        if not self.config.is_ready:
            raise NotionSyncError("Notion configuration is incomplete")

        async with self._sync_lock():
            started_at = datetime.now(timezone.utc)
            counters = self._empty_counters()
            await self._write_state(
                db,
                status="running",
                last_started_at=started_at,
                last_error=None,
            )
            try:
                if author_id is None:
                    admin = await db.scalar(
                        select(User)
                        .where(User.is_admin.is_(True), User.is_active.is_(True))
                        .order_by(User.id)
                        .limit(1)
                    )
                    if admin is None:
                        raise NotionSyncError("No active administrator is available for scheduled publishing")
                    author_id = admin.id

                async with NotionClient(self.config, self.transport) as client:
                    schema = await self.verify_data_source(client)
                    snapshots = await self.fetch_checked_pages(client, schema)
                    snapshot_by_id = {page.source_id: page for page in snapshots}
                    mappings = list(
                        (
                            await db.scalars(
                                select(NotionPage).options(selectinload(NotionPage.post))
                            )
                        ).all()
                    )
                    existing = {mapping.notion_page_id: mapping for mapping in mappings}
                    retractions: dict[str, bool] = {}
                    missing_count = 0

                    for page_id, mapping in existing.items():
                        if page_id in snapshot_by_id:
                            continue
                        missing_count += 1
                        remote_page = await client.get_page(page_id, allow_not_found=True)
                        if remote_page is None:
                            retractions[page_id] = True
                            continue
                        if remote_page.get("archived") is True or remote_page.get("in_trash") is True:
                            retractions[page_id] = True
                            continue
                        snapshot = await self._snapshot_page(client, page_id, remote_page, schema)
                        if snapshot is None:
                            retractions[page_id] = False
                        else:
                            snapshot_by_id[page_id] = snapshot

                counters["queried"] = len(snapshot_by_id) + missing_count
                now = datetime.now(timezone.utc)
                post_now = now.replace(tzinfo=None)
                async with db.begin_nested():
                    for page_id, snapshot in snapshot_by_id.items():
                        mapping = existing.get(page_id)
                        if mapping is None:
                            slug = await self._unique_slug(db, snapshot.title)
                            post = Post(
                                title=snapshot.title,
                                slug=slug,
                                content=snapshot.content,
                                is_published=True,
                                author_id=author_id,
                                created_at=post_now,
                                updated_at=post_now,
                            )
                            db.add(post)
                            await db.flush()
                            mapping = NotionPage(
                                notion_page_id=page_id,
                                post_id=post.id,
                                source_title=snapshot.title,
                                is_archived=False,
                                last_seen_at=now,
                                last_synced_at=now,
                            )
                            db.add(mapping)
                            existing[page_id] = mapping
                            counters["published"] += 1
                            continue

                        post = mapping.post
                        if post is None:
                            raise NotionSyncError("A Notion source mapping has no local post")
                        changed = post.title != snapshot.title or post.content != snapshot.content
                        was_published = post.is_published is True
                        if changed:
                            post.title = snapshot.title
                            post.content = snapshot.content
                            post.updated_at = post_now
                        if not was_published:
                            post.is_published = True
                            counters["published"] += 1
                        elif changed:
                            counters["updated"] += 1
                        else:
                            counters["skipped"] += 1
                        mapping.source_title = snapshot.title
                        mapping.is_archived = False
                        mapping.last_seen_at = now
                        mapping.last_synced_at = now

                    for page_id, explicitly_archived in retractions.items():
                        mapping = existing[page_id]
                        post = mapping.post
                        if post is not None and post.is_published is True:
                            post.is_published = False
                            post.updated_at = post_now
                            counters["unpublished"] += 1
                        else:
                            counters["skipped"] += 1
                        mapping.is_archived = explicitly_archived
                        if not explicitly_archived:
                            mapping.last_seen_at = now
                        mapping.last_synced_at = now

                    await self._write_state_in_transaction(
                        db,
                        status="success",
                        last_finished_at=now,
                        last_success_at=now,
                        last_error=None,
                        counters=counters,
                    )
                return await self.get_status(db)
            except NotionSyncBusy:
                raise
            except Exception as exc:
                safe_error = (
                    str(exc)
                    if isinstance(exc, NotionSyncError)
                    else "Notion sync failed; previously published content was kept"
                )
                counters["failed"] = 1
                await self._write_state(
                    db,
                    status="error",
                    last_finished_at=datetime.now(timezone.utc),
                    last_error=safe_error,
                    counters=counters,
                )
                if isinstance(exc, NotionSyncError):
                    raise
                raise NotionSyncError(safe_error) from exc

    async def get_status(self, db: Any) -> dict[str, Any]:
        state = await db.get(NotionSyncState, 1)
        counters = self._empty_counters()
        if state is not None and isinstance(state.counters, dict):
            counters.update({key: int(value) for key, value in state.counters.items() if key in counters})
        return {
            "ready": self.config.is_ready,
            "enabled": self.config.NOTION_SYNC_ENABLED,
            "interval_seconds": self.config.NOTION_SYNC_INTERVAL_SECONDS,
            "status": state.status if state is not None else "never",
            "last_started_at": self._iso(state.last_started_at) if state is not None else None,
            "last_finished_at": self._iso(state.last_finished_at) if state is not None else None,
            "last_success_at": self._iso(state.last_success_at) if state is not None else None,
            "last_error": state.last_error if state is not None else None,
            "counters": counters,
        }

    @contextlib.asynccontextmanager
    async def scheduler(self, session_factory: Any):
        stop = asyncio.Event()
        task = None
        if self.config.NOTION_SYNC_ENABLED and self.config.is_ready:
            task = asyncio.create_task(self._scheduler_loop(session_factory, stop))
        try:
            yield
        finally:
            if task is not None:
                stop.set()
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    async def _scheduler_loop(self, session_factory: Any, stop: asyncio.Event) -> None:
        while not stop.is_set():
            async with session_factory() as db:
                try:
                    await self.sync(db)
                    await db.commit()
                except NotionSyncBusy:
                    await db.rollback()
                except NotionSyncError:
                    await db.commit()
                except Exception:
                    await db.rollback()
            try:
                await asyncio.wait_for(
                    stop.wait(), timeout=self.config.NOTION_SYNC_INTERVAL_SECONDS
                )
            except asyncio.TimeoutError:
                pass

    @contextlib.asynccontextmanager
    async def _sync_lock(self):
        if self._local_lock.locked():
            raise NotionSyncBusy("A Notion sync is already running")
        await self._local_lock.acquire()
        descriptor: int | None = None
        try:
            lock_path = self.lock_path or os.path.join(
                tempfile.gettempdir(), "personal-blog-notion-sync.lock"
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
            except BlockingIOError as exc:
                raise NotionSyncBusy("A Notion sync is already running") from exc
            yield
        finally:
            if descriptor is not None:
                with contextlib.suppress(OSError):
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
            self._local_lock.release()

    @staticmethod
    def _empty_counters() -> dict[str, int]:
        return {
            "queried": 0,
            "published": 0,
            "updated": 0,
            "unpublished": 0,
            "skipped": 0,
            "failed": 0,
        }

    @staticmethod
    def _iso(value: datetime | None) -> str | None:
        return value.isoformat() if value is not None else None

    async def _write_state(self, db: Any, **values: Any) -> None:
        async with db.begin_nested():
            await self._write_state_in_transaction(db, **values)

    async def _write_state_in_transaction(self, db: Any, **values: Any) -> None:
        state = await db.get(NotionSyncState, 1)
        if state is None:
            state = NotionSyncState(id=1, status="never", counters=self._empty_counters())
            db.add(state)
        for field, value in values.items():
            setattr(state, field, value)
        await db.flush()

    @staticmethod
    async def _unique_slug(db: Any, title: str) -> str:
        base = slugify(title, allow_unicode=True) or "post"
        candidate = base[:200]
        suffix = 1
        while await db.scalar(select(Post.id).where(Post.slug == candidate)) is not None:
            suffix_text = f"-{suffix}"
            candidate = f"{base[:200 - len(suffix_text)]}{suffix_text}"
            suffix += 1
        return candidate


notion_sync_service = NotionSyncService()
