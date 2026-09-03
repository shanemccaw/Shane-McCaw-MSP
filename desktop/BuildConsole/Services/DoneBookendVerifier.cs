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
    /// </summary>
    public static class DoneBookendVerifier
    {
        // Per-issue verified result, short-TTL cached so a watcher tick / panel refresh that
        // evaluates the same blocker many times doesn't re-shell git each time. A DONE bookend
        // never un-DONEs, so caching a positive is safe; a negative is re-checked after the TTL
        // (the bookend/commit may land at any moment) — that's the whole point of a short TTL.
        private static readonly Dictionary<int, (bool Satisfied, DateTime AtUtc)> _cache = new();
        private static readonly object _cacheLock = new();
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        // origin/main freshness: a completed blocker build pushes its bookend to origin from its
        // own worktree, so THIS repo's remote-tracking ref can lag. We refresh it (a single-ref,
        // cheap fetch) at most once per cooldown, and ONLY when something is actually waiting on a
        // blocker — never on an idle tick. On a metered connection this is the minimum download
        // required to decide safety, and it fires only when a build is genuinely held.
        private static DateTime _lastFetchUtc = DateTime.MinValue;
        private static readonly object _fetchLock = new();
        private static readonly TimeSpan FetchCooldown = TimeSpan.FromSeconds(45);

        private static readonly Regex StatusFieldRx =
            new(@"\*\*Status:\*\*\s*(.+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex CommitFieldRx =
            new(@"\*\*Commit\(s\):\*\*\s*(.+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        // A git object name: 7–40 lowercase hex chars, on a word boundary. git resolves an
        // abbreviated name; a non-existent one is simply rejected by cat-file (fail closed).
        private static readonly Regex HashRx =
            new(@"\b[0-9a-f]{7,40}\b", RegexOptions.Compiled);

        /// <summary>
        /// The subset of <paramref name="issueNumbers"/> that are satisfied by a real, git-verified
        /// DONE bookend on <c>origin/main</c> (see the class summary for the exact contract). Refreshes
        /// the local <c>origin/main</c> ref once (rate-limited) before checking, so a just-pushed bookend
        /// is seen. Returns an empty set on any failure — never throws into the caller's gate.
        /// </summary>
        public static async Task<HashSet<int>> GetSatisfiedAsync(IEnumerable<int> issueNumbers)
        {
            var wanted = issueNumbers?.Where(n => n > 0).Distinct().ToList() ?? new List<int>();
            var satisfied = new HashSet<int>();
            if (wanted.Count == 0) return satisfied;

            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (string.IsNullOrEmpty(repoRoot))
            {
                ActivityLog.Log("watcher", "Git #2225: repo root unresolved — cannot verify DONE bookends this pass (fail closed, all blockers treated as unsatisfied).");
                return satisfied;
            }

            await EnsureOriginMainFreshAsync(repoRoot);

            foreach (var n in wanted)
            {
                if (await IsSatisfiedInternalAsync(n, repoRoot))
                    satisfied.Add(n);
            }
            return satisfied;
        }

        /// <summary>Convenience single-issue form of <see cref="GetSatisfiedAsync"/>.</summary>
        public static async Task<bool> IsSatisfiedAsync(int issueNumber)
        {
            if (issueNumber <= 0) return false;
            var set = await GetSatisfiedAsync(new[] { issueNumber });
            return set.Contains(issueNumber);
        }

        private static async Task<bool> IsSatisfiedInternalAsync(int issueNumber, string repoRoot)
        {
            lock (_cacheLock)
            {
                if (_cache.TryGetValue(issueNumber, out var hit) && DateTime.UtcNow - hit.AtUtc < CacheTtl)
                    return hit.Satisfied;
            }

            bool satisfied = await VerifyAsync(issueNumber, repoRoot);

            lock (_cacheLock)
            {
                _cache[issueNumber] = (satisfied, DateTime.UtcNow);
            }
            return satisfied;
        }

        private static async Task<bool> VerifyAsync(int issueNumber, string repoRoot)
        {
            // 1. The bookend must exist on origin/main. `git show` exits non-zero if the path is
            //    absent at that ref — that alone means "no verified DONE bookend" (fail closed).
            var show = await RunGitAsync(repoRoot, "show", $"origin/main:build-journal/{issueNumber}.md");
            if (show.ExitCode != 0 || string.IsNullOrWhiteSpace(show.StdOut))
                return false;

            var content = show.StdOut;

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
            var hashes = new List<string>();
            foreach (Match m in CommitFieldRx.Matches(content))
                hashes.AddRange(HashRx.Matches(m.Groups[1].Value).Select(h => h.Value));
            if (hashes.Count == 0)
                hashes.AddRange(HashRx.Matches(content).Select(h => h.Value));

            foreach (var sha in hashes.Distinct())
            {
                // git cat-file -t <sha> — must resolve to a real COMMIT object (not a tree/blob,
                // not an unknown name).
                var type = await RunGitAsync(repoRoot, "cat-file", "-t", sha);
                if (type.ExitCode != 0 || !string.Equals(type.StdOut.Trim(), "commit", StringComparison.Ordinal))
                    continue;

                // git merge-base --is-ancestor <sha> origin/main — exit 0 iff <sha> is genuinely
                // an ancestor of origin/main (the work is really on the branch a dependent builds on).
                var anc = await RunGitAsync(repoRoot, "merge-base", "--is-ancestor", sha, "origin/main");
                if (anc.ExitCode == 0)
                {
                    ActivityLog.Log("watcher",
                        $"Git #2225: blocker #{issueNumber} satisfied by verified DONE bookend — commit {sha} is a real object and an ancestor of origin/main.");
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Refreshes THIS repo's <c>origin/main</c> remote-tracking ref, rate-limited to at most once
        /// per <see cref="FetchCooldown"/>. Uses an explicit refspec so the tracking ref is updated
        /// regardless of the remote's configured fetch refspec. Any failure is swallowed and logged —
        /// a stale ref only ever causes a false NEGATIVE (holding a build longer than strictly needed),
        /// which is the safe direction; it can never cause a false positive.
        /// </summary>
        private static async Task EnsureOriginMainFreshAsync(string repoRoot)
        {
            lock (_fetchLock)
            {
                if (DateTime.UtcNow - _lastFetchUtc < FetchCooldown) return;
                _lastFetchUtc = DateTime.UtcNow; // reserve the window before the await, so ticks don't stack fetches
            }

            // Git #2225's own single-ref fetch on a possibly-metered connection — give it a longer
            // timeout than the local object checks below.
            var fetch = await RunGitAsync(repoRoot, TimeSpan.FromSeconds(60), "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main");
            if (fetch.ExitCode != 0)
                ActivityLog.Log("watcher", $"Git #2225: origin/main refresh failed ({fetch.StdErr.Trim()}) — verifying against the last-known ref (safe: only risks holding a build longer, never releasing one early).");
        }

        private readonly record struct GitResult(int ExitCode, string StdOut, string StdErr);

        private static Task<GitResult> RunGitAsync(string repoRoot, params string[] args)
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
        private static async Task<GitResult> RunGitAsync(string repoRoot, TimeSpan timeout, params string[] args)
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
