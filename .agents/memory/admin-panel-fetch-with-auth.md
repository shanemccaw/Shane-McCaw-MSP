---
name: Admin Panel fetchWithAuth Content-Type bug
description: The Admin Panel's fetchWithAuth had a bug that set Content-Type to application/json even for FormData bodies — this breaks multipart uploads.
---

The original Admin Panel `fetchWithAuth` in `artifacts/admin-panel/src/contexts/AuthContext.tsx` had:
```ts
headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
```

This is wrong for FormData bodies — the browser must set Content-Type (with the multipart boundary) automatically. Setting it to "application/json" causes the server to reject file uploads.

**Why:** The CRM's fetchWithAuth never had this line. The Admin Panel added it as a convenience for JSON calls, but it breaks any route that uses FormData (reports, documents, invoices with PDF attachments).

**How to apply:** Never set Content-Type in fetchWithAuth. Callers that send JSON should always pass `headers: { "Content-Type": "application/json" }` explicitly.
