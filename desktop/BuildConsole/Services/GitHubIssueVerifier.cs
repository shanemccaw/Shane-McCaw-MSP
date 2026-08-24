using System;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Outcome of checking whether a bare number is a real GitHub issue.</summary>
    public enum LocalIdDetection
    {
        /// <summary>The number IS a real, existing GitHub issue — treat as GitHub, never touch/rename it.</summary>
        VerifiedGitHubIssue,
        /// <summary>The number is definitively NOT a GitHub issue (404) — very likely a --notGit build queued without the flag.</summary>
        NotAGitHubIssue,
        /// <summary>Couldn't verify (no PAT, offline, API error) — fail open, don't block or guess.</summary>
        Inconclusive
    }

    /// <summary>
    /// The detection half of the local-id work: when a build is queued with a BARE NUMBER
    /// identity, no <c>--notGit</c> flag and no letter prefix, we must not blindly assume
    /// it is a GitHub issue. This verifies the number against the real GitHub REST API
    /// (<see cref="GitHubApiClient.GetIssueAsync"/>) so we can tell the two apart:
    ///
    ///   • it resolves to a real issue      → it's genuinely GitHub; leave it untouched.
    ///   • GitHub returns 404               → it's NOT a real issue; the author very likely
    ///                                         meant a LOCAL build and forgot --notGit.
    ///                                         Flag it clearly rather than silently guessing.
    ///   • no PAT / network error           → inconclusive; fail open (don't block real work).
    ///
    /// Every detection is logged to the build-queue.notgit channel.
    /// </summary>
    public static class GitHubIssueVerifier
    {
        public static async Task<LocalIdDetection> VerifyBareNumberAsync(int number)
        {
            if (number <= 0) return LocalIdDetection.Inconclusive;

            BuildConsoleSettings settings;
            try { settings = BuildConsoleSettings.Load(); }
            catch { return LocalIdDetection.Inconclusive; }

            if (!settings.HasGitHubPat)
            {
                ActivityLog.Log("build-queue.notgit",
                    $"Could not verify #{number} against GitHub (no PAT configured) — proceeding as entered, not blocking.");
                return LocalIdDetection.Inconclusive;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var issue = await client.GetIssueAsync(number);
                if (issue != null)
                {
                    ActivityLog.Log("build-queue.notgit",
                        $"Verified #{number} is a real GitHub issue — treating as GitHub, left untouched.");
                    return LocalIdDetection.VerifiedGitHubIssue;
                }

                // 404 — GetIssueAsync swallows NotFound and returns null.
                ActivityLog.Log("build-queue.notgit",
                    $"DETECTION: #{number} was queued with NO --notGit flag and NO letter prefix, but it does " +
                    $"NOT match any real GitHub issue. This was very likely meant to be a LOCAL build with " +
                    $"--notGit omitted — flagging rather than silently treating it as GitHub issue #{number}.");
                return LocalIdDetection.NotAGitHubIssue;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.notgit",
                    $"Could not verify #{number} against GitHub ({ex.Message}) — proceeding as entered, not blocking.");
                return LocalIdDetection.Inconclusive;
            }
        }
    }
}
