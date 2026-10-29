# Personal Brand Blog Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single-author public blog safe to configure, build, test, and deploy on one server without carrying the expired domain or production placeholders.

**Architecture:** Keep Vue 3 + Vite + Element Plus in the frontend and FastAPI + async SQLAlchemy + PostgreSQL in the backend. Keep Systemd + Nginx as the production runtime; Docker Compose remains a local PostgreSQL helper. Deployment-specific domain, certificate, database, and secret values stay outside the repository.

**Tech Stack:** Vue 3, TypeScript, Vite, Axios, FastAPI, SQLAlchemy 2, PostgreSQL, Alembic, pytest, pytest-asyncio, httpx, aiosqlite, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-10-29-personal-brand-blog-baseline-design.md`

## Global Constraints

- The public product is a personal brand site for one author and public visitors.
- The deployment route is Systemd + Nginx; Docker Compose is local-only PostgreSQL.
- No repository file may contain `cgwdn.icu`, live certificate paths, or production credentials.
- No React/Next.js migration and no full Docker deployment migration.
- Do not delete user content or remote server data.
- Every task ends with a verification command and a Git commit.

## Review Focus

- A missing or stale `VITE_API_BASE_URL` must fall back to the local `/api/v1` proxy without breaking the production build. Test the default and explicit values in the request client.
- A refresh token must not authenticate protected endpoints, while a valid access token must still work. Test both token types at the dependency boundary.
- File uploads must reject unauthenticated requests, disallowed extensions, and oversized content before persistence. Test each rejection path.
- Deployment templates must not silently point at the expired domain or read a repository-local production secret. Test repository scans for stale domain and secret markers.
- Admin post editing must fetch by numeric ID and preserve the existing update contract. Test the API call shape and edit-page data loading.

### Task 1: Git and Configuration Baseline

**Files:**
- Create: `.gitignore`
- Modify: `backend/.env.example`, `frontend/.env.example`, `docker-compose.yml`, `backend/alembic.ini`
- Modify: `deploy/nginx.conf`, `deploy/deploy.sh`, `deploy/blog-api.service`
- Modify: `README.md`, `frontend/README.md`
- Test: repository scans with `rg`

**Interfaces:**
- Produces safe environment templates and deployment placeholders consumed by later runtime and test tasks.

- [ ] **Step 1: Add repository ignore rules** for `.env*` except examples, Python virtual environments, uploads, frontend dependencies/build output, caches, `.DS_Store`, and local worktree artifacts.
- [ ] **Step 2: Remove stale domain and secret references** from templates and deployment files; use `your-domain.example`, `/etc/personal-blog/blog-api.env`, and deployment-time certificate paths.
- [ ] **Step 3: Make local PostgreSQL configuration consistent** across Compose, Alembic, and backend examples using host port `5433`.
- [ ] **Step 4: Document local setup, production inputs, and verification commands** in the two README files.
- [ ] **Step 5: Run `rg -n -i 'cgwdn\\.icu|your-secure-password|super-secret-key|blogpassword|letsencrypt/live' ...` and inspect the result.** Expected: only safe explanatory placeholder text remains, with no expired domain or live certificate path.
- [ ] **Step 6: Commit** with `chore: establish safe configuration baseline`.

### Task 2: Frontend Build and API Contract

**Files:**
- Modify: `frontend/src/api/tags.ts`, `frontend/src/utils/request.ts`, `frontend/src/router/index.ts`, `frontend/src/views/auth/Register.vue`, `frontend/src/views/blog/Home.vue`, `frontend/src/views/admin/PostEdit.vue`
- Modify: `frontend/vite.config.ts`, `frontend/.env.example`
- Test: `frontend/npm run build`

**Interfaces:**
- Produces a passing Vite build and an API client whose base URL is `import.meta.env.VITE_API_BASE_URL || '/api/v1'`.
- `getPostById(id: number)` or an equivalent admin-only loader is used by the edit page; public slug loading remains unchanged.

- [ ] **Step 1: Run the current build and record the expected TypeScript failures** so the regression target is explicit.
- [ ] **Step 2: Export the shared `Tag` type and remove unused imports/parameters** in the files named above.
- [ ] **Step 3: Add the environment-aware request base URL** while preserving the local Vite proxy fallback.
- [ ] **Step 4: Add the admin post-by-ID loader and switch `PostEdit.vue` to it.** Keep `updatePost(id, data)` unchanged.
- [ ] **Step 5: Run `npm run build`.** Expected: `vue-tsc -b` and `vite build` exit 0.
- [ ] **Step 6: Commit** with `fix: restore frontend build and admin edit contract`.

### Task 3: Authentication and Upload Security

**Files:**
- Modify: `backend/app/api/deps.py`, `backend/app/api/v1/auth.py`, `backend/app/api/v1/files.py`, `backend/app/core/config.py`, `backend/app/crud/file.py`
- Test: `backend/tests/test_security.py`, `backend/tests/test_uploads.py`
- Modify: `backend/requirements-dev.txt`

**Interfaces:**
- Protected dependencies accept only access tokens.
- Refresh accepts only refresh tokens belonging to an active user.
- Upload endpoint requires an authenticated user and validates extension, MIME, and size before writing.

- [ ] **Step 1: Add test dependencies and write failing tests** for token-type rejection, refresh-user validation, unauthenticated upload rejection, invalid extension rejection, and upload-size rejection.
- [ ] **Step 2: Run the focused tests** and confirm they fail for the current implementation.
- [ ] **Step 3: Implement token-type checks and active-user checks** without changing the public token response schema.
- [ ] **Step 4: Require authentication for uploads and make file validation bounded and explicit.** Preserve the existing response shape and upload URL contract.
- [ ] **Step 5: Run the focused backend tests** and expect all listed cases to pass.
- [ ] **Step 6: Commit** with `fix: harden authentication and uploads`.

### Task 4: Backend Test Harness and Core Flow Coverage

**Files:**
- Create: `backend/tests/conftest.py`, `backend/tests/test_health.py`, `backend/tests/test_auth_flow.py`, `backend/tests/test_posts.py`
- Modify: `backend/requirements-dev.txt`, `README.md`

**Interfaces:**
- Tests use an isolated SQLite database and FastAPI dependency overrides; production PostgreSQL configuration remains unchanged.

- [ ] **Step 1: Create the async SQLite test fixture** with table creation, dependency override, and cleanup.
- [ ] **Step 2: Add failing tests** for health, registration/login, protected `/auth/me`, admin post creation, public post listing, and post update authorization.
- [ ] **Step 3: Run the tests** and confirm failures expose missing fixtures or behavior rather than collection errors.
- [ ] **Step 4: Adjust only the production code required to satisfy the contract** and keep test-only setup in `backend/tests`.
- [ ] **Step 5: Run `pytest -q` from `backend`.** Expected: all backend tests pass.
- [ ] **Step 6: Commit** with `test: cover backend auth and post flows`.

### Task 5: Browser Smoke and Release Verification

**Files:**
- Create: `scripts/check-repository-baseline.sh`
- Modify: `README.md`
- Test artifacts: `output/playwright/`

**Interfaces:**
- The repository check script exits nonzero for stale domain/certificate/secret markers and zero for the cleaned tree.

- [ ] **Step 1: Add the repository baseline check script** for forbidden domain, certificate, credential markers, frontend build, Python compilation, and backend tests.
- [ ] **Step 2: Start the frontend dev server and use the Playwright CLI** to verify `/`, `/login`, `/register`, and the wildcard 404 route render without a blank page.
- [ ] **Step 3: Capture a desktop and mobile screenshot** under `output/playwright/` and inspect for layout overflow or blank content.
- [ ] **Step 4: Run the full release check script.** Expected: all static scans, build, compile, and tests pass.
- [ ] **Step 5: Commit** with `test: add repeatable release verification`.

## Final Verification

- `git log --oneline` shows one commit per completed task.
- `npm run build` passes from `frontend`.
- `pytest -q` passes from `backend`.
- `python -m compileall -q app` passes from `backend`.
- The repository baseline script passes and reports no expired domain or live secret markers.
- Playwright captures nonblank public and auth pages at desktop and mobile sizes.
