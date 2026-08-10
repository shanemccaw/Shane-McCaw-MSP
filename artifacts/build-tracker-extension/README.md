# Build Tracker Chat Sync

An unpacked Edge/Chrome extension with two parts, both running on
`claude.ai/chat/<id>` pages:

1. **Title sync** — sends the conversation ID and the tab's title to Build
   Tracker's `POST /admin/build-tracker/chats/ingest` endpoint, so the chat
   shows up already labeled instead of a bare conversation ID.
2. **"What am I working on?" panel** — a small floating tab on the right
   edge of the page. Expand it to see your open Milestones/Epics/Issues and
   click one to link the *current* chat to it, right there in the chat —
   no round-trip to Build Tracker needed to figure out where a chat belongs.
   Once a chat is already linked to an epic, the panel switches to a
   focused view — just that epic and its own open issues, plus a progress
   bar for the milestone it belongs to — instead of the whole board. Click
   "Show everything" to browse past it if you need to. A `complete`-labeled
   issue's row is a single click to tell Claude it landed (inserts
   `"<number> landed"` into the composer — you press Enter); the header's
   📋 button copies Claude's last code block straight to your clipboard,
   since the panel sits over claude.ai's own per-block copy button.

There's no server-side way to fetch a claude.ai conversation's title or
content — a plain HTTP GET on the chat URL 403s without your session
cookie, and even with one, claude.ai is a client-rendered SPA so the raw
HTML wouldn't carry it anyway (confirmed directly, not assumed — and its
response headers explicitly set `X-Frame-Options: SAMEORIGIN` and a locked
`frame-src 'self'` CSP, so it can't be embedded in Build Tracker either).
This extension works because it runs *inside* your already-logged-in tab
and just reads what's already rendered on the page.

## Install (Edge or Chrome — both use the same unpacked-extension flow)

1. Go to `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (toggle, top right).
3. Click **Load unpacked** and pick this `build-tracker-extension/` folder.
4. Click the extension's icon in the toolbar → **Open settings** (or right-click
   the icon → Options).

## Configure

You need two things in the Options page:

- **API base URL** — wherever your Build Tracker's API is actually reachable
  from a browser tab (e.g. `https://your-app.example.com`). This has to be a
  real public origin, not `localhost` — the extension can't reach a
  dev-only address.
- **Ingest token** — the value of the `BUILD_TRACKER_INGEST_TOKEN` environment
  variable on the api-server. **If you haven't set that secret yet, set it
  now** (Replit secrets, or wherever the api-server's env vars live) — the
  ingest route accepts either an admin session cookie or this token, and the
  extension has no session cookie to send, so without the token it can't
  authenticate at all.

Saving prompts a one-time permission grant for that specific origin — the
extension can't reach any other site, only the one you configured.

## Verify it's working

1. Open any `claude.ai/chat/<uuid>` conversation.
2. Wait a couple seconds (title sync debounces until the title stops
   changing, in case claude.ai is still streaming the generated name in).
3. Click the extension's toolbar icon — it should show "Last synced" with
   the chat's title.
4. In Build Tracker's Explorer, right-click the empty space → the chat should
   already be sitting in **Needs Triage** with a real title, not a raw UUID.
5. Back on the claude.ai page, click the **BUILD TRACKER** tab on the right
   edge — it should show your open Milestones/Epics/Issues. Click one; the
   panel's top line should switch to "Linked to: ...". Back in Build
   Tracker, that chat should now show up already linked, not in triage.

If either the popup or the panel shows an error, it's almost always one of:
wrong API base URL, wrong/unset token, or the api-server not reachable from
your browser at that URL.

The panel's ⟳ button does a **real GitHub sync** first, then reloads the
board — not just a re-read of Build Tracker's own (possibly stale) database.
That's what makes a freshly `in-flight`/`complete`-labeled issue (or its
milestone/epic changes) show up here without going to the admin panel and
clicking Sync GitHub yourself. It also means it can take a few seconds on a
real repo — the panel shows "Syncing from GitHub…" while it runs.

## What it does NOT do

- Doesn't read chat *content* — only the conversation ID (from the URL) and
  the tab title. The panel's Milestone/Epic/Issue list comes from Build
  Tracker's own data, not anything claude.ai exposes.
- Doesn't overwrite a title, or a link to an issue/epic, that you've already
  set by hand in Build Tracker — the server only backfills a title while a
  chat is still stubbed as its own conversation ID, and only applies a
  panel-click link while the chat is still completely unlinked (see
  `admin-build-tracker.ts`'s ingest route doc comment). Relinking an
  already-linked chat stays a deliberate action inside Build Tracker itself.
- Doesn't embed or display the claude.ai page anywhere — confirmed that
  claude.ai blocks being framed by any other origin, so there's no "peek at
  Build Tracker from inside claude.ai" the other way either; this panel is
  the realistic version of that.
