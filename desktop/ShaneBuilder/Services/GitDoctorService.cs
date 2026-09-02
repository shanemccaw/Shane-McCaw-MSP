using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

// Real git integration for Step 13 (Git Doctor) — desktop/ShaneBuilder/wpf-handoff/readme-phase2.md.
// Every finding here comes from an actual git command against the real repo this
// executable lives inside — no seeded/fabricated findings, per this project's
// "never invent data" rule. Two of the mockup's nine seeded checks are NOT
// implemented because they cannot be detected without a side effect that would
// itself mutate the repo (a real "pull would overwrite" only shows up mid-merge;
// a CRLF-only diff only shows up mid-checkout) — that is an honest gap, not an
// oversight, and callers should not assume full mockup parity.

public enum GitDoctorSeverity { Low, Medium, High }
public enum GitDoctorRisk { Safe, Careful, Destructive }

public sealed record GitDoctorStep(string Cmd, string Why);

public sealed record GitDoctorRemedy(
    string Id, string Label, bool Recommended, GitDoctorRisk Risk, string Preserves,
    IReadOnlyList<GitDoctorStep> Steps);

public sealed class GitDoctorFinding
{
    public string CheckId { get; }
    public GitDoctorSeverity Severity { get; }
    public string Title { get; }
    public string Where { get; }
    public string PlainEnglish { get; }
    public string RawGitOutput { get; }
    public IReadOnlyList<GitDoctorRemedy> Remedies { get; }
    public bool ShowsBranches { get; }
    public bool Fixed { get; set; }

    public GitDoctorFinding(string checkId, GitDoctorSeverity severity, string title, string where,
        string plainEnglish, string rawGitOutput, IReadOnlyList<GitDoctorRemedy> remedies,
        bool showsBranches = false)
    {
        CheckId = checkId;
        Severity = severity;
        Title = title;
        Where = where;
        PlainEnglish = plainEnglish;
        RawGitOutput = rawGitOutput;
        Remedies = remedies;
        ShowsBranches = showsBranches;
    }
}

public sealed record GitDoctorBranch(
    string Name, string Sha, int AgeDays, bool Merged, bool RemoteGone, int Ahead, int Behind, bool InWorktree);

public sealed record GitDoctorStepResult(string Cmd, string Why, bool Success, string Output);

public sealed record GitDoctorCommitInfo(
    string Sha, string Subject, string Author, string When, bool Reachable, string Where,
    IReadOnlyList<string> Files, string Stat, string Notes);

public sealed record GitDoctorRepoStatus(string Repo, string Branch, string Remote, int Ahead, int Behind, int Worktrees);

public sealed class GitDoctorService
{
    public string? RepoRoot { get; }

    public GitDoctorService()
    {
        RepoRoot = FindRepoRoot(AppDomain.CurrentDomain.BaseDirectory) ?? FindRepoRoot(Environment.CurrentDirectory);
    }

    private static string? FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, ".git")) || File.Exists(Path.Combine(dir.FullName, ".git")))
                return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    private async Task<(int ExitCode, string StdOut, string StdErr)> RunAsync(string fileName, string args, int timeoutMs = 15000)
    {
        if (RepoRoot == null) return (-1, "", "no repo root found");

        var psi = new ProcessStartInfo(fileName, args)
        {
            WorkingDirectory = RepoRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        proc.Start();
        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        var exited = await Task.Run(() => proc.WaitForExit(timeoutMs));
        if (!exited)
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
            return (-1, "", $"timed out after {timeoutMs}ms");
        }
        return (proc.ExitCode, await stdoutTask, await stderrTask);
    }

    private Task<(int, string, string)> GitAsync(string args, int timeoutMs = 15000) => RunAsync("git", args, timeoutMs);

    public async Task<GitDoctorRepoStatus> GetRepoStatusAsync()
    {
        if (RepoRoot == null)
            return new GitDoctorRepoStatus("(no repo found)", "", "", 0, 0, 0);

        var name = Path.GetFileName(RepoRoot.TrimEnd(Path.DirectorySeparatorChar));
        var branch = (await GitAsync("rev-parse --abbrev-ref HEAD")).Item2.Trim();
        var remote = (await GitAsync("remote get-url origin")).Item2.Trim();
        int ahead = 0, behind = 0;
        var upstream = await GitAsync("rev-parse --abbrev-ref --symbolic-full-name @{u}");
        if (upstream.Item1 == 0)
        {
            var counts = await GitAsync($"rev-list --left-right --count HEAD...{upstream.Item2.Trim()}");
            var parts = counts.Item2.Trim().Split('\t');
            if (parts.Length == 2)
            {
                int.TryParse(parts[0], out ahead);
                int.TryParse(parts[1], out behind);
            }
        }
        var worktrees = (await GitAsync("worktree list --porcelain")).Item2
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries).Length;

        return new GitDoctorRepoStatus(string.IsNullOrEmpty(remote) ? name : ExtractRepoSlug(remote), branch, remote, ahead, behind, worktrees);
    }

    private static string ExtractRepoSlug(string remoteUrl)
    {
        var trimmed = remoteUrl.Trim().TrimEnd('/');
        if (trimmed.EndsWith(".git")) trimmed = trimmed[..^4];
        var idx = trimmed.LastIndexOfAny(new[] { '/', ':' });
        if (idx < 0) return trimmed;
        var afterOwner = trimmed[..idx];
        var ownerIdx = afterOwner.LastIndexOfAny(new[] { '/', ':' });
        return ownerIdx >= 0 ? trimmed[(ownerIdx + 1)..] : trimmed[(idx + 1)..];
    }

    public async Task<IReadOnlyList<GitDoctorFinding>> RunChecksAsync()
    {
        var findings = new List<GitDoctorFinding>();

        if (RepoRoot == null)
        {
            findings.Add(new GitDoctorFinding("norepo", GitDoctorSeverity.High, "No git repository found", "n/a",
                "ShaneBuilder could not find a .git directory walking up from its own executable folder or the current working directory. Every other check needs a real repo to run against.",
                "", Array.Empty<GitDoctorRemedy>()));
            return findings;
        }

        await CheckStaleLockAsync(findings);
        await CheckDirtyWorktreeAsync(findings);
        await CheckDivergedAsync(findings);
        await CheckWorktreesAsync(findings);
        await CheckAuthAsync(findings);
        await CheckStaleBranchesAsync(findings);

        return findings;
    }

    private async Task CheckStaleLockAsync(List<GitDoctorFinding> findings)
    {
        var gitDirResult = await GitAsync("rev-parse --git-dir");
        if (gitDirResult.Item1 != 0) return;
        var gitDir = gitDirResult.Item2.Trim();
        if (!Path.IsPathRooted(gitDir)) gitDir = Path.GetFullPath(Path.Combine(RepoRoot!, gitDir));
        var lockPath = Path.Combine(gitDir, "index.lock");
        if (!File.Exists(lockPath)) return;

        var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(lockPath);
        findings.Add(new GitDoctorFinding("lock", GitDoctorSeverity.Low, "Stale .git/index.lock", "main worktree",
            "A git process died and left its lock behind. Every later command refuses to run until the file is gone. Nothing is wrong with your repository.",
            $"fatal: Unable to create '{lockPath}': File exists.\n\n(lock file is {age.TotalMinutes:F0} minutes old)",
            new[]
            {
                new GitDoctorRemedy("rm", "Delete the stale lock", true, GitDoctorRisk.Safe,
                    "Nothing to preserve — the lock is not your work.",
                    new[] { new GitDoctorStep($"del \"{lockPath}\"", "remove the orphaned lock") })
            }));
    }

    private async Task CheckDirtyWorktreeAsync(List<GitDoctorFinding> findings)
    {
        var status = await GitAsync("status --porcelain=v1");
        if (status.Item1 != 0 || string.IsNullOrWhiteSpace(status.Item2)) return;

        var lines = status.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        int modified = lines.Count(l => l.Length > 0 && !l.StartsWith("??"));
        int untracked = lines.Count(l => l.StartsWith("??"));
        var evidence = string.Join("\n", lines.Take(20));
        if (lines.Length > 20) evidence += $"\n… {lines.Length - 20} more";

        var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd-HHmmss");
        findings.Add(new GitDoctorFinding("dirty", GitDoctorSeverity.Medium, "Worktree is dirty",
            $"{modified} modified · {untracked} untracked",
            "You have edits that are not committed. Pull, rebase and branch switches will refuse or clobber them, so they have to go somewhere first.",
            evidence,
            new[]
            {
                new GitDoctorRemedy("stash", "Stash them, keep going", true, GitDoctorRisk.Safe,
                    "Your edits go to a named stash and come straight back after.",
                    new[]
                    {
                        new GitDoctorStep("git stash push -u -m \"doctor/pre-pull\"", "park tracked and untracked edits"),
                        new GitDoctorStep("git stash list", "prove the stash exists before we touch anything")
                    }),
                new GitDoctorRemedy("wip", "Commit to a WIP branch", false, GitDoctorRisk.Safe,
                    "Everything is committed on wip/ so nothing can be lost.",
                    new[]
                    {
                        new GitDoctorStep($"git switch -c wip/doctor-{stamp}", "new branch off current HEAD"),
                        new GitDoctorStep("git add -A", "stage everything including untracked"),
                        new GitDoctorStep("git commit -m \"wip: doctor snapshot\"", "commit the snapshot")
                    }),
                new GitDoctorRemedy("discard", "Throw the edits away", false, GitDoctorRisk.Destructive,
                    "Nothing. These edits are gone for good.",
                    new[]
                    {
                        new GitDoctorStep("git restore --staged --worktree .", "revert tracked files"),
                        new GitDoctorStep("git clean -fd", "delete untracked files")
                    })
            }));
    }

    private async Task CheckDivergedAsync(List<GitDoctorFinding> findings)
    {
        var upstream = await GitAsync("rev-parse --abbrev-ref --symbolic-full-name @{u}");
        if (upstream.Item1 != 0) return;
        var upstreamRef = upstream.Item2.Trim();

        var counts = await GitAsync($"rev-list --left-right --count HEAD...{upstreamRef}");
        if (counts.Item1 != 0) return;
        var parts = counts.Item2.Trim().Split('\t');
        if (parts.Length != 2 || !int.TryParse(parts[0], out var ahead) || !int.TryParse(parts[1], out var behind)) return;
        if (ahead == 0 || behind == 0) return; // a plain fast-forward isn't a doctor finding

        var stamp = DateTime.UtcNow.ToString("HHmmss");
        findings.Add(new GitDoctorFinding("diverged", GitDoctorSeverity.High, "Your branch and origin have diverged",
            $"{ahead} ahead · {behind} behind",
            $"Both sides moved on. A plain pull would make a merge commit nobody wants. Rebasing puts your {ahead} commit{(ahead == 1 ? "" : "s")} on top of {upstreamRef}'s {behind}.",
            $"$ git rev-list --left-right --count HEAD...{upstreamRef}\n{ahead}\t{behind}\n\nYour branch and '{upstreamRef}' have diverged,\nand have {ahead} and {behind} different commits each, respectively.",
            new[]
            {
                new GitDoctorRemedy("rebase", $"Rebase your {ahead} commit{(ahead == 1 ? "" : "s")} onto {upstreamRef}", true, GitDoctorRisk.Careful,
                    "A backup branch is cut first, so the old history is recoverable.",
                    new[]
                    {
                        new GitDoctorStep($"git branch backup/pre-doctor-{stamp}", "safety net you can return to"),
                        new GitDoctorStep("git fetch origin", "get the newest refs"),
                        new GitDoctorStep($"git rebase {upstreamRef}", "replay your commits on top")
                    }),
                new GitDoctorRemedy("merge", "Merge origin into yours", false, GitDoctorRisk.Safe,
                    "Both histories, at the cost of a merge commit.",
                    new[]
                    {
                        new GitDoctorStep("git fetch origin", "get the newest refs"),
                        new GitDoctorStep($"git merge {upstreamRef}", "merge commit joins both sides")
                    }),
                new GitDoctorRemedy("reset", $"Discard your commits, match {upstreamRef}", false, GitDoctorRisk.Destructive,
                    $"Nothing local. Your {ahead} commit{(ahead == 1 ? "" : "s")} {(ahead == 1 ? "is" : "are")} dropped.",
                    new[]
                    {
                        new GitDoctorStep("git fetch origin", "get the newest refs"),
                        new GitDoctorStep($"git reset --hard {upstreamRef}", "force local to match origin exactly")
                    })
            }));
    }

    private async Task CheckWorktreesAsync(List<GitDoctorFinding> findings)
    {
        var wt = await GitAsync("worktree list --porcelain");
        if (wt.Item1 != 0) return;

        var blocks = wt.Item2.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries);
        foreach (var block in blocks)
        {
            var lines = block.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            var path = lines.FirstOrDefault(l => l.StartsWith("worktree "))?["worktree ".Length..];
            if (path == null) continue;
            bool isMain = string.Equals(Path.GetFullPath(path), Path.GetFullPath(RepoRoot!), StringComparison.OrdinalIgnoreCase);
            bool detached = lines.Any(l => l == "detached");
            var prunableLine = lines.FirstOrDefault(l => l.StartsWith("prunable"));
            var headSha = lines.FirstOrDefault(l => l.StartsWith("HEAD "))?["HEAD ".Length..];

            if (detached && !isMain)
            {
                var shortSha = (headSha ?? "").Length >= 7 ? headSha![..7] : headSha ?? "";
                findings.Add(new GitDoctorFinding("detached-" + shortSha, GitDoctorSeverity.Medium,
                    "Detached HEAD in a build worktree", path,
                    "That worktree is sitting on a commit, not a branch. Anything committed there is invisible to every branch and gets lost on the next checkout.",
                    $"HEAD detached at {shortSha}\nworktree: {path}",
                    new[]
                    {
                        new GitDoctorRemedy("branch", "Give that commit a branch", true, GitDoctorRisk.Safe,
                            "The commit becomes reachable and safe.",
                            new[] { new GitDoctorStep($"git -C \"{path}\" switch -c recover/{Path.GetFileName(path.TrimEnd('/', '\\'))}", "name the commit so it cannot be lost") })
                    }));
            }

            if (prunableLine != null)
            {
                var reason = prunableLine.Contains(' ') ? prunableLine[(prunableLine.IndexOf(' ') + 1)..] : "gitdir file points to a missing location";
                findings.Add(new GitDoctorFinding("prune-" + Path.GetFileName(path.TrimEnd('/', '\\')), GitDoctorSeverity.Low,
                    "Prunable worktree", path,
                    "A worktree folder was deleted or moved without telling git. Git still reserves the branch, so re-dispatching that build fails.",
                    $"$ git worktree list\n{path}  prunable ({reason})",
                    new[]
                    {
                        new GitDoctorRemedy("prunefix", "Prune the dead worktree", true, GitDoctorRisk.Safe,
                            "Only the stale registration is removed.",
                            new[] { new GitDoctorStep("git worktree prune -v", "release the reservation") })
                    }));
            }
        }
    }

    private async Task CheckAuthAsync(List<GitDoctorFinding> findings)
    {
        var r = await GitAsync("ls-remote --exit-code origin -h", timeoutMs: 8000);
        if (r.Item1 == 0) return;
        var err = r.Item3;
        bool looksLikeAuth = err.Contains("Authentication failed", StringComparison.OrdinalIgnoreCase)
            || err.Contains("could not read Username", StringComparison.OrdinalIgnoreCase)
            || err.Contains("Permission denied", StringComparison.OrdinalIgnoreCase)
            || err.Contains("access denied", StringComparison.OrdinalIgnoreCase);
        if (!looksLikeAuth) return; // a plain offline/timeout isn't an auth finding — don't fabricate one

        findings.Add(new GitDoctorFinding("auth", GitDoctorSeverity.High, "GitHub rejected your credentials", "origin",
            "The stored credential was rejected. Windows Credential Manager (or the SSH key in use) is handing git something GitHub no longer accepts, so every fetch fails the same way.",
            err.Trim(),
            new[]
            {
                new GitDoctorRemedy("pat", "Re-authenticate with a fresh PAT", true, GitDoctorRisk.Safe,
                    "Nothing changes in the repo; only the credential is replaced.",
                    new[]
                    {
                        new GitDoctorStep("cmdkey /delete:git:https://github.com", "drop the dead credential"),
                        new GitDoctorStep("git credential-manager github login", "store a current PAT"),
                        new GitDoctorStep("git ls-remote origin -h", "prove auth works before anything else runs")
                    })
            }));
    }

    public async Task<IReadOnlyList<GitDoctorBranch>> ComputeBranchesAsync()
    {
        if (RepoRoot == null) return Array.Empty<GitDoctorBranch>();

        var upstream = await GitAsync("rev-parse --abbrev-ref --symbolic-full-name @{u}");
        var defaultRef = upstream.Item1 == 0 ? upstream.Item2.Trim() : "HEAD";

        var mergedResult = await GitAsync($"branch --format=%(refname:short) --merged {defaultRef}");
        var mergedSet = new HashSet<string>(mergedResult.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()));

        var vv = await GitAsync("branch -vv");
        var goneSet = new HashSet<string>(vv.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Where(l => l.Contains(": gone]"))
            .Select(l => l.TrimStart('*', ' ').Split(' ')[0]));

        var forEach = await GitAsync("for-each-ref --format=%(refname:short)|%(objectname:short)|%(committerdate:unix) refs/heads");
        if (forEach.Item1 != 0) return Array.Empty<GitDoctorBranch>();

        var wt = await GitAsync("worktree list --porcelain");
        var worktreeBranches = new HashSet<string>();
        foreach (var block in wt.Item2.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var b = block.Split('\n').FirstOrDefault(l => l.StartsWith("branch refs/heads/"));
            if (b != null) worktreeBranches.Add(b["branch refs/heads/".Length..]);
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var result = new List<GitDoctorBranch>();
        foreach (var line in forEach.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split('|');
            if (parts.Length != 3) continue;
            var name = parts[0];
            var sha = parts[1];
            if (!long.TryParse(parts[2], out var committedUnix)) continue;
            var ageDays = (int)((now - committedUnix) / 86400);
            result.Add(new GitDoctorBranch(name, sha, ageDays, mergedSet.Contains(name), goneSet.Contains(name),
                Ahead: 0, Behind: 0, InWorktree: worktreeBranches.Contains(name)));
        }
        return result;
    }

    private async Task CheckStaleBranchesAsync(List<GitDoctorFinding> findings)
    {
        var branches = await ComputeBranchesAsync();
        const int StaleThreshold = 25; // a hand round number, not the mockup's fabricated "131"
        if (branches.Count < StaleThreshold) return;

        var mergedCount = branches.Count(b => b.Merged && !b.InWorktree);
        var goneCount = branches.Count(b => b.RemoteGone);
        var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd");

        var remedies = new List<GitDoctorRemedy>();
        if (mergedCount > 0)
            remedies.Add(new GitDoctorRemedy("mergedonly", $"Delete the {mergedCount} merged branches", true, GitDoctorRisk.Safe,
                "Unmerged work is skipped entirely; a backup tag holds every deleted tip.",
                new[]
                {
                    new GitDoctorStep($"git tag backup/branches-{stamp}", "anchor point before any deletion"),
                    new GitDoctorStep($"git branch -d $(git branch --format=\"%(refname:short)\" --merged {(branches.FirstOrDefault()?.Name ?? "HEAD")})", "-d refuses anything unmerged, so this cannot lose work")
                }));
        if (goneCount > 0)
            remedies.Add(new GitDoctorRemedy("gone", $"Delete the {goneCount} whose remote is gone", false, GitDoctorRisk.Careful,
                "Only branches whose upstream was deleted on GitHub.",
                new[]
                {
                    new GitDoctorStep("git fetch --prune", "update which remotes still exist"),
                    new GitDoctorStep("git branch -vv | findstr \": gone]\"", "confirm the list before deleting")
                }));

        findings.Add(new GitDoctorFinding("stale", GitDoctorSeverity.Medium, $"{branches.Count} local branches", "local",
            "Branch names are how git decides what to keep. A large pile of stale branches pins commits, slows fetch, and buries the handful you actually work on. Most of these are already merged — deleting them removes nothing but the label.",
            $"$ git for-each-ref --format=\"%(refname:short) %(committerdate:relative)\" refs/heads\n{branches.Count} branches total, {mergedCount} merged, {goneCount} with remote gone",
            remedies, showsBranches: true));
    }

    public async Task<GitDoctorCommitInfo?> LookupCommitAsync(string shaPrefix)
    {
        if (RepoRoot == null || string.IsNullOrWhiteSpace(shaPrefix)) return null;

        var show = await GitAsync($"log -1 --format=%H%n%s%n%an%n%ad --date=format:\"%Y-%m-%d %H:%M\" {shaPrefix}");
        if (show.Item1 != 0) return null;
        var lines = show.Item2.Split('\n');
        if (lines.Length < 4) return null;
        var sha = lines[0].Trim();
        var subject = lines[1].Trim();
        var author = lines[2].Trim();
        var when = lines[3].Trim();

        var branches = await GitAsync($"branch -a --contains {sha}");
        var containingBranches = branches.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.TrimStart('*', ' ').Trim()).Where(l => l.Length > 0).ToList();
        bool reachable = containingBranches.Count > 0;

        var stat = await GitAsync($"show --stat --format= {sha}");
        var statLines = stat.Item2.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        var files = statLines.Take(Math.Max(0, statLines.Length - 1)).ToList();
        var summary = statLines.LastOrDefault() ?? "";

        var wtCheck = await GitAsync("worktree list --porcelain");
        string? worktreeHit = null;
        foreach (var block in wtCheck.Item2.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var headLine = block.Split('\n').FirstOrDefault(l => l.StartsWith("HEAD "));
            if (headLine != null && headLine.Contains(sha[..Math.Min(7, sha.Length)]))
            {
                worktreeHit = block.Split('\n').FirstOrDefault(l => l.StartsWith("worktree "))?["worktree ".Length..];
            }
        }

        var where = reachable ? string.Join(", ", containingBranches) : worktreeHit ?? "not found in any branch or worktree";
        var notes = reachable
            ? $"Reachable from {containingBranches[0]} — nothing to worry about."
            : worktreeHit != null
                ? $"Not reachable from any branch. It lives only in the {worktreeHit} worktree — a checkout there and this commit could become unreachable."
                : "Not reachable from any local branch and not found in a live worktree. It may still be recoverable from the reflog or a dangling object.";

        return new GitDoctorCommitInfo(sha, subject, author, when, reachable, where, files, summary, notes);
    }

    public async IAsyncEnumerable<GitDoctorStepResult> RunStepsAsync(IReadOnlyList<GitDoctorStep> steps)
    {
        foreach (var step in steps)
        {
            var (exit, stdout, stderr) = await RunAsync("cmd.exe", "/c " + step.Cmd, timeoutMs: 60000);
            var output = string.IsNullOrWhiteSpace(stderr) ? stdout : (stdout + (stdout.Length > 0 ? "\n" : "") + stderr);
            yield return new GitDoctorStepResult(step.Cmd, step.Why, exit == 0, output.Trim());
        }
    }
}
