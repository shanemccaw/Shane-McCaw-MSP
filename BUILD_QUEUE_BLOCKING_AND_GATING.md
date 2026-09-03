# How the Build Queue's Blocking and Human-Gating Actually Work

**Status: authoritative reference.** Any chat filing issues, setting `blocked_by`, or
moving work into Batter Up must read this first. This document exists because getting
this wrong has caused real incidents — see "Real incidents this document exists
because of" at the bottom before assuming a shortcut is safe.

---

## 1. The core rule, stated once, precisely

**A queued build never launches while any of its real `blocked_by` targets are still
open.** Not "probably won't." Not "shouldn't." The live claim logic checks GitHub
directly, every single time, before launching anything — never a cached or assumed
state.

**"Closed" means closed for a real reason** — either:
- The real GitHub issue is closed (`state: closed`), **or**
- A real `build-journal/{N}.md` bookend exists on `origin/main` with `Status: DONE`
  and a commit hash that passes both `git cat-file -t <sha>` (the object genuinely
  exists) and `git merge-base --is-ancestor <sha> origin/main` (it's genuinely merged)

A blocker is never satisfied by a local `bt_build_queue` row saying `done`, by an
agent's own claim, or by anything that hasn't been checked against the real repo.
This is why a chat/board-manager verifies before closing anything — see §5.

---

## 2. Where blocking actually lives — two real, separate places

### 2a. GitHub — the durable, authoritative record

Every real dependency is a native GitHub issue-dependency edge:

```
POST /repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by
Body: {"issue_id": <numeric id, NOT node_id>}
```

This is the ONLY real way to set a blocker. **A "Part of #N" or "blocked by #N" line
in an issue's prose is not a real blocker** — it's invisible to every real mechanism
described in this document. If it's not a real dependency edge, it does nothing.

### 2b. The local build queue (`bt_build_queue`) — the live dispatch mechanism

This Postgres table is what BuildConsole actually claims and launches builds from.
Relevant real columns: `status`, `blocked_by_number` (legacy, single), `blocked_by_numbers`
(current, array), `github_number`, `claimed_at`.

**These two are not automatically the same thing.** A real GitHub `blocked_by` edge
does not, by itself, populate `bt_build_queue.blocked_by_numbers` — that has to be set
explicitly when the row is queued (either by parsing the issue's real `BUILD:` comment,
or by whatever queues the row). This is why the standing `BUILD:` comment format exists
(§3) — it's the bridge between the two.

---

## 3. The `BUILD:` comment — how a blocker actually reaches the queue

Every real dispatch is a comment on the issue itself, never in the body:

```
BUILD: model=<model> effort=<effort> buildSet=<name>
Posted: <UTC ISO8601>

--model <model> --effort <effort> --title <issueNumber> --blocked-by <N>[,<N>...]

<real, specific task description>
```

`--blocked-by` is only appended when a **real GitHub dependency edge already exists**
(§2a) — it is not itself what creates the blocker, it's how the dispatch tells the
local queue what to also enforce. Wire the real edge first, then dispatch with the
matching `--blocked-by` flag.

---

## 4. The live claim check — what actually happens on every launch attempt

The claim path (`BuildQueuePostgresClient.GetNextAsync`, built on
`SelectClaimCandidatesAsync`) does this, every single tick, for every candidate row:

1. Collect every distinct blocker number declared across all queued candidates.
2. **Live-fetch their real current state from GitHub** — one batched call, not per-row,
   but always live, never from a local cache.
3. A candidate is only eligible to claim if **every one of its declared blockers is
   confirmed closed** by that live fetch.
4. **GitHub unreachable → hold, don't guess.** If the live fetch fails, every row with
   any declared blocker is held, full stop. A network hiccup must never be
   indistinguishable from "safe to launch."

This is why a build can sit in Batter Up looking "ready" and just... not launch. If it
has a real blocker still open, it is supposed to sit there. That's the mechanism
working, not a bug — check the blocker before assuming something's wrong.

---

## 5. Human gating — Backlog vs. Batter Up

Two board columns, two different meanings:

- **Batter Up** — approved to run automatically. It auto-launches on refresh, subject
  entirely to the real blocked_by check in §4. No further human action needed once
  it's here and its blockers are real and clear.
- **Backlog** — held. Requires an explicit human move to Batter Up. This is for
  anything genuinely not ready, or a **manual cutover point**: a transition that
  needs a real human confirmation, not just an automatic bookend check (e.g. "I want
  to personally confirm the new UI looks right before the next Feature starts").

**A manual gate is not expressed as a `blocked_by` edge on a phantom issue.** It's
expressed by literally leaving the gated work in Backlog until a human (Shane, or a
chat acting as board manager on his behalf) moves it. The real `blocked_by` edge
still gets wired if there's also a genuine technical dependency — the two are not
mutually exclusive, they answer different questions ("is it technically possible" vs.
"has a human said go").

---

## 6. Moving an entire build chain into Batter Up at once

This is the real, efficient pattern for a Feature with many sequentially-dependent
sub-issues, from BUILD_QUEUE_METHOD.md §5 — restated here because getting it wrong
either creates an `O(n·m)` edge explosion or silently drops real ordering.

1. **Pick a sentinel** for the chain — conventionally the highest-numbered/last-filed
   issue in the set. It's provably the last thing to clear.
2. **Fan-in**: wire the sentinel `blocked_by` every *other* issue in its own set. Now
   the sentinel can't claim until everything else in the set is real-closed.
3. **Cross-set gate** (if this chain must wait on a *different* Feature/chain
   finishing first): wire *every* issue in this chain `blocked_by` the previous
   chain's own sentinel. One edge per issue to the one sentinel — not a full mesh.
4. Move every real issue in the chain to Batter Up together. The blocked_by edges
   from steps 2-3 do the actual sequencing; nothing more is needed for them to run
   in the right order automatically as blockers clear.

This is exactly how, e.g., #2480→#2481→#2483 (Build Chain Map) and the
`ShaneBuilderQueueOrder`→per-Feature cascades earlier this session were sequenced —
real edges, not prose, not manual babysitting of launch order.

---

## 7. Verification before closing — why "closed by chat" matters

A board manager (a chat with GitHub access) never closes an issue on a bare "landed"
claim. Every closure in this repo follows:

1. `git fetch --unshallow` (or a full clone) — a shallow clone has caused real commits
   to be reported missing.
2. `git show origin/main:build-journal/{N}.md` — confirm both `IN FLIGHT` and `DONE`
   are present, and note the cited commit hash.
3. `git cat-file -t <sha>` — confirm the cited commit hash is a real object. (Real
   incident: agents have cited phantom hashes that don't exist — see §9.)
4. `git merge-base --is-ancestor <sha> origin/main` — confirm it's genuinely merged,
   not just committed to a branch that never landed.
5. `git status --porcelain` clean.
6. Only then: close via GraphQL `closeIssue` with a real `stateReason` (`COMPLETED` or
   `NOT_PLANNED` — `NOT_PLANNED` always carries a real explanatory comment). REST
   `PATCH` cannot set `stateReason` — don't use it for closing.

**This is what makes a GitHub-closed state trustworthy enough for §1's rule to rely
on.** A blocker check in §4 trusts "closed" precisely because closure only happens
after this real verification — never on an agent's own unverified self-report, never
on a local queue row's `done` status alone.

---

## 8. Common mistakes, stated directly

- **Writing "blocked by #N" in prose instead of a real dependency edge.** Invisible to
  everything in this document. Use the real API call (§2a).
- **Setting `--blocked-by` without a real GitHub edge behind it.** The flag is a
  bridge, not a source — wire the real edge first.
- **Treating a local `bt_build_queue` row's `done` status as proof the blocker is
  satisfied.** It isn't, ever. Only a real GitHub-closed state or a real verified
  bookend counts (§1, §7).
- **Assuming an empty/typo'd blocking-set name means "nothing to wait on, go ahead."**
  The opposite is required — a blocking-set that resolves to zero real members must
  hold, not release. (This exact failure mode is why #1600 was a real incident — see
  below.)
- **Building a full mesh of edges for a chain** instead of the sentinel fan-in pattern
  (§6) — wastes API calls and makes the real dependency graph unreadable.
- **Re-parenting or closing an issue without checking its real current `blocked_by`
  edges first** — a detach/reparent pass can silently orphan a real dependency if it's
  not checked.

---

## 9. Real incidents this document exists because of

- **#1600** — the original claim-logic failure. A build (#1483) started while its
  declared blocker was still genuinely open; a separate incident (#943) lost live
  builds to the same class of bug. This is why §4's live-fetch-every-time,
  fail-closed-on-unreachable behavior is non-negotiable, not a nice-to-have.
- **#2073 / the phantom-hash bug** — bookends have cited a commit hash that doesn't
  exist as a real git object at all, more than once. This is why §7 step 3
  (`git cat-file -t`) is a separate, mandatory check, not assumed redundant with
  step 4.
- **#2225** — `blocked_by` was, for a real stretch of time, treated as satisfied
  purely by GitHub `state: closed`, with no fallback for a real merged-and-DONE build
  whose GitHub close hadn't propagated yet (or vice versa). Fixed to the real
  either/or rule stated in §1.
- **The `ShaneBuilderQueueOrder` shared-tag confusion** — a whole cascade of real,
  independent Features got dispatched under one blanket `buildSet` tag instead of
  each getting its own, making it genuinely hard to tell what was actually queued for
  what. Not a blocking-logic bug specifically, but the same discipline this document
  asks for — real, specific tags and edges, not a shared catch-all standing in for
  precision.

If you're about to do something this document doesn't cover and you're not sure it's
safe, the default is: **fail closed.** Leave it in Backlog, ask, or hold — never
release a build on an assumption that hasn't been checked against the real repo.
