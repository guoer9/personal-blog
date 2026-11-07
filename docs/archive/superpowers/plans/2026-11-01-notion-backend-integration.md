# Notion Public Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old checkbox-to-blog sync with a manually triggered, link-validated Notion import that publishes safe pages into an independent public library.

**Architecture:** A dedicated `NotionLibraryService` validates a pasted Notion database/page link, reads the target source with a read-only client, converts each page independently, and atomically upserts `NotionDocument` records. Admin endpoints expose inspect/import/sync status; public document endpoints and Vue views remain separate from blog posts. Startup never starts a Notion task.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, Pydantic Settings, httpx MockTransport, pytest/pytest-asyncio, Vue 3, TypeScript, Vitest.

**Spec:** `docs/archive/superpowers/specs/2026-11-01-notion-library-link-import-design.md`

## Global Constraints

- Only the exact user-confirmed database title `日记和文档` is accepted.
- The local service reads only a new, locally configured `NOTION_TOKEN`; exposed chat credentials are not used.
- Notion access is manual only: no startup sync, scheduler, timer, or background Notion request.
- Database/page links are validated as HTTPS Notion URLs; requests go only to the fixed Notion API host.
- All safe active pages are public after explicit admin confirmation; failed/credential-bearing pages are isolated individually.
- Whole-source failures preserve the last successful publication state.
- Public documents never enter blog post lists/search; old Notion-backed post slugs redirect to documents.
- No cloud deployment, Notion writes, media copying, or unrelated v1.2 refactors.

## Review Focus

- A preview must not write or publish anything before confirmation.
- A page-level conversion/secret failure must not prevent other safe pages from importing.
- A source-level request or pagination failure must preserve prior documents exactly.
- A second manual sync must be idempotent and a title change must preserve the document slug.
- An invalid or external URL must not cause an outbound request to that URL.

### Task 1: Models, configuration, migration, and legacy mapping

**Files:**
- Modify: `backend/app/core/notion_config.py`
- Create: `backend/app/models/notion_library.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/notion_library_v2.py`
- Modify: `backend/alembic/env.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `NotionSource`: singleton verified source metadata; never stores the token.
- `NotionDocument`: unique Notion page ID, stable slug, title/content/categories, status (`published|isolated|archived`), isolation reason, legacy post slug.
- `NotionLibrarySyncState`: sanitized manual-run status and counters.

- [ ] Write failing model/config/migration tests.
- [ ] Run the focused tests and observe missing imports/columns.
- [ ] Implement the models, settings, exports, migration metadata, and Alembic model import.
- [ ] Run focused tests to green.

### Task 2: Link-aware client, safe conversion, preview, and manual import service

**Files:**
- Create: `backend/app/services/notion_library.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `parse_notion_source_url(value) -> ParsedNotionLink` rejects non-Notion/external URLs and extracts a UUID without fetching the user URL.
- `NotionLibraryService.inspect(url) -> preview` validates target title/schema and reads page summaries without writing local rows.
- `NotionLibraryService.import_source(db, url, admin_id) -> status` revalidates the link, converts pages, isolates individual failures, migrates legacy mappings, and commits safe results.
- `NotionLibraryService.sync(db, admin_id) -> status` manually reuses the stored source only.

- [ ] Add MockTransport tests for fixed-host requests, database/data-source resolution, pagination, category extraction, recursive Markdown, unsupported/private media rejection, secret scanning, and preview no-write behavior.
- [ ] Run focused tests to observe the missing service behavior.
- [ ] Implement bounded client, link validation, page conversion, per-page isolation, legacy migration, and atomic source-level failure handling.
- [ ] Run focused tests to green.

### Task 3: Admin API and manual-only application wiring

**Files:**
- Modify: `backend/app/api/v1/notion.py`
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example`
- Create: `backend/app/schemas/notion_library.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `GET /api/v1/admin/notion/status`
- `POST /api/v1/admin/notion/inspect` with `{url}`
- `POST /api/v1/admin/notion/import` with `{url}`
- `POST /api/v1/admin/notion/sync`

- [ ] Add route tests for admin auth, preview/import separation, safe response fields, not-ready, busy, and manual-only startup behavior.
- [ ] Implement request/response schemas and router calls.
- [ ] Remove Notion scheduler/lifespan wiring; retain other cleanup tasks.
- [ ] Run all backend Notion tests.

### Task 4: Public document API and legacy redirects

**Files:**
- Create: `backend/app/api/v1/documents.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/v1/posts.py`
- Create: `backend/app/schemas/documents.py`
- Test: `backend/tests/test_notion_library.py`

**Interfaces:**
- `GET /api/v1/documents?page=&page_size=&category=&q=` returns only published documents.
- `GET /api/v1/documents/{slug}` returns one published document.
- `/api/v1/posts/{legacy_slug}` redirects to `/library/{slug}` when the old post was migrated.

- [ ] Add failing public-list/detail/legacy-redirect tests.
- [ ] Implement public queries with no admin dependency and no Post joins in list/search.
- [ ] Run focused and backend tests.

### Task 5: Admin and public Vue flows

**Files:**
- Modify: `frontend/src/api/notion.ts`
- Create: `frontend/src/api/documents.ts`
- Modify: `frontend/src/views/admin/NotionSync.vue`
- Modify: `frontend/src/views/admin/NotionSync.test.ts`
- Create: `frontend/src/views/blog/Library.vue`
- Create: `frontend/src/views/blog/LibraryDetail.vue`
- Create: `frontend/src/views/blog/Library.test.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/layouts/MainLayout.vue`
- Modify: `frontend/src/components/navigation/SiteHeader.vue`

- [ ] Add failing tests for link inspection, confirmation, manual sync wording, public category navigation, and error states.
- [ ] Implement API clients, admin flow, public library list/detail, and nav/title entries.
- [ ] Run focused Vitest and the frontend suite.

### Task 6: Verification and research evidence

**Files:**
- Create: `docs/archive/research/32-notion-manual-library-implementation.md`

- [ ] Run backend and frontend suites, type/build checks, and migration/import checks.
- [ ] Review changed files for secret leakage, scheduler calls, and public/private route separation.
- [ ] Record evidence, experiments, retests, completed items, unresolved items, and the single next hypothesis.
