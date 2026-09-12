/**
 * Build Tracker API — DISCONNECTED (Git #3652).
 *
 * #3651 moved BuildConsole's `bt_` tables to their own dedicated database
 * (`BUILD_DATABASE_URL`). This route family was never moved with it — it
 * still pointed at `bt_build_queue` / `bt_chats` / `bt_chat_issues` /
 * `bt_epics` / `bt_issues` in the api-server's own `DATABASE_URL` (the
 * shared product database), which now only holds a frozen pre-#3651 copy.
 * Serving or accepting reads/writes against that copy is silently wrong
 * data, not a working Build Tracker.
 *
 * Per #3652's decision (2026-09-11, Shane): disconnect, don't repair — this
 * whole route family (and BuildConsole's/admin-panel's HTTP callers into it)
 * is being deleted, not fixed. Every route below now returns an honest
 * "retired" response instead of touching the stale `bt_` tables. No
 * `@workspace/db` import, no `bt_*` table reference here on purpose.
 */

import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const RETIRED_BODY = {
  error: "retired",
  message:
    "This Build Tracker endpoint has been disconnected (Git #3652). It used to read/write bt_ tables out of the shared product database, which now only holds a frozen pre-#3651 copy since BuildConsole's own bt_ data moved to BUILD_DATABASE_URL. The route family is being deleted; no replacement is served here.",
};

// Git #3771 — Express 5's path-to-regexp (v8) dropped the bare trailing `*`
// wildcard this route used (`"/admin/build-tracker*"`), which throws
// `PathError: Missing parameter name` at router-registration time and crashes
// the ENTIRE api-server on startup — no route past this one in routes/index.ts
// ever registers. `{/*splat}` is the v8-correct equivalent: an optional
// group matching zero or more further path segments, so this still catches
// both the bare path and any sub-path exactly as before.
router.all("/admin/build-tracker{/*splat}", (_req: Request, res: Response) => {
  res.status(410).json(RETIRED_BODY);
});

export default router;
