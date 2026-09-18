using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2225 — the real answer to "is it SAFE to build on top of blocker issue #N yet?",
    /// decoupled from the slower, deliberately-human step of formally closing that issue on
    /// GitHub. Shane: "I can't queue up a big feature and go to bed" — a dependency chain used
    /// to stall overnight because every link needed a human to CLOSE the prior issue before the
    /// next build could even start, even though the prior work had genuinely landed on main.
    ///
    /// This verifies the ONE thing that actually makes a blocker safe to build on: a real
    /// <c>build-journal/{N}.md</c> bookend on <c>origin/main</c> whose status is DONE and whose
    /// cited commit hash passes the exact same two git checks chat runs by hand for every real
    /// bookend verification:
    ///   1. <c>git cat-file -t &lt;sha&gt;</c> resolves to a real <c>commit</c> object, AND
    ///   2. <c>git merge-base --is-ancestor &lt;sha&gt; origin/main</c> (exit 0) — the commit is
    ///      genuinely an ancestor of the branch a dependent build will be provisioned from.
    ///
    /// A false POSITIVE here (releasing a dependent onto work that is not actually on main) is
    /// strictly worse than the current over-conservative behaviour, so every check fails CLOSED:
    /// an unresolvable repo root, a missing bookend, a non-DONE status, a hash that is not a real
    /// object, a hash that is not an ancestor, or any subprocess error all yield "not satisfied".
    /// Only both git checks passing against a genuine DONE bookend returns true.
    ///
    /// This is a display/dispatch SIGNAL, not a replacement for the GitHub open/closed state —
    /// callers still show the real open/closed badge (see <see cref="BatterUpRow.OpenBlockedByNumbers"/>).
    /// The live <c>#1600</c> launch gate (<see cref="BuildQueuePostgresClient"/>.SelectClaimCandidatesAsync)
    /// treats a blocker as satisfied on EITHER GitHub-closed OR a verified DONE bookend — whichever
    /// comes first — so a queue can drain a whole dependency chain unattended.
    ///
    /// Git #4681 — WHERE the bookend is read from is now multi-repo aware. It used to be the one
    /// checkout <see cref="BuildTrackerConfig.FindRepoRoot"/> returns, so a build tracked by an issue
    /// here whose code and bookend live in another configured repo (M365Architect) always read "no
    /// bookend". Every entry point takes an optional <c>ownerRepo</c> — the queue row's own tracking repo
    /// (<c>bt_build_queue.repo_owner/repo_name</c>, #3579; omitted = this instance's own repo). The
    /// bookend is read from that repo's own local checkout first; if it isn't there, the other configured
    /// repos (#3581) are probed (see <see cref="BookendSourceResolver"/>): exactly one hit is used — and
    /// its commit is verified in THAT repo, against THAT repo's branch — while several hits are ambiguous
    /// and fail closed like every other uncertainty here.
    /// </summary>
    public static class DoneBookendVerifier
    {
        // Per-(tracking repo, issue) verified result, short-TTL cached so a watcher tick / panel refresh
        // that evaluates the same blocker many times doesn't re-shell git each time. A DONE bookend never
        // un-DONEs, so caching a positive is safe; a negative is re-checked after the TTL (the
        // bookend/commit may land at any moment) — that's the whole point of a short TTL. Keyed on the
        // tracking repo too (Git #4681): two repos can each have an issue with the same number.
        private static readonly Dictionary<(string Repo, int Number), (bool Satisfied, DateTime AtUtc)> _cache = new();
        private static readonly object _cacheLock = new();
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        // Git #4681 — per checkout+ref listing of which build-journal/{N}.md files exist (see GetJournalIndexAsync).
        private static readonly Dictionary<string, (HashSet<int>? Numbers, DateTime AtUtc)> _journalIndexCache = new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _journalIndexLock = new();
        private static readonly Regex JournalFileRx = new(@"^build-journal/(\d+)\.md$", RegexOptions.Compiled);

        // Git #2685 — separate short-TTL cache for the BLOCKED reconciliation read (see
        // GetBlockedAsync). Kept apart from the DONE cache above because the two answer opposite
        // questions and fail in opposite directions (DONE fails closed to "not satisfied"; BLOCKED
        // fails closed to "not blocked" so a genuine done row is never wrongly cancelled). A bookend
        // can flip BLOCKED→DONE at any time, so a negative is re-read after the TTL just like above.
        private static readonly Dictionary<(string Repo, int Number), (bool Blocked, DateTime AtUtc)> _blockedCache = new();
        private static readonly object _blockedCacheLock = new();

        // origin/main freshness: a completed blocker build pushes its bookend to origin from its
        // own worktree, so THIS repo's remote-tracking ref can lag. We refresh it (a single-ref,
        // cheap fetch) at most once per cooldown, and ONLY when something is actually waiting on a
        // blocker — never on an idle tick. On a metered connection this is the minimum download
        // required to decide safety, and it fires only when a build is genuinely held.
        // Git #4681 — tracked per checkout now (each configured repo has its own remote-tracking ref).
        private static readonly Dictionary<string, DateTime> _lastFetchUtcByRoot = new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _fetchLock = new();
        private static readonly TimeSpan FetchCooldown = TimeSpan.FromSeconds(45);
        // Git #4681 — a secondary repo is only ever fetched when the tracking repo did NOT hold the
        // bookend (a still-open blocker with no bookend yet is the normal "waiting" state, so this
        // fires on every held tick), and a push from an agent's worktree of that clone already advances
        // its origin ref. A longer cooldown keeps that from becoming a steady metered-network cost.
        private static readonly TimeSpan SecondaryFetchCooldown = TimeSpan.FromMinutes(5);

        // Git #3516 — the README template is bold `**Status:**`/`**Commit(s):**`, but real
        // sessions routinely write a plain, non-bold `Status:` line, or a singular `Commit:`
        // instead of `Commit(s):` (confirmed live on origin/main: build-journal/3457.md,
        // 3470.md, 3475.md all use plain `Status:`/`Commit:`). Both regexes now accept the
        // bold and plain forms. Anchored to the start of a line (ignoring leading whitespace
        // and an optional `- `/`* ` list marker) via RegexOptions.Multiline so a plain-text
        // field label is still distinguished from the same word appearing mid-sentence in
        // prose elsewhere in the bookend — the field-label position at line start is what
        // makes the plain form safe to match. Do NOT loosen the ancestor-commit verification
        // below; only these two field-detection regexes are widened.
        private static readonly Regex StatusFieldRx =
            new(@"^\s*(?:[-*]\s+)?\*{0,2}Status:\*{0,2}\s*(.+)",
                RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.Multiline);
        private static readonly Regex CommitFieldRx =
            new(@"^\s*(?:[-*]\s+)?\*{0,2}Commit(?:s|\(s\))?:\*{0,2}\s*(.+)",
                RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.Multiline);
        // A git object name: 7–40 lowercase hex chars, on a word boundary. git resolves an
        // abbreviated name; a non-existent one is simply rejected by cat-file (fail closed).
        private static readonly Regex HashRx =
            new(@"\b[0-9a-f]{7,40}\b", RegexOptions.Compiled);

        /// <summary>A bookend's text together with the checkout it was actually read from.</summary>
        private sealed record LocatedBookend(BookendSource Source, string Content);

        /// <summary>
        /// Git #4681 — one verifier call's fixed inputs: the tracking repo and its checkout, plus the OTHER
        /// configured repos' checkouts, resolved lazily and AT MOST ONCE per call. Shape A feeds this
        /// class every done/verifying row (thousands of issue numbers) in a single pass, so per-number
        /// re-resolution (a settings read + a cache lookup per repo per number) is real, measured cost.
        /// </summary>
        private sealed class LookupContext
        {
            private Task<List<BookendSource>>? _others;
            public LookupContext(string trackingRepo, BookendSource tracking) { TrackingRepo = trackingRepo; Tracking = tracking; }
            public string TrackingRepo { get; }
            public BookendSource Tracking { get; }

            public Task<List<BookendSource>> OthersAsync() => _others ??= ResolveOthersAsync();

            private async Task<List<BookendSource>> ResolveOthersAsync()
            {
                var others = new List<BookendSource>();
                foreach (var repo in BookendSourceResolver.ConfiguredOwnerRepos())
                {
                    if (BookendSourceResolver.IsSameRepo(repo, TrackingRepo)) continue; // asked first, separately
                    var source = await BookendSourceResolver.ResolveAsync(repo);
                    if (source != null) others.Add(source); // no local checkout: logged once per miss window by the resolver
                }
                return others;
            }
        }

        /// <summary>
        /// The subset of <paramref name="issueNumbers"/> that are satisfied by a real, git-verified
        /// DONE bookend on <c>origin/main</c> (see the class summary for the exact contract). Refreshes
        /// the local <c>origin/main</c> ref once (rate-limited) before checking, so a just-pushed bookend
        /// is seen. Returns an empty set on any failure — never throws into the caller's gate.
        /// </summary>
        /// <param name="ownerRepo">Git #4681 — the tracking repo of these issue numbers (a queue row's
        /// <c>repo_owner/repo_name</c>); omitted/blank = this instance's own repo.</param>
        public static async Task<HashSet<int>> GetSatisfiedAsync(IEnumerable<int> issueNumbers, string? ownerRepo = null)
        {
            var wanted = issueNumbers?.Where(n => n > 0).Distinct().ToList() ?? new List<int>();
            var satisfied = new HashSet<int>();
            if (wanted.Count == 0) return satisfied;

            var trackingRepo = TrackingRepoOrPrimary(ownerRepo);
            var tracking = await BookendSourceResolver.ResolveAsync(trackingRepo);
            if (tracking == null)
            {
                // Fail closed, exactly as an unresolvable repo root always has: without the tracking repo's
                // own checkout we can't tell whether IT holds the bookend, and a same-numbered bookend in
                // another repo may belong to an unrelated issue — so no other repo is consulted either.
                ActivityLog.Log("watcher", $"Git #2225: repo root for \"{trackingRepo}\" unresolved — cannot verify DONE bookends this pass (fail closed, all blockers treated as unsatisfied).");
                return satisfied;
            }

            await EnsureFreshAsync(tracking, FetchCooldown);

            var ctx = new LookupContext(trackingRepo, tracking);
            foreach (var n in wanted)
            {
                if (await IsSatisfiedInternalAsync(n, ctx))
                    satisfied.Add(n);
            }
            return satisfied;
        }

        /// <summary>Convenience single-issue form of <see cref="GetSatisfiedAsync"/>.</summary>
        public static async Task<bool> IsSatisfiedAsync(int issueNumber, string? ownerRepo = null)
        {
            if (issueNumber <= 0) return false;
            var set = await GetSatisfiedAsync(new[] { issueNumber }, ownerRepo);
            return set.Contains(issueNumber);
        }

        /// <summary>
        /// Git #2685 — the subset of <paramref name="issueNumbers"/> whose real
        /// <c>origin/main:build-journal/{N}.md</c> bookend's EFFECTIVE (last) <c>**Status:**</c>
        /// field contains <c>BLOCKED</c> (a self-blocked session that wrote a real 🛑 BLOCKED
        /// bookend and exited cleanly). This is the authoritative signal used by the false-done
        /// reconciliation pass (<see cref="Services.FalseDoneReconciler"/>) to tell a genuinely-done
        /// queue row apart from one the watcher marked <c>done</c> only because the process exited 0.
        ///
        /// Reuses this class's exact git machinery (the same <c>git show origin/main:…</c> read, the
        /// same rate-limited origin/main refresh, the same <see cref="StatusFieldRx"/>). It
        /// deliberately fails CLOSED to "NOT blocked" on any uncertainty — an unresolvable repo root,
        /// a missing bookend, a git error, or a bookend whose effective status is anything other than
        /// BLOCKED — because the caller CANCELS a done row on a positive, and wrongly cancelling a
        /// genuinely-done row is the strictly-worse error. Returns an empty set on any failure.
        ///
        /// Git #4681 — the bookend is read from <paramref name="ownerRepo"/>'s own checkout first (the
        /// queue row's tracking repo; omitted = this instance's own repo), then discovered in the other
        /// configured repos, so a BLOCKED bookend that lives in M365Architect is finally visible.
        /// </summary>
        public static async Task<HashSet<int>> GetBlockedAsync(IEnumerable<int> issueNumbers, string? ownerRepo = null)
        {
            var wanted = issueNumbers?.Where(n => n > 0).Distinct().ToList() ?? new List<int>();
            var blocked = new HashSet<int>();
            if (wanted.Count == 0) return blocked;

            var trackingRepo = TrackingRepoOrPrimary(ownerRepo);
            var tracking = await BookendSourceResolver.ResolveAsync(trackingRepo);
            if (tracking == null)
            {
                ActivityLog.Log("batter-up", $"Git #2685: repo root for \"{trackingRepo}\" unresolved — cannot reconcile false-done rows against bookends this pass (fail closed, no row is treated as BLOCKED).");
                return blocked;
            }

            await EnsureFreshAsync(tracking, FetchCooldown);

            var ctx = new LookupContext(trackingRepo, tracking);
            foreach (var n in wanted)
            {
                if (await IsBlockedInternalAsync(n, ctx))
                    blocked.Add(n);
            }
            return blocked;
        }

        private static string TrackingRepoOrPrimary(string? ownerRepo) =>
            string.IsNullOrWhiteSpace(ownerRepo) ? BookendSourceResolver.PrimaryOwnerRepo : ownerRepo.Trim();

        private static async Task<bool> IsBlockedInternalAsync(int issueNumber, LookupContext ctx)
        {
            var key = (ctx.TrackingRepo.ToLowerInvariant(), issueNumber);
            lock (_blockedCacheLock)
            {
                if (_blockedCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.AtUtc < CacheTtl)
                    return hit.Blocked;
            }

            bool blocked = await VerifyBlockedAsync(issueNumber, ctx);

            lock (_blockedCacheLock)
            {
                _blockedCache[key] = (blocked, DateTime.UtcNow);
            }
            return blocked;
        }

        private static async Task<bool> VerifyBlockedAsync(int issueNumber, LookupContext ctx)
        {
            // The bookend must exist on origin/main of the repo that holds it. No bookend → we cannot
            // prove the done row is wrong, so leave it done (fail closed to "not blocked").
            var located = await LocateBookendAsync(issueNumber, ctx);
            if (located == null) return false;

            // Use the EFFECTIVE status — the LAST **Status:** line — not the first. A self-blocked
            // bookend commonly reads "IN FLIGHT" then "BLOCKED" as two separate status lines (real
            // example #2385), and a row that went BLOCKED then genuinely resolved to DONE would read
            // "…BLOCKED" then "…DONE"; the final line is the true current state in both cases. Taking
            // the last match means a resolved-to-DONE row is never wrongly cancelled.
            Match? last = null;
            foreach (Match m in StatusFieldRx.Matches(located.Content))
                last = m;
            if (last == null) return false;

            var statusValue = last.Groups[1].Value;
            // A genuinely-done bookend's effective status is DONE and never contains BLOCKED, so a
            // plain contains-BLOCKED on the effective status value is exact here. This intentionally
            // also catches MERGE-BLOCKED (work committed but not merged) — that is likewise a
            // not-actually-done row that must not stay dedup-locked as "done".
            bool blocked = statusValue.IndexOf("BLOCKED", StringComparison.OrdinalIgnoreCase) >= 0;
            if (blocked && !located.Source.IsPrimary)
                ActivityLog.Log("batter-up", $"Git #4681: #{issueNumber}'s BLOCKED bookend was read from \"{located.Source.OwnerRepo}\" (a repo other than this instance's own).");
            return blocked;
        }

        private static async Task<bool> IsSatisfiedInternalAsync(int issueNumber, LookupContext ctx)
        {
            var key = (ctx.TrackingRepo.ToLowerInvariant(), issueNumber);
            lock (_cacheLock)
            {
                if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.AtUtc < CacheTtl)
                    return hit.Satisfied;
            }

            bool satisfied = await VerifyAsync(issueNumber, ctx);

            lock (_cacheLock)
            {
                _cache[key] = (satisfied, DateTime.UtcNow);
            }
            return satisfied;
        }

        private static async Task<bool> VerifyAsync(int issueNumber, LookupContext ctx)
        {
            // 1. The bookend must exist on origin/main of the repo that holds it. `git show` exits
            //    non-zero if the path is absent at that ref — that alone means "no verified DONE
            //    bookend" (fail closed).
            var located = await LocateBookendAsync(issueNumber, ctx);
            if (located == null) return false;

            var content = located.Content;
            var source = located.Source;

            // 2. The top-level Status field must be DONE. Every other bookend status
            //    (IN FLIGHT, BLOCKED, MERGE-BLOCKED, superseded) lacks the substring "DONE",
            //    so a plain contains-DONE on the Status field value is exact here.
            var statusMatch = StatusFieldRx.Match(content);
            if (!statusMatch.Success) return false;
            var statusValue = statusMatch.Groups[1].Value;
            if (statusValue.IndexOf("DONE", StringComparison.OrdinalIgnoreCase) < 0)
                return false;

            // 3. Gather candidate commit hashes — the **Commit(s):** field first (the designated
            //    place for the real work hash), falling back to the whole file if that field is
            //    absent/empty. A hash counts only if it is a real commit object AND an ancestor of
            //    origin/main; the moment one candidate passes both, the blocker is satisfied.
            //    Git #4681 — both checks run in the checkout the bookend was read FROM, against that
            //    repo's own base ref: a commit cited by an M365Architect bookend is an M365Architect
            //    commit, and does not exist in (nor descend from) this repo's history.
            var hashes = new List<string>();
            foreach (Match m in CommitFieldRx.Matches(content))
                hashes.AddRange(HashRx.Matches(m.Groups[1].Value).Select(h => h.Value));
            if (hashes.Count == 0)
                hashes.AddRange(HashRx.Matches(content).Select(h => h.Value));

            foreach (var sha in hashes.Distinct())
            {
                // git cat-file -t <sha> — must resolve to a real COMMIT object (not a tree/blob,
                // not an unknown name).
                var type = await RunGitAsync(source.RepoRoot, "cat-file", "-t", sha);
                if (type.ExitCode != 0 || !string.Equals(type.StdOut.Trim(), "commit", StringComparison.Ordinal))
                    continue;

                // git merge-base --is-ancestor <sha> origin/main — exit 0 iff <sha> is genuinely
                // an ancestor of origin/main (the work is really on the branch a dependent builds on).
                var anc = await RunGitAsync(source.RepoRoot, "merge-base", "--is-ancestor", sha, source.BaseRef);
                if (anc.ExitCode == 0)
                {
                    ActivityLog.Log("watcher",
                        $"Git #2225: blocker #{issueNumber} satisfied by verified DONE bookend" +
                        (source.IsPrimary ? "" : $" (read from \"{source.OwnerRepo}\")") +
                        $" — commit {sha} is a real object and an ancestor of {source.BaseRef}.");
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Git #4681 — find issue <paramref name="issueNumber"/>'s bookend. The tracking repo's own
        /// checkout is asked first (byte-for-byte the pre-#4681 read for this instance's own repo, and
        /// authoritative: a bookend the tracking repo holds is never overridden). Only if it holds none
        /// are the other configured repos probed; exactly one hit is returned, several are ambiguous
        /// (the same number can be an unrelated issue in another repo) and yield null — fail closed.
        /// </summary>
        private static async Task<LocatedBookend?> LocateBookendAsync(int issueNumber, LookupContext ctx)
        {
            var trackingContent = await ShowBookendAsync(ctx.Tracking, issueNumber);
            if (trackingContent != null) return new LocatedBookend(ctx.Tracking, trackingContent);

            var hits = new List<LocatedBookend>();
            foreach (var source in await ctx.OthersAsync())
            {
                await EnsureFreshAsync(source, source.IsPrimary ? FetchCooldown : SecondaryFetchCooldown);

                // One cached directory listing per repo instead of a git show per number: most numbers
                // have no bookend in a given repo, and probing each one cost +49% on the (measured) cold
                // Shape A pass over ~2,800 rows. Only a number the listing contains is actually read.
                var index = await GetJournalIndexAsync(source);
                if (index == null || !index.Contains(issueNumber)) continue;

                var content = await ShowBookendAsync(source, issueNumber);
                if (content != null) hits.Add(new LocatedBookend(source, content));
            }

            if (hits.Count == 1) return hits[0];
            if (hits.Count > 1)
                ActivityLog.Log("watcher",
                    $"Git #4681: bookend build-journal/{issueNumber}.md exists in several configured repos ({string.Join(", ", hits.Select(h => h.Source.OwnerRepo))}) and not in the tracking repo \"{ctx.TrackingRepo}\" — ambiguous, treating it as no bookend (fail closed).");
            return null;
        }

        /// <summary>
        /// Git #4681 — the issue numbers that have a <c>build-journal/{N}.md</c> at <paramref name="source"/>'s
        /// base ref, from ONE <c>git ls-tree</c>, cached for <see cref="CacheTtl"/> per checkout+ref. Null on
        /// any git failure (the caller treats an unknown listing as "no bookend here" — fail closed).
        /// </summary>
        private static async Task<HashSet<int>?> GetJournalIndexAsync(BookendSource source)
        {
            var key = $"{source.RepoRoot}|{source.BaseRef}";
            lock (_journalIndexLock)
            {
                if (_journalIndexCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.AtUtc < CacheTtl)
                    return hit.Numbers;
            }

            var ls = await RunGitAsync(source.RepoRoot, "ls-tree", "--name-only", source.BaseRef, "build-journal/");
            HashSet<int>? numbers = null;
            if (ls.ExitCode == 0)
            {
                numbers = new HashSet<int>();
                foreach (var line in ls.StdOut.Split('\n'))
                {
                    var m = JournalFileRx.Match(line.Trim());
                    if (m.Success && int.TryParse(m.Groups[1].Value, out var n)) numbers.Add(n);
                }
            }

            lock (_journalIndexLock) { _journalIndexCache[key] = (numbers, DateTime.UtcNow); }
            return numbers;
        }

        private static async Task<string?> ShowBookendAsync(BookendSource source, int issueNumber)
        {
            var show = await RunGitAsync(source.RepoRoot, "show", $"{source.BaseRef}:build-journal/{issueNumber}.md");
            return show.ExitCode != 0 || string.IsNullOrWhiteSpace(show.StdOut) ? null : show.StdOut;
        }

        /// <summary>
        /// Refreshes <paramref name="source"/>'s remote-tracking base ref, rate-limited to at most once
        /// per <paramref name="cooldown"/> PER CHECKOUT. Uses an explicit refspec so the tracking ref is
        /// updated regardless of the remote's configured fetch refspec. Any failure is swallowed and
        /// logged — a stale ref only ever causes a false NEGATIVE (holding a build longer than strictly
        /// needed), which is the safe direction; it can never cause a false positive.
        /// </summary>
        private static async Task EnsureFreshAsync(BookendSource source, TimeSpan cooldown)
        {
            lock (_fetchLock)
            {
                if (_lastFetchUtcByRoot.TryGetValue(source.RepoRoot, out var last) && DateTime.UtcNow - last < cooldown) return;
                _lastFetchUtcByRoot[source.RepoRoot] = DateTime.UtcNow; // reserve the window before the await, so ticks don't stack fetches
            }

            // Git #2225's own single-ref fetch on a possibly-metered connection — give it a longer
            // timeout than the local object checks below.
            var branch = source.BranchName;
            var fetch = await RunGitAsync(source.RepoRoot, TimeSpan.FromSeconds(60), "fetch", "--no-tags", "origin", $"+refs/heads/{branch}:refs/remotes/origin/{branch}");
            if (fetch.ExitCode != 0)
                ActivityLog.Log("watcher", $"Git #2225: {source.BaseRef} refresh failed for \"{source.OwnerRepo}\" ({fetch.StdErr.Trim()}) — verifying against the last-known ref (safe: only risks holding a build longer, never releasing one early).");
        }

        internal readonly record struct GitResult(int ExitCode, string StdOut, string StdErr);

        internal static Task<GitResult> RunGitAsync(string repoRoot, params string[] args)
            => RunGitAsync(repoRoot, TimeSpan.FromSeconds(30), args);

        /// <summary>
        /// Git #2539 — was an ad-hoc <see cref="Process"/> spawn. Now routed through
        /// <see cref="SubprocessRunner"/>, which retries a crash-class exit (the real ancient-git
        /// <c>0x40000015</c> crash class this dependency-gate shells into 2-3× per blocked queue
        /// item on every startup evaluation) with backoff before giving up, and staggers the burst
        /// through the shared concurrency gate. The mapping preserves this class's fail-closed
        /// contract exactly: a launch failure OR a crash that exhausted its retries both come back
        /// as a non-zero <see cref="GitResult.ExitCode"/>, which every caller treats as "not
        /// satisfied" — so a transient crash now gets three real tries instead of instantly
        /// holding a dependent build.
        /// </summary>
        internal static async Task<GitResult> RunGitAsync(string repoRoot, TimeSpan timeout, params string[] args)
        {
            var res = await SubprocessRunner.RunAsync("git", args, repoRoot, timeout, "watcher").ConfigureAwait(false);
            if (!res.Started)
            {
                ActivityLog.Log("watcher", $"Git #2225: couldn't run git ({res.LaunchError}) — treating check as unsatisfied (fail closed).");
                return new GitResult(-1, res.StdOut, res.LaunchError ?? res.StdErr);
            }
            return new GitResult(res.ExitCode, res.StdOut, res.StdErr);
        }
    }
}
