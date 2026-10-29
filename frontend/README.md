# Personal Blog Frontend

Vue 3 + TypeScript + Vite frontend for the personal brand blog.

## Local development

```bash
npm install
npm run dev
```

The Vite proxy sends `/api` and `/uploads` to `http://localhost:8000`. Set
`VITE_API_BASE_URL` only when the frontend must call a different API origin;
otherwise `/api/v1` keeps local and reverse-proxied production paths aligned.

## Verification

```bash
npm run build
```

The build runs `vue-tsc -b` before creating the production bundle.
