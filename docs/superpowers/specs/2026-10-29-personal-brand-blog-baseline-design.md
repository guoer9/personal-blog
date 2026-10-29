# Personal Brand Blog Baseline Design

## Intent

Stabilize this project as a public, single-author personal brand blog. The site should present the author's work and downloadable resources, support private administration, and remain simple to operate on one server.

The current Vue 3 + FastAPI + PostgreSQL stack is sufficient. The immediate problem is reliability and release safety: the frontend does not build, deployment settings disagree, stale domain references remain, and security and test coverage are incomplete.

## Goals

- Make local development and production configuration explicit and repeatable.
- Remove the expired `cgwdn.icu` domain and its certificate references from repository configuration.
- Keep deployment on Systemd + Nginx; use Docker Compose only for local PostgreSQL.
- Restore a passing frontend build and a documented backend health/migration check.
- Harden authentication, refresh tokens, uploads, CORS, and admin-only operations.
- Add focused backend, frontend, and browser smoke coverage for the public and admin paths.
- Leave the project ready for a future domain without embedding a specific domain in source files.

## Non-goals

- No React or Next.js migration.
- No full Docker deployment migration in this iteration.
- No visual redesign or new engagement features such as likes, subscriptions, or notifications.
- No remote server or DNS changes; this workspace has no server credentials. The repository's stale deployment references will be cleaned.
- No destructive deletion of existing content or local data.

## Anti-goals

- Do not keep secrets, real credentials, or certificate paths in the repository.
- Do not make deployment appear successful when a domain, database, or secret has not been configured.
- Do not broaden public upload or admin access to make tests easier.
- Do not add infrastructure that cannot be verified locally.

## Approaches

### Selected: Systemd + Nginx, Docker Compose for local PostgreSQL

This matches the existing deployment files and is appropriate for a single small server. Nginx serves the built Vue app and proxies `/api`; Systemd runs FastAPI; Docker Compose gives local development a reproducible PostgreSQL instance. Domain and secret values come from deployment-time environment files.

### Rejected: Full Docker Compose deployment

This would make the runtime more portable, but it requires Dockerfiles, health checks, migration ordering, persistent volumes, reverse-proxy certificates, backup conventions, and a new release workflow. It adds migration risk before the current application baseline is trustworthy.

## Design Decisions

### Configuration and expired-domain cleanup

- Add a root `.gitignore` covering backend environments, uploads, virtual environments, build output, caches, and local IDE files.
- Keep `.env.example` files as safe templates only. Replace the expired domain in frontend and backend examples with `http://localhost:5173` and `https://your-domain.example` placeholders.
- Move production runtime configuration out of the repository path conceptually: Systemd will read a server-managed environment file, while the repository contains only a documented template.
- Replace hardcoded Nginx domain and certificate paths with deployment-time substitution variables or a clearly marked template that cannot be mistaken for a live configuration.
- Make the local database port consistent across Compose, Alembic, and the backend example configuration.
- Document that replacing an expired domain requires new DNS, certificates, CORS origins, frontend API base URL, and a server-managed secret.

### Build baseline

- Fix the current TypeScript errors in the router, request utility, tag exports, registration validator, and unused Home import.
- Make the frontend request base URL honor `VITE_API_BASE_URL` while retaining `/api/v1` as the local proxy default.
- Keep the current Vue/Element Plus architecture and avoid unrelated refactors.

### Security baseline

- Require access-token type `access` in protected dependencies; require `refresh` and an active user in refresh flow.
- Keep admin checks server-side and require authentication for uploads; validate extension, MIME type, size, and storage path.
- Add bounded request validation and explicit error handling for comments, tags, and file operations.
- Avoid storing production secrets in source files and fail clearly when production configuration is incomplete.
- Add security-focused tests for token confusion, unauthorized uploads, admin routes, and invalid file inputs.

### Test baseline

- Backend: pytest coverage for health, registration/login, access/refresh tokens, admin authorization, post CRUD, comments, tags, and upload limits.
- Frontend: typecheck/build as a required check, plus focused component or request tests for auth state, API base URL, and post editing.
- Browser smoke: start the local stack and verify public home, post detail, search/tag navigation, login, and admin route protection.
- Add one repeatable verification entrypoint in the README and keep CI setup small enough for a single repository.

## Builder Decisions Left Open

- The future public domain and server credentials remain deployment inputs, not repository decisions.
- The builder may choose the exact test libraries and environment-file location as long as the contracts above hold.
- The builder may choose whether Nginx configuration is generated from a template or documented as a server-side file, provided the expired domain is absent from source configuration.

## Acceptance Criteria

- `npm run build` passes.
- Backend compilation, migration configuration, and `/health` checks pass locally.
- No repository file contains `cgwdn.icu`, real production credentials, or live certificate paths.
- Protected endpoints reject refresh tokens and unauthenticated uploads.
- A clean local setup can start PostgreSQL, apply migrations, run the API, and serve the frontend using documented steps.
- Automated checks cover the main public and admin flows and fail on regressions.
