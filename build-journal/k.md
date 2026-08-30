# #k — Fix GitHubIssueResult/GitHubIssueDetail cast crash

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** (fill at DONE)

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
