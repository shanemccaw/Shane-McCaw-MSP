using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4681 — one real, local git checkout that can be asked "what is on <c>origin/main</c>
    /// for this <c>owner/repo</c>?": the repo it is a checkout OF, the checkout's root, and the
    /// remote-tracking ref (<see cref="BaseRef"/>, e.g. <c>origin/main</c>) a bookend and its cited
    /// commit are verified against.
    /// </summary>
    public sealed record BookendSource(string OwnerRepo, string RepoRoot, string BaseRef, bool IsPrimary)
    {
        /// <summary>The branch name behind <see cref="BaseRef"/> (<c>origin/main</c> → <c>main</c>).</summary>
        public string BranchName => BaseRef.StartsWith("origin/", StringComparison.Ordinal) ? BaseRef.Substring("origin/".Length) : BaseRef;
    }

    /// <summary>
    /// Git #4681 — resolves WHERE a build's <c>build-journal/{N}.md</c> bookend can be read from.
    ///
    /// <see cref="DoneBookendVerifier"/> used to read every bookend from the ONE checkout
    /// <see cref="BuildTrackerConfig.FindRepoRoot"/> returns (this instance's own repo). A build whose
    /// tracking issue lives here but whose code and bookend live in a different configured repo
    /// (M365Architect: the tracking issue is on Shane-McCaw-MSP because the shared board's
    /// move_to_status cannot resolve a non-default repo's issue numbers) therefore always read "no
    /// bookend". The queue row's own <c>repo_owner/repo_name</c> (#3579) names the TRACKING issue's repo,
    /// not the bookend's, so this maps an <c>owner/repo</c> — the tracking repo first, then every other
    /// repo in the Settings registry (#3581) — to a real local checkout.
    ///
    /// A checkout is accepted ONLY when its <c>origin</c> remote genuinely is that <c>owner/repo</c>
    /// (never on a directory name alone), and is looked for in the places this codebase already puts
    /// them: <c>&lt;secondary-root&gt;\&lt;owner&gt;__&lt;repo&gt;</c> (the #3584 <c>repo-clone.mjs</c> location),
    /// then next to the main checkout as <c>&lt;repo&gt;-clone</c> / <c>&lt;repo&gt;</c>, then any other
    /// sibling real clone. This class NEVER clones or downloads anything: a repo with no local
    /// checkout is simply unresolvable (logged, fail closed), exactly like an unresolvable main repo
    /// root already is.
    /// </summary>
    public static class BookendSourceResolver
    {
        private const string Channel = "watcher";

        // A resolved checkout is stable; an unresolved repo is re-searched after this, so a clone that
        // appears later is picked up without restarting the app, without re-scanning on every tick.
        private static readonly TimeSpan MissRetry = TimeSpan.FromMinutes(5);

        private static readonly Regex OriginRx =
            new(@"github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Dictionary<string, (BookendSource? Source, DateTime AtUtc)> _cache = new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _cacheLock = new();

        /// <summary>This instance's own repo (the one <see cref="BuildTrackerConfig.FindRepoRoot"/> is a checkout of).</summary>
        public static string PrimaryOwnerRepo => BuildConsoleSettings.Load().GitHubOwnerRepo;

        /// <summary>True when the two <c>owner/repo</c> strings name the same repo (case-insensitive; null/blank never matches).</summary>
        public static bool IsSameRepo(string? a, string? b) =>
            !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b)
            && string.Equals(a!.Trim(), b!.Trim(), StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// Every configured repo (Settings registry, #3581), this instance's own repo first. The set a
        /// bookend is looked for in when the tracking repo does not hold it.
        /// </summary>
        public static List<string> ConfiguredOwnerRepos()
        {
            var primary = PrimaryOwnerRepo;
            var all = new List<string> { primary };
            try
            {
                foreach (var r in BuildConsoleSettings.Load().GetAllConfiguredRepos())
                    if (!string.IsNullOrWhiteSpace(r.OwnerRepo) && !all.Any(x => IsSameRepo(x, r.OwnerRepo)))
                        all.Add(r.OwnerRepo.Trim());
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Git #4681: couldn't read the configured-repo registry ({ex.Message}) — only this instance's own repo will be consulted for bookends this pass.");
            }
            return all;
        }

        /// <summary>
        /// The real local checkout for <paramref name="ownerRepo"/>, or null when none exists (or the
        /// primary repo root itself is unresolvable). Never throws.
        /// </summary>
        public static async Task<BookendSource?> ResolveAsync(string ownerRepo)
        {
            if (string.IsNullOrWhiteSpace(ownerRepo)) return null;
            ownerRepo = ownerRepo.Trim();

            if (IsSameRepo(ownerRepo, PrimaryOwnerRepo))
            {
                // Byte-for-byte the pre-#4681 behavior for this instance's own repo.
                var root = BuildTrackerConfig.FindRepoRoot();
                return string.IsNullOrEmpty(root) ? null : new BookendSource(PrimaryOwnerRepo, root, "origin/main", IsPrimary: true);
            }

            lock (_cacheLock)
            {
                if (_cache.TryGetValue(ownerRepo, out var hit))
                {
                    bool stillValid = hit.Source != null
                        ? Directory.Exists(hit.Source.RepoRoot)
                        : DateTime.UtcNow - hit.AtUtc < MissRetry;
                    if (stillValid) return hit.Source;
                }
            }

            BookendSource? found = null;
            try
            {
                var root = await FindCheckoutByOriginAsync(ownerRepo);
                if (root != null)
                {
                    var baseRef = await ResolveBaseRefAsync(root);
                    found = new BookendSource(ownerRepo, root, baseRef, IsPrimary: false);
                    ActivityLog.Log(Channel, $"Git #4681: bookend source for \"{ownerRepo}\" resolved to {root} (verifying against {baseRef}).");
                }
                else
                {
                    ActivityLog.Log(Channel, $"Git #4681: no local checkout of \"{ownerRepo}\" found (origin remote must equal it) — its bookends can't be read this pass (fail closed); re-searching in {(int)MissRetry.TotalMinutes} min.");
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Git #4681: resolving the checkout of \"{ownerRepo}\" threw ({ex.Message}) — treating it as unresolvable this pass (fail closed).");
            }

            lock (_cacheLock) { _cache[ownerRepo] = (found, DateTime.UtcNow); }
            return found;
        }

        /// <summary>Parses the real <c>owner/repo</c> out of a git remote URL (https or ssh), or null.</summary>
        internal static string? ParseOwnerRepo(string? remoteUrl)
        {
            if (string.IsNullOrWhiteSpace(remoteUrl)) return null;
            var m = OriginRx.Match(remoteUrl.Trim());
            return m.Success ? $"{m.Groups[1].Value}/{m.Groups[2].Value}" : null;
        }

        private static async Task<string?> FindCheckoutByOriginAsync(string ownerRepo)
        {
            var slash = ownerRepo.IndexOf('/');
            if (slash <= 0 || slash == ownerRepo.Length - 1) return null;
            var owner = ownerRepo.Substring(0, slash);
            var repo = ownerRepo.Substring(slash + 1);

            // Same location scripts/dev-server/repo-clone.mjs's secondaryReposRoot() clones into.
            var secondaryRoot = Environment.GetEnvironmentVariable("DEV_SERVER_SECONDARY_REPOS_ROOT");
            if (string.IsNullOrWhiteSpace(secondaryRoot)) secondaryRoot = @"C:\repos";

            var candidates = new List<string> { Path.Combine(secondaryRoot, $"{owner}__{repo}") };

            var parent = await MainCheckoutParentAsync();
            if (parent != null)
            {
                candidates.Add(Path.Combine(parent, repo + "-clone"));
                candidates.Add(Path.Combine(parent, repo));
                try
                {
                    // Any other real clone next to the main checkout (a .git DIRECTORY — a linked
                    // worktree has a .git file and is transient, so it is deliberately not a candidate).
                    candidates.AddRange(Directory.EnumerateDirectories(parent)
                        .Where(d => Directory.Exists(Path.Combine(d, ".git")))
                        .OrderBy(d => d, StringComparer.OrdinalIgnoreCase));
                }
                catch { /* an unreadable parent just narrows the search */ }
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var cand in candidates)
            {
                if (!seen.Add(Path.GetFullPath(cand))) continue;
                if (!Directory.Exists(cand)) continue;
                if (!Directory.Exists(Path.Combine(cand, ".git")) && !File.Exists(Path.Combine(cand, ".git"))) continue;

                var origin = await DoneBookendVerifier.RunGitAsync(cand, "remote", "get-url", "origin");
                if (origin.ExitCode != 0) continue;
                if (IsSameRepo(ParseOwnerRepo(origin.StdOut), ownerRepo)) return cand;
            }
            return null;
        }

        /// <summary>
        /// The directory the MAIN checkout lives in — where sibling clones are kept. Derived from the git
        /// common dir, so it is the same whether this process runs from the main checkout or from a
        /// linked worktree of it.
        /// </summary>
        private static async Task<string?> MainCheckoutParentAsync()
        {
            var root = BuildTrackerConfig.FindRepoRoot();
            if (string.IsNullOrEmpty(root)) return null;

            var common = await DoneBookendVerifier.RunGitAsync(root, "rev-parse", "--git-common-dir");
            string mainRoot = root;
            if (common.ExitCode == 0 && !string.IsNullOrWhiteSpace(common.StdOut))
            {
                var commonDir = Path.GetFullPath(Path.Combine(root, common.StdOut.Trim()));
                if (string.Equals(Path.GetFileName(commonDir.TrimEnd('\\', '/')), ".git", StringComparison.OrdinalIgnoreCase))
                    mainRoot = Path.GetDirectoryName(commonDir.TrimEnd('\\', '/')) ?? root;
            }
            return Path.GetDirectoryName(mainRoot.TrimEnd('\\', '/'));
        }

        /// <summary>The real default-branch remote ref (<c>origin/HEAD</c>'s target) — not every repo's is <c>main</c>.</summary>
        private static async Task<string> ResolveBaseRefAsync(string repoRoot)
        {
            var r = await DoneBookendVerifier.RunGitAsync(repoRoot, "rev-parse", "--abbrev-ref", "origin/HEAD");
            var name = r.StdOut.Trim();
            if (r.ExitCode == 0 && name.StartsWith("origin/", StringComparison.Ordinal) && name != "origin/HEAD")
                return name;
            return "origin/main";
        }
    }
}
