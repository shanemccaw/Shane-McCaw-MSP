# Build Tracker Chat Sync

An unpacked Edge/Chrome extension with two parts, both running on
`claude.ai/chat/<id>` pages:

1. **Title sync** — sends the conversation ID and the tab's title to Build
   Tracker's `POST /admin/build-tracker/chats/ingest` endpoint, so the chat
   shows up already labeled instead of a bare conversation ID.
2. **"What am I working on?" panel** — opens by default on every claude.ai
   page (it remembers if you last closed it and stays closed until you
   reopen it, but a fresh install/browser starts open — the panel is meant
   to be left open, not reopened every time). Expand it to see your open
   Milestones/Epics/Issues and
   click one to link the *current* chat to it, right there in the chat —
   no round-trip to Build Tracker needed to figure out where a chat belongs.
   Once a chat is already linked to an epic, the panel switches to a
   focused view — just that epic and its own open issues, plus a progress
   bar for the milestone it belongs to — instead of the whole board. Click
   "Show everything" to browse past it if you need to. A `complete`-labeled
   issue's row is a single click to **actually close it on GitHub** (a real
   PATCH, not just cosmetic — this replaces the manual "Close issue" click
   on GitHub itself) and insert `"<number> landed"` into the composer — you
   press Enter to send that part; the header's
   📋 button copies Claude's last code block straight to your clipboard,
   since the panel sits over claude.ai's own per-block copy button. A
   `complete` row also gets a ✕ button to dismiss it once you're done with
   it — handy when several builds finish around the same time and the panel
   fills up with rows you've already acted on. Dismissed rows stay hidden
   (stored locally in the extension, not in Build Tracker) until you clear
   the extension's storage.

   The header's 🧭 button opens a **Milestone → Epic → chat** navigator for
   getting to a *different* chat's context — pick a milestone, then one of
   its epics, then click a chat linked to that epic to jump straight there
   (a real tab navigation, not just a link-this-chat action).

   Issues under an epic can themselves have sub-issues — GitHub tracks that
   as its own nested epic, not a plain issue, so it would otherwise be
   invisible from the epic you're actually looking at. The focused view now
   shows a **"Sub-epics under this one"** section above the plain issue
   list whenever that happens; click one to jump straight into its own
   chats via the navigator. A red banner up top also warns about any
   *closed* epic that still has open work underneath it — the exact "I
   might have closed parents thinking I was done" case, since a closed
   epic otherwise disappears from every other view here even with real
   work still open inside it.

   The focused view now also has its own **search box** (same one used for
   browsing — it just filters differently depending on which view you're
   in) and issues are listed by Git number, not alphabetically by title —
   with a lot of issues under one epic, alphabetical order was hard to scan.

   While the panel is open it polls in the background instead of waiting for
   a manual Refresh: every ~15s it quietly re-checks any `in-flight`-labeled
   issue on screen, and every ~30s it re-syncs the currently focused epic to
   catch anything newly added or closed. No loading flicker — it only
   re-renders if something actually changed, and it pauses while a dialog is
   open or the tab is backgrounded.

   The header's 🗄 and 💻 buttons open a **floaty SQL Runner** and **Deploy
   Console** — full read/write SQL, and shell commands (including free
   text), against your **development server**, one click to run. These
   aren't new backend capability: they call the exact same already-shipped
   admin-panel routes (`/api/simulator/sql/execute`,
   `/api/admin/simulator/deploy/*`) the admin panel's own SQL Runner and
   Deploy Console screens already use, just reachable without leaving
   claude.ai. Every result also lands straight in the chat composer, not
   just the on-screen output — a plain, compact rendering (a header row +
   one line per result row, not JSON — far fewer characters for the same
   data) rather than the pretty-printed JSON shown in the floaty window
   itself, so there's no copy/paste round-trip to hand a result to Claude.
   **Do not point this extension's API base URL at a production server** —
   anyone with the extension's bearer token gets full database and shell
   access to whatever it's configured against.

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

The panel's ⟳ button syncs differently depending on what's showing:

- **Focused on one epic** (the normal case): it syncs that WHOLE epic —
  one GitHub request for the epic issue itself plus GitHub's own sub-issues
  list for it — so a brand-new sub-issue added on GitHub shows up here too,
  not just label changes on issues Build Tracker already knew about.
- **Browsing everything**: it checks GitHub for just the issues currently
  visible in the panel (fast, no whole-repo pagination) — this mode covers
  multiple epics at once, so a per-epic sync doesn't apply.

Either way it's still not a whole-repo sync — to discover a brand-new
epic/issue/milestone Build Tracker has never seen at all, use the
**"Full sync from GitHub"** link at the bottom of the panel instead, which
does the same real whole-repo pull Build Tracker's own Sync button does
(slower — pages through every issue in the repo — but that's the only way
to catch something entirely new to Build Tracker).

The progress bar at the top of the focused view is **milestone-wide** —
every epic in that milestone, not just the one you're looking at — while
the issue list right below it is only this epic's own open issues. A
number like "13/21" up top next to only 2 rows below it isn't a bug: most
of that milestone's work just lives in other epics.

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
