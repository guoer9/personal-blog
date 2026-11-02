# Notion Multi-Connection Manual Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver authenticated manual Notion import APIs for any number of locally configured connections and explicitly registered databases, including databases with multiple data sources.

**Architecture:** A read-only credential catalog loads named connections from a local ignored JSON secret file; the database stores only connection IDs and verified source metadata. The admin selects the connection for each database link, and a fixed-host Notion client previews/imports every data source; public documents remain separate from posts. All Notion work is explicit admin action only.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy async ORM, Alembic, httpx MockTransport, pytest/pytest-asyncio, Vue/Vitest (existing frontend regression suite only).

**Spec:** `docs/superpowers/specs/2026-11-02-notion-multi-connection-design.md`

## Global Constraints

- Never use any Notion credential previously shared in chat.
- Store local credentials only in ignored `.secrets/notion-connections.json` with mode `0600`; Compose mounts it read-only at `/run/secrets/notion-connections.json`.
- Do not store or return tokens, do not log them, and do not include them in tests, screenshots, docs, or research notes.
- Notion access is read-only and manual only; remove startup/scheduled Notion sync and default `NOTION_SYNC_ENABLED` to `false`.
- Each Notion database is explicitly inspected and confirmed by an authenticated administrator; no workspace-wide search or arbitrary-URL fetch.
- Resolve all `data_sources` from a database and query each source with cursor pagination.
- Preserve ordinary blog posts and unrelated dirty workspace changes; do not commit, push, deploy, or clean the worktree.

## Review Focus

- Token leakage in connection list, API exceptions, logs, or OpenAPI examples: test every response/error is sanitized.
- A database URL inspected with an unauthorized connection: test no source/document rows are created.
- Multi-data-source or pagination failure: test the previous public snapshot remains unchanged.
- A manually edited credential file with duplicate IDs or malformed JSON: test fail-closed behavior without secret values in errors.
- Application startup/idle: test no Notion HTTP request occurs without an explicit admin operation.

---

### Task 1: Local multi-connection credential catalog

**Files:**
- Create: `backend/app/services/notion_credentials.py`
- Modify: `scripts/local/dev.py`
- Modify: `compose.local.yml`
- Modify: `.gitignore`
- Create: `scripts/local/notion-connections.example.json`
- Modify: `backend/tests/test_notion_library.py`
- Test: `backend/tests/test_notion_credentials.py`

**Interfaces:**
- `NotionCredentialStore(path).list_connections() -> list[ConnectionSummary]`
- `NotionCredentialStore(path).get_connection(connection_id) -> NotionConnectionCredential`
- Summaries expose only `id`, `label`, and `configured`; credentials use `SecretStr` and are never serialized.

- [ ] Add tests for 0/1/N connections, duplicate IDs, invalid JSON, unknown IDs, and secret-free summaries/errors.
- [ ] Run the focused tests and observe the expected missing module/behavior failures.
- [ ] Implement strict versioned file parsing, local init with mode `0600`, ignored file, and read-only Compose bind mount.
- [ ] Run focused credential tests and existing Notion config tests.

### Task 2: Multi-source persistence and migration

**Files:**
- Modify: `backend/app/models/notion_library.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/notion_multi_connection_v3.py`
- Modify: `backend/alembic/env.py`
- Modify: `backend/tests/test_notion_library.py`

**Interfaces:**
- `NotionSource` is one explicitly registered database and stores `connection_id`, database metadata, and its data-source IDs.
- `NotionDocument` records the originating data-source ID while retaining unique page IDs/slugs and source ownership.
- Existing source id 1 and its documents remain addressable after migration; existing data-source ID migrates into the new collection.

- [ ] Add failing ORM/migration tests for two databases, multiple data-source IDs, document source association, and legacy-row preservation.
- [ ] Run the focused tests and verify failure is due to absent multi-source fields/constraints.
- [ ] Add the additive migration chained after `notion_library_v2`; avoid destructive rewrites or branch heads.
- [ ] Run model and migration tests, including an upgrade from the prior schema.

### Task 3: Connection-aware Notion client and multi-data-source service

**Files:**
- Modify: `backend/app/services/notion_library.py`
- Modify: `backend/app/services/notion_sync.py` or extract renderer to `backend/app/services/notion_markdown.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `NotionLibraryService.inspect(db, connection_id, url) -> preview` performs no writes.
- `NotionLibraryService.import_source(db, connection_id, url, admin_id) -> result` revalidates and atomically registers/imports the database.
- `NotionLibraryService.sync(db, source_id, admin_id) -> result` uses the source's selected connection and is only called by an explicit route.
- `NotionLibraryClient(credential, transport)` always uses fixed host `api.notion.com` and `Notion-Version: 2026-03-11`.

- [ ] Add MockTransport tests for multiple credentials, wrong-connection denial, multiple data sources, pagination, preview no-write, source-level rollback, per-page isolation, idempotency, archive/unpublish, and page-parent validation.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement connection selection, retrieve-database/data-source flow, aggregate per-data-source previews, atomic import/sync, and stable error sanitization.
- [ ] Run all service tests and existing conversion/security tests.

### Task 4: Admin API and manual-only application wiring

**Files:**
- Modify: `backend/app/api/v1/notion.py`
- Modify: `backend/app/main.py`
- Modify: `compose.local.yml`
- Create: `backend/app/schemas/notion_library.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `GET /api/v1/admin/notion/connections`
- `GET /api/v1/admin/notion/sources`
- `GET /api/v1/admin/notion/status`
- `POST /api/v1/admin/notion/sources/inspect` with `{connection_id, url}`
- `POST /api/v1/admin/notion/sources` with `{connection_id, url}`
- `POST /api/v1/admin/notion/sources/{source_id}/sync`
- `POST /api/v1/admin/notion/sources/{source_id}/pages/inspect` and `/import` with `{url}`

- [ ] Add route tests for admin auth, connection metadata redaction, preview/import separation, wrong connection, error responses, and every route shape.
- [ ] Run the focused API tests and verify expected failures.
- [ ] Implement schemas/routes and explicit transaction commit/rollback behavior.
- [ ] Remove Notion scheduler/lifespan wiring and old scheduled route; retain unrelated transfer cleanup.
- [ ] Set local Compose sync default to false and test startup does not call Notion.
- [ ] Run the full backend Notion API suite.

### Task 5: Public document API and legacy post compatibility

**Files:**
- Create: `backend/app/api/v1/documents.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/v1/posts.py`
- Create: `backend/app/schemas/documents.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `GET /api/v1/documents?page=&page_size=&category=&q=&source_id=` returns published documents only.
- `GET /api/v1/documents/{slug}` returns a published document only.
- A legacy Notion post slug resolves to the library detail route; ordinary blog posts are unchanged.

- [ ] Add failing tests for published filtering, multi-source category/search, post isolation, detail 404, and legacy redirect.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement source-aware public queries and compatibility handling.
- [ ] Run public API and existing blog post tests.

### Task 6: Local operator workflow, verification, and evidence

**Files:**
- Modify: `scripts/local/README.md`
- Create: `scripts/local/NOTION.md`
- Create: `docs/research/32-notion-multi-connection-api-implementation.md`
- Modify: `.superpowers/sdd/2026-11-02-notion-multi-connection-implementation/progress.md`

- [ ] Document the exact local credential file path, JSON shape, chmod behavior, API list, Swagger test flow, and rotation steps without any real secret.
- [ ] Run Alembic graph/head checks and all backend tests; run existing frontend tests/build to catch regressions.
- [ ] Inspect OpenAPI routes, confirm `.secrets/` is ignored and not in image context, and scan diffs/logs/docs for secret leakage.
- [ ] Record exact commands/results, completed items, unresolved items, and one next hypothesis.
- [ ] Do not make real Notion requests until the user rotates credentials and fills the local file.
