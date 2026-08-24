using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Local (--notGit) build identity + blocker resolution, shared by both queue entry
    /// points (the BT_EDIT_BUILD dialog path and the BT_QUEUE_BUILD chat-button path).
    ///
    /// This is the single place where the LETTER scheme meets the integer-keyed storage:
    ///   • a --notGit build is handed the next unused letter id and stored as a negative
    ///     github_number (its ordinal);
    ///   • --block-by letter references resolve through <see cref="NotGitNumberRegistry"/>;
    ///   • a bare number with NO --notGit is verified against the real GitHub API
    ///     (<see cref="GitHubIssueVerifier"/>) — if it isn't a real issue we STOP and flag,
    ///     rather than silently treating it as GitHub issue #N or silently making it local.
    ///
    /// Everything downstream (QueueBuildAsync, the watcher, blocker-clearing, dedupe) stays
    /// integer-keyed exactly as before — the letters live only at this input edge and at
    /// the display edge (<see cref="LocalBuildId.FormatRef"/>).
    /// </summary>
    public partial class MainWindow
    {
        /// <summary>
        /// Resolves a build's stored github_number and blocker list from the letter-aware
        /// inputs. Returns <c>stop=true</c> (after showing a warning) when a bare number
        /// fails GitHub verification — the caller must NOT queue in that case.
        /// </summary>
        private async Task<(int? githubNum, List<int>? blockers, bool stop)> ResolveLocalBuildIdentityAsync(
            bool localBuild,
            int? githubNumber,
            IReadOnlyList<string>? gitBlockers,
            IReadOnlyList<string>? localBlockers)
        {
            int? githubNum;

            if (localBuild)
            {
                // Hand out the next genuinely-unused letter id (A, B, C…) — no manual guessing.
                var id = NotGitNumberRegistry.AllocateNext("allocated at queue");
                githubNum = -id.Ordinal;
            }
            else
            {
                githubNum = githubNumber;

                // DETECTION — a bare positive number with no --notGit and no letter prefix.
                // Verify it's a real GitHub issue before treating it as one.
                if (githubNum is int n && n > 0)
                {
                    var verdict = await GitHubIssueVerifier.VerifyBareNumberAsync(n);
                    if (verdict == LocalIdDetection.NotAGitHubIssue)
                    {
                        ToastEngine.Warning("Ambiguous build number",
                            $"#{n} isn't a real GitHub issue. If this was meant to be a LOCAL build, re-queue it " +
                            $"with --notGit (it will get a letter id like A). Nothing was queued — add --notGit or " +
                            $"use a real GitHub issue number.");
                        return (null, null, true);
                    }
                    // VerifiedGitHubIssue / Inconclusive → proceed untouched (fail open).
                }
            }

            var blockers = new List<int>();

            // --blocked-by tokens: GitHub issue numbers. (Be lenient: a letter that slipped
            // into --blocked-by is still resolved as a LOCAL reference rather than dropped.)
            foreach (var raw in gitBlockers ?? Array.Empty<string>())
            {
                var t = (raw ?? "").Trim();
                if (t.Length == 0) continue;
                if (int.TryParse(t, out var num) && num > 0)
                    blockers.Add(num);
                else if (NotGitNumberRegistry.TryResolveLocalRef(t, out var ord))
                    blockers.Add(-ord);
            }

            // --block-by tokens: LOCAL letter references (legacy numbers tolerated).
            foreach (var raw in localBlockers ?? Array.Empty<string>())
            {
                if (NotGitNumberRegistry.TryResolveLocalRef(raw, out var ord))
                    blockers.Add(-ord);
                else if (!string.IsNullOrWhiteSpace(raw))
                    ActivityLog.Log("build-queue.notgit",
                        $"Ignored unrecognized --block-by token '{raw}' (expected a letter id like A or AB).");
            }

            var distinct = blockers.Distinct().ToList();
            return (githubNum, distinct.Count > 0 ? distinct : null, false);
        }

        /// <summary>Reads a JSON string[] property (missing/non-array → empty list). Numbers
        /// in the array are tolerated and stringified, so a legacy numeric payload still works.</summary>
        private static List<string> ReadStringArray(JsonElement root, string property)
        {
            var list = new List<string>();
            if (root.TryGetProperty(property, out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in arr.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.String)
                    {
                        var s = el.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) list.Add(s.Trim());
                    }
                    else if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var n))
                    {
                        list.Add(n.ToString());
                    }
                }
            }
            return list;
        }
    }
}
