# Notion UI and browser acceptance implementation plan

Spec: `docs/archive/superpowers/specs/2026-11-02-notion-ui-acceptance-design.md`

Global constraints: preserve the existing dirty worktree; no commits, staging, deploys or Notion mutations. Existing branch codex/blog-v1.2 is the authorized workspace. Keep secrets local and out of artifacts. Execute inline under test-driven-development and verification-before-completion skills.

## Task 1: Typed API and multi-connection admin workflow

Interfaces: current `/admin/notion/connections`, `/sources`, `/status` and inspect/import/sync endpoints.
1. Replace legacy component tests with checks for read-only mount, explicit confirmation, preview invalidation, errors and source/page operations; add transport contract tests.
2. Run focused Vitest tests. Expected: new behavior fails before implementation.
3. Implement typed transport and native, accessible management controls.
4. Rerun focused tests. Expected: pass.

## Task 2: Public documents and compatible links

Interfaces: public `/documents` API, router and header; consumes document shapes also returned by redirected old posts API.
1. Add tests for query/pagination/abort/error handling, Markdown safety, detail routes and old-post redirection.
2. Run focused tests. Expected: fails before implementation.
3. Implement list, detail, navigation and compatibility. Add markdown-it as an explicit direct dependency with HTML disabled.
4. Run focused and full frontend suite/build/bundle budget. Expected: pass with existing lazy chunk warnings recorded.

## Task 3: Local integration and acceptance

Interfaces: tasks 1/2 together against real local API/PostgreSQL and user-selected Notion connection.
1. Start local services, apply migrations, execute complete backend suite with isolated PostgreSQL tests where feasible.
2. Add reproducible Chrome journey, capture desktop/mobile screenshots, keyboard and axe checks. Clearly label local fixture checks separately from real Notion.
3. If supplied, inspect/import real selected database through browser, validate public list/detail/search and manual re-sync. Never infer approval to import other databases.
4. Independent review, fix material findings, rerun affected checks, record results and remaining external blockers in research report.
