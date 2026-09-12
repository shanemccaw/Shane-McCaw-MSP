# BuildConsole Chat — Tools Reference

Reference for what a BuildConsole chat/agent session should reach for when it needs to touch
GitHub. See `desktop/BuildConsole/AGENT_PROTOCOLS.md` for the `shaneapp://` protocol contracts
(`runTest`, `executeSql`, `reportProgress`); this doc covers GitHub specifically.

## GitHub — use the `shanes-git` MCP connector, not a raw PAT

**Real, corrected architecture (2026-09-10, Git #3397) — read this before assuming anything
about hosting.** The GitHub MCP server for Feature #3377 was originally planned to be hosted
*inside* Shane's Life's existing MCP server (`web/shanes-life`). **That did not happen.** It
does not live there, and a future reader should not go looking for it there. Real, confirmed,
live deployment:

- Runs as its **own standalone Replit Repl**, named **`shanes-git`**, live in production at
  `https://shanes-git.replit.app`.
- Has its **own** Replit-provisioned Postgres — genuinely separate from both Shane's Life's DB
  and the MSP platform's `shanemccawmsp` DB.
- Has its **own** `GITHUB_MCP_PAT`, scoped to `shanemccaw/Shane-McCaw-MSP` (`repo` + `project`
  scopes), held **server-side only**. The PAT is never returned in a tool call input, a tool
  call result, a log line, or an audit row.
- Source lives in this repo at `artifacts/github-mcp-server` (see that package's own README for
  implementation detail — token minting, schema, activity logging).
- Real reason for the deployment deviation: Shane was out of Replit Agent credits and didn't
  want to touch Shane's Life's live production code path (a personal app he uses daily) to do
  the TypeScript-to-`.mjs` integration work the original plan implied.
- **Verified end-to-end (2026-09-10):** `github_whoami` called through a live Claude session
  connected to the real `shanes-git` connector (auth: bearer token header, same pattern as
  Shane's Life's own MCP guide, `auth: None` at the transport layer) returned the real
  `shanemccaw` identity and real scopes.

### Why this replaces raw-PAT `bash_tool` + `curl`

Before this connector existed, a chat that needed to touch GitHub pasted a raw PAT into the
message and ran `curl`/`git` by hand — putting the live credential in plaintext in conversation
history, searchable and re-surfaceable indefinitely. `shanes-git` removes that: the PAT is
consumed internally by the server and never crosses back into chat. **Do not paste a raw PAT
into a chat message or a `bash_tool` `curl` call for anything the connector already covers below**
— use the connector's tools instead.

### Real, live tool list

- `server_status` — health check; reports `patConfigured` as a boolean only, never the value.
- `github_whoami` — proves the server-side credential works; returns identity + scopes only.
- `get_issue(number, repo?)` / `create_issue(title, body?, milestone?, labels?, repo?)` /
  `update_issue(number, title?, body?, milestone?, labels?, state?, repo?)` — `milestone` is the
  real milestone *number*, not its title; `update_issue`'s `labels`, when passed, replaces the
  full label set (GitHub's own PATCH semantics), not an add/remove diff.
- `search_issues(query, perPage?, repo?)` — real passthrough to GitHub's search syntax, scoped
  automatically to the target repo.
- `post_comment(number, body, repo?)` / `list_comments(number, repo?)` — `list_comments`
  paginates through every comment, oldest-first.
- `close_issue(number, state_reason, comment?, repo?)` — `not_planned` is rejected before any
  GitHub call unless a non-empty `comment` is supplied, and that comment posts first, enforcing
  the repo's standing NOT_PLANNED-always-carries-a-comment rule (Git #2167) in the tool itself.
- `move_to_status(number, status, repo?)` — moves an issue/epic to one of the real Projects v2
  board columns: `Batter Up`, `Backlog`, `AI Batter Up`, `Ask Shane`, `Done`. Validated against
  that exact vocabulary before any GitHub call fires. `repo` only changes which repo's issue is
  looked up — the board itself is one shared board regardless of `repo`.
- `get_board_status(number, repo?)` — read counterpart to `move_to_status`; same `repo` semantics
  (issue lookup only, board is shared).
- `list_board_column(status, epicNumber?)` — **no `repo` param.** It queries the shared Projects
  v2 board node directly with no per-repo issue lookup in its query, so there's nothing for a
  `repo` argument to do.
- `add_sub_issue(parent_number, child_number, repo?)` /
  `remove_sub_issue(parent_number, child_number, repo?)` / `list_sub_issues(number, repo?)` —
  real sub-issue hierarchy management (GitHub's one-parent rule applies — remove an existing
  parent first to re-parent). `repo` applies to both parent and child.
- `set_blocked_by(number, blocker_numbers[], repo?)` — makes `number`'s real `blocked_by` edges
  match the given list exactly (adds missing, removes stale — pass `[]` to clear). Use this, not
  a comment alone, any time CLAUDE.md's "a blocking conclusion must become a `blocked_by` edge"
  rule applies. `repo` applies to `number` and every blocker.
- `list_blocked_by(number, repo?)` — real current blockers + their live GitHub state.
- `get_recent_activity` — the audit trail of what each connected chat/session has actually done
  through this server.

### Bulk board/hierarchy management — `batch_*` tools (Git #3709)

Real, direct motivation: a real #1202 sub-issue reorganization needed 166+ individual
`remove_sub_issue`/`add_sub_issue` call pairs, done via a raw script outside `shanes-git` entirely
because no batch capability existed. These three cover that class of bulk operation from inside
the connector itself. Each runs its existing single-item tool's own real logic **one item at a
time, sequentially** (never in parallel — a burst of concurrent writes against one repo risks
GitHub's own secondary rate limits), with **independent per-item success/failure reporting —
never all-or-nothing.** One bad item never blocks or rolls back the others. Every batch tool
returns `{ totalAttempted, succeededCount, failedCount, results[] }`, each result item carrying
its own real success/failure and, on failure, the real reason.

- `batch_reparent_sub_issues(moves: [{ issueNumber, fromParent, toParent }], repo?, context)` —
  per move: `remove_sub_issue(fromParent)` then `add_sub_issue(toParent)`, with the same real
  Epic/Feature hierarchy enforcement and proactive 100-sub-issue-cap overflow redirect
  `add_sub_issue` itself applies. GitHub's one-parent-at-a-time rule means this is genuinely two
  writes per item — if the remove succeeds but the add then fails, that's reported as a distinct
  `{ success: false, partial: true }` (the child now has no parent at all, not "nothing
  happened") rather than an ordinary failure.
- `batch_move_to_status(moves: [{ number, status }], repo?, context)` — bulk board-status moves,
  same real 5-value vocabulary and per-item validation as `move_to_status`.
- `batch_close_issues(closures: [{ number, stateReason, comment? }], repo?, context)` — bulk
  closing, same real per-item `close_issue` logic including the standing NOT_PLANNED-needs-a-
  comment rule (Git #2167) — this never closes an issue without a genuine, correctly-formed
  per-item request; "you never close an issue" (Shane's decision, or an explicit instruction on
  his behalf) is unchanged, this just executes many at once.

### Reading the actual code — `get_file_contents` / `list_directory` / `search_code` (Git #3697)

Everything listed above is issue-tracker and board metadata. Until #3697 that was the *entire*
tool surface, which meant a chat connected only to `shanes-git` could manage the board but could
not read a single line of the code it was discussing. That was survivable only while a chat could
be handed a raw PAT and `git clone` the repo itself — once the repo went private and PAT-in-chat
was retired (#3556/#3559), nothing replaced the capability. **These three tools are the
replacement, and they are how a chat reads real repository code. Do not ask for a PAT to do it.**

All three use the same server-side `GITHUB_MCP_PAT` every write tool already authenticates with,
so the private repo is readable without any credential entering chat. All three are read-only, so
none takes `context`. All three take the optional `repo` parameter below.

- `get_file_contents(path, ref?, repo?)` — one real file's actual text. `path` is
  repo-root-relative and **case-sensitive**; `ref` pins a branch/tag/commit SHA (default branch
  when omitted). Real text comes back in `content`.

  It never hands back text it didn't actually get. A file over GitHub's ~1MB Contents API inline
  limit returns `content: null, truncated: true` with the real byte size and a real `downloadUrl`
  — **not** an empty string that looks like an empty file. A binary file returns
  `content: null, binary: true` rather than a mangled UTF-8 decoding. A directory, a symlink, a
  submodule, or a missing path each get their own plain-English message naming the real path.

- `list_directory(path?, ref?, repo?)` — one directory's real entries (name, path, type, size).
  Omit `path` for the repo root. Non-recursive — call again with a subdirectory's path. This is
  how you navigate to a path before reading it; `get_file_contents` is only useful once you know
  one. Capped by GitHub at 1000 entries per directory, reported as `truncated: true` if hit.

- `search_code(query, perPage?, page?, ref?, repo?)` — GitHub code-search syntax, repo scoped in
  automatically. **Read the `source` field on the result**, because there are two real backends:

  - `source: "code-search"` — GitHub's own code-search index. Real *content* search, with real
    matching fragments per hit. Default branch only.
  - `source: "repo-tree-paths"` — a real *path* search over the repository's whole git tree,
    used when the index returns nothing usable.

  **The fallback exists because GitHub's code-search index genuinely returns nothing for
  `shanemccaw/Shane-McCaw-MSP`** — `total_count: 0` with `incomplete_results: true` on every query
  tried (verified 2026-09-11 over seven distinct queries and three repeats; the identical call
  against a public repo returned real hits). So in practice, on this repo today, `search_code`
  answers from the tree and matches **file paths, not file contents**. An empty result from it is
  *not* evidence the code doesn't exist — it means no path matched. To search content, narrow with
  `list_directory` and read candidates with `get_file_contents`. The result's own `note` says all
  of this every time; the limitation is tracked as its own finding under Feature #3377.

  Path-search qualifiers that genuinely work: `path:`, `filename:` (with `*`), `extension:`.
  Anything a path alone can't answer (`language:`, `in:file`, …) is reported back in
  `ignoredQualifiers` rather than silently dropped, and a query made only of those returns nothing
  rather than the entire repo.

### Optional `repo` parameter (Git #3580, Feature #3378: Multi-Repo Support)

Every repo-scoped tool listed above now takes an optional `repo` argument, `"owner/repo"` shape.
Omitted (or empty) resolves to the server's configured default — `GITHUB_MCP_REPO`, currently
`shanemccaw/Shane-McCaw-MSP` — so every existing call keeps working unchanged. A malformed `repo`
is rejected (`"repo" must be "owner/repo", got: ...`) before any GitHub call is made.

**Real verification (2026-09-10):** `get_issue({ number: 3580 })` with no `repo` returned
`shanemccaw/Shane-McCaw-MSP#3580` unchanged (backward compat confirmed); `get_issue({ number: 1,
repo: "octocat/Hello-World" })` returned that genuinely different public repo's real issue #1 —
the connector's classic `GITHUB_MCP_PAT` (`repo` scope) isn't restricted to one repo, so a `repo`
argument pointed at any repo the token's account can read/write actually works today, no PAT
change needed. A malformed `repo` string was rejected pre-flight with the real
`"repo" must be "owner/repo", got: ...` error, before any GitHub call fired.

### Required `context` on every write tool (Git #3538)

Every write through `shanes-git` authenticates as the same server-side PAT, so on GitHub it
always shows as authored by `shanemccaw` regardless of which chat/session made the change —
there was previously no way to trace which session did what. Every write tool —
`create_issue`, `update_issue`, `add_sub_issue`, `remove_sub_issue`, `set_blocked_by`,
`post_comment`, `close_issue`, `move_to_status`, `batch_reparent_sub_issues`,
`batch_move_to_status`, `batch_close_issues` (Git #3709) — **requires** a `context` string
argument. A missing or empty `context` is rejected before any GitHub API call fires.

- Free text, no fixed vocabulary — describe it as "a build id, a chat/session label, or an
  Epic/issue number." A BuildConsole-dispatched build has a real numeric buildId (e.g.
  `"build-2211"`); a raw interactive chat has no such id and isn't forced into a shape that
  doesn't fit it.
- Recorded automatically in `get_recent_activity` (it's just another key in the tool's own
  `args`) — no extra plumbing needed.
- Also stamped visibly on GitHub itself for `post_comment` and `close_issue`'s NOT_PLANNED
  comment: both are prefixed with a visible `[chat: <context>]` tag, so the trail is readable
  directly on the issue, not only in the local audit log. `create_issue`/`update_issue`, the
  sub-issue/`blocked_by` tools, and `move_to_status` don't get a visible tag — an issue body
  isn't a comment and a board move has no text field to embed one into; for those, `context` is
  traceable only through `get_recent_activity`.

Read-only tools (`get_issue`, `search_issues`, `list_sub_issues`, `list_blocked_by`,
`list_comments`, `get_recent_activity`, `server_status`, `github_whoami`, `get_board_status`,
`list_board_column`, `get_file_contents`, `list_directory`, `search_code`) do not take `context` —
nothing to trace on a read.

### Connecting

```
claude mcp add --transport http shanes-git https://shanes-git.replit.app/mcp \
  --header "Authorization: Bearer ghmcp_<the minted token>"
```

Tokens are minted server-side (see `artifacts/github-mcp-server/README.md` → "Mint a token") and
shown once; only their SHA-256 is stored. Revocable at any time.
