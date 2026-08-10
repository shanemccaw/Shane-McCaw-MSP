# Build Tracker Chat Sync

An unpacked Edge/Chrome extension. While you're on a `claude.ai/chat/<id>`
page, it sends the conversation ID and the tab's title to Build Tracker's
`POST /admin/build-tracker/chats/ingest` endpoint — so the chat shows up
already labeled instead of a bare conversation ID you'd otherwise paste in
by hand.

There's no server-side way to fetch a claude.ai conversation's title — a
plain HTTP GET on the chat URL 403s without your session cookie, and even
with one, claude.ai is a client-rendered SPA so the raw HTML wouldn't carry
the real title anyway. This extension works because it runs *inside* your
already-logged-in tab and just reads `document.title` off the live page.

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
2. Wait a couple seconds (it debounces until the title stops changing, in
   case claude.ai is still streaming the generated name in).
3. Click the extension's toolbar icon — it should show "Last synced" with
   the chat's title.
4. In Build Tracker's Explorer, right-click the empty space → the chat should
   already be sitting in **Needs Triage** with a real title, not a raw UUID.

If the popup shows an error, it's almost always one of: wrong API base URL,
wrong/unset token, or the api-server not reachable from your browser at that
URL.

## What it does NOT do

- Doesn't read chat *content* — only the conversation ID (from the URL) and
  the tab title.
- Doesn't overwrite a title you've already edited by hand in Build Tracker —
  the server only backfills a title while the chat is still stubbed as its
  own conversation ID (see `admin-build-tracker.ts`'s ingest route doc
  comment).
- Doesn't link the chat to an issue/epic — that's still a manual step in
  Build Tracker (Chat Triage, or the Explorer's "Assign triage chat..."
  right-click).
