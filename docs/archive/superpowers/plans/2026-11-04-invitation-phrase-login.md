# 登录与注册验证实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为普通访客提供短语验证注册、账号密码登录和评论入口，并在页眉显示登录入口或用户名。

**Architecture:** FastAPI 只从服务端环境读取共享注册短语，在创建用户前校验；现有登录与令牌接口保持账号密码语义。Vue 增加普通 `/login` 路由并复用认证页面，管理员路由继续限制管理员；站点页眉与文章评论区连接到普通登录。

**Tech Stack:** FastAPI、Pydantic Settings、SQLAlchemy async、Vue 3、Vue Router、Pinia、Vitest、pytest。

**Spec:** `docs/archive/superpowers/specs/2026-11-04-invitation-phrase-login-design.md`

## Global Constraints

- 注册验证短语仅由后端环境变量 `REGISTRATION_PHRASE` 配置；空值关闭自助注册。
- 注册用户保持 `is_admin = false`；普通登录不需要验证短语。
- 保留 `/admin/login` 的管理员访问限制。
- 不改动与本功能无关的沉浸式 WebGL 变更。

## Review Focus

- 中文短语比较须使用 UTF-8 字节，避免 Unicode 输入触发比较错误。
- 短语为空时注册必须关闭，不能退化成无验证注册。
- 登录跳转须拒绝外站地址和普通用户的 `/admin` 目标。
- 登录态初始化期间，页眉不能把已登录用户误显示为未登录。
- 管理员入口必须继续拒绝普通用户。

---

### Task 1: 服务端注册短语校验

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/schemas/user.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/.env.example`
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/.env.production.example`
- Test: `backend/tests/test_auth_flow.py`

- [ ] Add failing API tests for wrong phrase, missing configuration, and successful registration followed by password-only login.
- [ ] Run `cd backend && pytest tests/test_auth_flow.py -q`; confirm failures are caused by missing phrase enforcement.
- [ ] Add `REGISTRATION_PHRASE` server setting, registration request field, and constant-time UTF-8 validation before user creation.
- [ ] Pass the optional server environment variable through production Compose and document its blank default without placing the phrase in tracked files.
- [ ] Re-run the focused API tests, then `cd backend && pytest -q`.

### Task 2: 普通登录与注册页面

**Files:**
- Modify: `frontend/src/api/auth.ts`
- Modify: `frontend/src/views/auth/Register.vue`
- Modify: `frontend/src/views/admin/Login.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/ui/element-plus.ts`
- Test: `frontend/src/router/index.test.ts`
- Test: `frontend/src/views/auth/Register.test.ts`
- Test: `frontend/src/views/admin/Login.test.ts`

- [ ] Add failing route and form tests for public `/login`, registration phrase submission, and password-only login.
- [ ] Run focused Vitest tests and confirm the new route/fields are absent or behavior fails.
- [ ] Add the public route, registration phrase field and request typing; keep administrator-only checks scoped to `/admin/login`.
- [ ] Validate internal redirects and send ordinary users away from `/admin`.
- [ ] Re-run focused Vitest tests, then `cd frontend && npm run build`.

### Task 3: 页眉与评论登录入口

**Files:**
- Modify: `frontend/src/components/navigation/SiteHeader.vue`
- Modify: `frontend/src/views/blog/PostDetail.vue`
- Modify: `frontend/src/router/index.test.ts`
- Modify: `frontend/src/components/navigation/SiteHeader.test.ts`
- Modify: `frontend/src/views/blog/PostDetail.test.ts`

- [ ] Add failing tests for the logged-out header link, logged-in username, and comment login link carrying the current article path.
- [ ] Run focused Vitest tests and verify expected failures.
- [ ] Add the left-side account label and comment login link; preserve the public navigation layout and mobile behavior.
- [ ] Run the focused tests, full frontend suite `cd frontend && npm test`, and `cd frontend && npm run build`.

