---
name: API server PORT fallback in dev script
description: The Replit workflow system doesn't reliably inject PORT for the api-server dev workflow; the dev script must default it.
---

The api-server `index.ts` throws immediately if `process.env.PORT` is missing:
```
throw new Error("PORT environment variable is required but was not provided.");
```

When the Replit workflow manager runs `pnpm --filter @workspace/api-server run dev`, it may not inject the `PORT` env var (even though `localPort = 8080` is set in `artifact.toml`). This causes the server to crash silently before opening any port, so the workflow manager reports "didn't open port 8080" and marks the workflow failed.

**Fix:** In `artifacts/api-server/package.json`, the `dev` script must include a PORT fallback:
```json
"dev": "export NODE_ENV=development PORT=${PORT:-8080} && pnpm run build && pnpm run start"
```

**Why:** The `${PORT:-8080}` shell expansion means "use $PORT if set, otherwise 8080". This covers both Replit-injected PORT and direct manual startup.

**How to apply:** Any time the api-server's dev script is modified, preserve the `PORT=${PORT:-8080}` export. Do not remove it — removing it will cause the workflow to fail silently with no visible error in the workflow logs.
