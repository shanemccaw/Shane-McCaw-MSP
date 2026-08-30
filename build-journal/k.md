# #k — Fix GitHubIssueResult/GitHubIssueDetail cast crash

- **Status:** ✅ DONE
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** 954771994

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane hit live: "Couldn't reach GitHub: Unable to
  cast object of type 'BuildConsole.Services.GitHubIssueResult' to
  'BuildConsole.Services.GitHubIssueDetail'."

  Root cause: `GitHubApiClient.GetConditionalAsync<T>`'s static ETag cache
  (`_conditionalCache`) is keyed only by request path. `SearchIssuesAsync`'s
  numeric-lookup shortcut and `GetIssueAsync` both GET the exact same path
  (`repos/{owner}/{repo}/issues/{n}`) but deserialize to two different types
  (`GitHubIssueResult` vs `GitHubIssueDetail`). Whichever call happens first
  caches its typed object under that path; the second call's conditional GET
  gets a 304 and the cache hands back the FIRST call's object cast to the
  SECOND call's type — an InvalidCastException. Pre-existing bug, surfaced
  now because #i's new AI Batter Up chat column exercises `GetIssueAsync` for
  numbers that had likely also just gone through a numeric search.
- 2026-08-30 ✅ DONE — 954771994. Changed `GetConditionalAsync<T>`'s cache key
  from bare `path` to `typeof(T).FullName + "::" + path`, so two different
  callers requesting the same URL with different response types each get
  their own ETag/cached-value slot — no more cross-type collision, and each
  caller keeps its own real conditional-GET (304) benefit independently.
  **Verification:** `dotnet build -c Debug` — 0 warnings, 0 errors. Not
  live-reproduced end-to-end against real GitHub traffic this session (would
  need triggering `SearchIssuesAsync` and `GetIssueAsync` back-to-back for
  the same number against live rate-limited GitHub) — the fix is a single,
  narrowly-scoped cache-key change addressing the exact mechanism the crash
  message identified (a bad cast between the two named types). `git status
  --porcelain` clean; `verify-branch-merged.mjs` confirms `main` merged into
  `origin/main` (954771994).
