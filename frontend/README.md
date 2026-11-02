# Personal Blog Frontend

Vue 3 + TypeScript + Vite frontend for the personal brand blog.

## Local development

```bash
npm install
npm run dev
```

The Vite proxy sends `/api` and `/uploads` to the isolated local API at
`http://127.0.0.1:8001` by default. Set `BLOG_API_PROXY` when the frontend
must use another development API origin. Set `VITE_API_BASE_URL` only when the
browser must call a different API origin; otherwise `/api/v1` keeps local and
reverse-proxied production paths aligned.

## Verification

```bash
npm run build
```

The build runs `vue-tsc -b` before creating the production bundle.

## Quality tooling

Requires Node.js **22.19 or newer** and a locally installed Google Chrome.
Dependencies are pinned in `package-lock.json`; restore them with `npm ci`.

Copy `.env.example` to `.env.local` if no local configuration exists. This file
is ignored by Git. Do not overwrite an existing file or put real credentials
in the example. The quality commands load `.env.local` automatically without
printing credentials.

Start the backend, then build and serve the production frontend in a separate
terminal:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

The default audit target is `http://127.0.0.1:4173`. Change `QUALITY_BASE_URL`
in `.env.local` to target another origin. A working article API is required;
the production preview inherits the local Vite API proxy.

```bash
npm run quality:doctor
npm run audit:axe
npm run audit:lighthouse -- desktop
npm run audit:lighthouse -- mobile
```

Reports are saved under the repository's ignored `output/quality/` directory.
The axe command scans five public routes at desktop and mobile sizes with
reduced motion, saves full JSON results, and exits with code 1 if violations
exist. Its `incomplete` results require manual review. Lighthouse produces
HTML and JSON reports; scores are informational, and a successful command
does not imply that every product acceptance criterion passes. Use separate,
repeated runs under controlled conditions for performance decisions.

### BrowserStack

The Codex BrowserStack connection and local test-runner credentials are
separate. Find **Username & Access Key** in the BrowserStack account settings,
then fill `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` in `.env.local`.
An Automate entitlement or trial is required for remote Playwright runs.

```bash
npm run browserstack:check
npm run test:browserstack
```

The first command only checks configuration and never starts a cloud session.
The second starts BrowserStack Local, connects Playwright directly to the
cloud, and checks the homepage, real article API and writing navigation.
It closes the browser and stops the tunnel when finished. Missing credentials
cause a clear exit before a cloud connection. One default desktop Chromium
session runs; this is not an iPhone/Safari validation. Adjust the browser/OS
configuration only to combinations supported by the account.

This uses BrowserStack's documented `chromium.connect` integration rather
than introducing a second test framework or replacing the existing Vitest
setup. The Codex plugin remains available for cloud-side investigation.

### Sentry

For a new account, create a project with **Vue** as the platform. A suggested
name is `personal-blog-frontend`; use the actual slug shown in that project's
settings as `SENTRY_PROJECT`. The organization slug belongs in `SENTRY_ORG`.
The onboarding run code is not a DSN or API token.

The two connections serve different purposes:

| Configuration | Purpose | Where to find it |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | Send browser errors to the selected project | Project Settings → Client Keys (DSN) |
| `VITE_SENTRY_ENABLED=true` | Explicitly enable the optional SDK | Set locally after selecting a real DSN |
| `VITE_SENTRY_ENVIRONMENT` | Separate development from production events | Use `development` locally; set `production` at deployment |
| `SENTRY_AUTH_TOKEN` | Let the read-only Sentry skill query issues | Account Settings → API → Auth Tokens |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Select the query organization and project | Organization and project slugs in Sentry settings |

Create a read-only query token with `org:read`, `project:read`, and `event:read`.
Do not prefix the token or BrowserStack credentials with `VITE_`, and do not
paste them into chat. A DSN enables event ingestion; it does not authorize
reading issues. An installed agent plugin alone does not supply these values.

The SDK stays disabled until enabled and given a nonempty DSN, and is loaded
dynamically. Initialization failure lets the site continue. Sentry 11 uses
`dataCollection` controls; this setup disables automatic user info, cookies,
HTTP headers/bodies, URL query values and Vue prop collection. Tracing and
Replay integrations are not installed. Browser variables are embedded at
build time: restart the dev server, or rebuild the preview, after changing
them. Configuring a development DSN does not establish production monitoring.
Startup does not await the optional SDK download, so a stalled monitoring
request cannot block page rendering. Errors thrown before the SDK becomes
ready may not be captured.

Before claiming cloud setup is complete, send an identifiable test error to
the chosen development project and confirm it appears in Sentry. Remove the
temporary trigger afterward. Production issue summaries require an actual
API query against the intended project, environment and time range.
