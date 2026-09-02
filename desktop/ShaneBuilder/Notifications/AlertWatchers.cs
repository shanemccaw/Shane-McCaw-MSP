using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2201 — readme-phase2.md Step 11: "Every emitter (build runner, git watcher, deploy watcher,
/// agent bridge) publishes one of these two records — never a plain string." The five real watchers
/// below ARE those emitters. Each polls a genuinely live source already wired by #2176/#2195/#2197/
/// #2209/#2213/#2214 (local Postgres or the GitHub REST API) and diffs against its own in-memory
/// last-seen snapshot so a session only alerts on a REAL transition observed during this run — not a
/// flood replaying years of history the moment the app starts (899 historically-done builds, hundreds
/// of already-closed issues). Two watchers (worktree health, pinned questions) are state-based rather
/// than transition-based: those alert on the real CURRENT state immediately, because "Claude is
/// waiting on you right now" and "the worktree is dirty right now" are both genuinely actionable the
/// moment the app opens, unlike a build that failed three days ago.
///
/// Any watcher whose data layer isn't reachable (no DATABASE_URL, no GitHub PAT) simply doesn't start
/// — an honest no-op, per this project's "never invent data" rule, not a faked signal.
/// </summary>
public static class AlertWatchers
{
    private static CancellationTokenSource? _cts;
    private static bool _started;

    public static void Start()
    {
        if (_started) return;
        _started = true;
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;

        _ = RunBuildWatcherAsync(ct);
        _ = RunGitDoctorWatcherAsync(ct);
        _ = RunBoardWatcherAsync(ct);
        _ = RunDeployWatcherAsync(ct);
        _ = RunGitHubBlockedWatcherAsync(ct);
        _ = RunPinnedQuestionsWatcherAsync(ct);
        _ = RunMilestoneWatcherAsync(ct);
    }

    public static void Stop()
    {
        try { _cts?.Cancel(); } catch { }
    }

    /// <summary>Turns a catalog seed into a live Alert — shared by the real watchers below and the
    /// Alert Lab's "fire on demand" buttons, so a seeded demo alert and a real one render identically.</summary>
    public static Alert BuildFromSeed(string id, AlertSeed seed, string meta, string evidence,
        AlertAction? primary = null, AlertAction? secondary = null, Func<string, Task>? onReply = null)
        => new(id, seed.Kind, seed.Sev, seed.Title, meta, evidence, primary, secondary, seed.WantsReply) { OnReply = onReply };

    private static async Task DelayAsync(int seconds, CancellationToken ct)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(seconds), ct); } catch (TaskCanceledException) { }
    }

    private static string FormatAge(DateTime at)
    {
        var span = DateTime.UtcNow - at.ToUniversalTime();
        if (span.TotalMinutes < 1) return "just now";
        if (span.TotalHours < 1) return $"{(int)span.TotalMinutes} min ago";
        if (span.TotalDays < 1) return $"{(int)span.TotalHours} h ago";
        return $"{(int)span.TotalDays} d ago";
    }

    // ── Build runner — bt_build_queue status transitions ──────────────────────────────────────
    private static async Task RunBuildWatcherAsync(CancellationToken ct)
    {
        var client = QueueReadClient.CreateFromEnvironment();
        if (client == null) return;

        var lastStatus = new Dictionary<int, string?>();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var rows = await client.GetRecentAsync(30);
                foreach (var row in rows)
                {
                    lastStatus.TryGetValue(row.Id, out var prev);
                    if (prev != null && prev != row.Status)
                    {
                        if (row.Status == "failed")
                        {
                            var seed = AlertCatalog.Seeds[AlertKind.BuildFailed];
                            var title = row.GithubNumber.HasValue ? $"Build failed on #{row.GithubNumber}" : $"\"{row.Title}\" failed";
                            var evidence = $"bld_{row.Id} · exit code {(row.ExitCode?.ToString() ?? "unknown")}";
                            var primary = new AlertAction("Open the build log at the failure", () =>
                            {
                                AlertActions.OpenLogAt?.Invoke("build", new[] { LogLevel.Error, LogLevel.Fatal }, row.Title);
                                return Task.CompletedTask;
                            });
                            AlertCenter.PublishAlert(new Alert($"build-failed-{row.Id}", AlertKind.BuildFailed, seed.Sev, title,
                                row.CompletedAt?.ToLocalTime().ToString("t") ?? "just now", evidence, primary, null, false));
                        }
                        else if (row.Status == "done")
                        {
                            var text = row.GithubNumber.HasValue ? $"#{row.GithubNumber} — bld_{row.Id}" : $"bld_{row.Id}";
                            var eventId = row.BlockedByNumber.HasValue ? "unblocked" : "buildclean";
                            AlertCenter.Celebrate(new Celebration($"{eventId}-{row.Id}", 1, Mood.Good, CelebrationShape.Cheer, text));
                        }
                    }
                    lastStatus[row.Id] = row.Status;
                }
            }
            catch { /* a poll failing must never crash the watcher loop */ }
            await DelayAsync(60, ct);
        }
    }

    // ── Git watcher — GitDoctorService's real "dirty"/"diverged" checks ───────────────────────
    private static async Task RunGitDoctorWatcherAsync(CancellationToken ct)
    {
        var svc = new GitDoctorService();
        bool alerted = false;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var findings = await svc.RunChecksAsync();
                var hits = findings.Where(f => !f.Fixed && (f.CheckId == "dirty" || f.CheckId == "diverged")).ToList();
                if (hits.Count > 0 && !alerted)
                {
                    alerted = true;
                    var seed = AlertCatalog.Seeds[AlertKind.WorktreeDirty];
                    var evidence = string.Join(" · ", hits.Select(f => f.PlainEnglish));
                    var primary = new AlertAction("Fix Git", () => { AlertActions.OpenGitDoctor?.Invoke(); return Task.CompletedTask; });
                    var secondary = new AlertAction("Open Git Doctor", () => { AlertActions.OpenGitDoctor?.Invoke(); return Task.CompletedTask; });
                    AlertCenter.PublishAlert(new Alert("worktree-health", AlertKind.WorktreeDirty, seed.Sev,
                        string.Join(" and ", hits.Select(f => f.Title)), "checked just now", evidence, primary, secondary, false));
                }
                else if (hits.Count == 0)
                {
                    alerted = false; // clean again — the next real dirty/diverged state can alert again
                }
            }
            catch { }
            await DelayAsync(90, ct);
        }
    }

    // ── Git watcher — bt_epics / bt_issues real status transitions ────────────────────────────
    private static async Task RunBoardWatcherAsync(CancellationToken ct)
    {
        var client = BoardReadClient.CreateFromEnvironment();
        if (client == null) return;

        var epicStatus = new Dictionary<int, string>();
        var issueStatus = new Dictionary<int, string>();
        bool issueBaselineCaptured = false;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var epics = await client.GetEpicsAsync();
                foreach (var ep in epics)
                {
                    if (epicStatus.TryGetValue(ep.Id, out var prev) && prev != ep.Status && ep.Status == "closed")
                    {
                        var label = ep.GithubNumber.HasValue ? $"Epic #{ep.GithubNumber} closed" : $"{ep.Title} closed";
                        AlertCenter.Celebrate(new Celebration($"epicclosed-{ep.Id}", 3, Mood.Good, CelebrationShape.Party, label) { Label = label });
                    }
                    epicStatus[ep.Id] = ep.Status;
                }

                var issues = await client.GetIssuesAsync();
                foreach (var it in issues)
                {
                    if (issueStatus.TryGetValue(it.Id, out var prev))
                    {
                        if (prev != it.Status && (it.Status == "closed" || it.Status == "done"))
                        {
                            var text = it.GithubNumber.HasValue ? $"#{it.GithubNumber}" : it.Title;
                            AlertCenter.Celebrate(new Celebration($"issueclosed-{it.Id}", 2, Mood.Good, CelebrationShape.Eat, text));
                        }
                    }
                    else if (issueBaselineCaptured)
                    {
                        var text = it.GithubNumber.HasValue ? $"#{it.GithubNumber}" : it.Title;
                        AlertCenter.Celebrate(new Celebration($"issueopened-{it.Id}", 1, Mood.Evil, CelebrationShape.Carry, text));
                    }
                    issueStatus[it.Id] = it.Status;
                }
                issueBaselineCaptured = true;
            }
            catch { }
            await DelayAsync(90, ct);
        }
    }

    // ── Deploy watcher — deployed_version_stamp real new rows ─────────────────────────────────
    private static async Task RunDeployWatcherAsync(CancellationToken ct)
    {
        var client = BoardReadClient.CreateFromEnvironment();
        if (client == null) return;

        int? lastSeenId = null;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var rows = await client.GetRecentDeploysAsync(3);
                if (rows.Count > 0)
                {
                    var newest = rows[0];
                    if (lastSeenId.HasValue && newest.Id != lastSeenId.Value)
                    {
                        var text = newest.CommitMessage.Length > 60 ? newest.CommitMessage[..60] + "…" : newest.CommitMessage;
                        AlertCenter.Celebrate(new Celebration($"deploy-{newest.Id}", 2, Mood.Good, CelebrationShape.Cheer, text));
                    }
                    lastSeenId = newest.Id;
                }
            }
            catch { }
            await DelayAsync(120, ct);
        }
    }

    // ── Agent bridge (GitHub side) — label:blocked open-issue search ──────────────────────────
    private static async Task RunGitHubBlockedWatcherAsync(CancellationToken ct)
    {
        var client = GitHubReadClient.CreateFromEnvironment();
        if (client == null) return;

        HashSet<int>? known = null;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var blocked = await client.GetBlockedOpenIssuesAsync();
                var currentIds = blocked.Select(b => b.Number).ToHashSet();
                if (known != null)
                {
                    foreach (var b in blocked.Where(b => !known.Contains(b.Number)))
                    {
                        var seed = AlertCatalog.Seeds[AlertKind.IssueBlocked];
                        var primary = new AlertAction($"Open #{b.Number} in the Git panel", () =>
                        {
                            AlertActions.OpenIssueInGitPanel?.Invoke(b.Number);
                            return Task.CompletedTask;
                        });
                        AlertCenter.PublishAlert(new Alert($"issue-blocked-{b.Number}", AlertKind.IssueBlocked, seed.Sev,
                            $"#{b.Number} just got blocked", "labelled blocked", b.Title, primary, null, false));
                        AlertCenter.Celebrate(new Celebration($"whammy-{b.Number}", 2, Mood.Evil, CelebrationShape.Whammy, $"#{b.Number} BLOCKED"));
                    }
                }
                known = currentIds;
            }
            catch { }
            await DelayAsync(150, ct);
        }
    }

    // ── Agent bridge — chat_pinned_questions, real "Claude is waiting on you" state ───────────
    private static async Task RunPinnedQuestionsWatcherAsync(CancellationToken ct)
    {
        var client = ChatReadClient.CreateFromEnvironment();
        if (client == null) return;

        var alerted = new HashSet<int>();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var questions = await client.GetAllOpenPinnedQuestionsAsync();
                foreach (var q in questions)
                {
                    if (!alerted.Add(q.Id)) continue;
                    var seed = AlertCatalog.Seeds[AlertKind.ClaudeWaiting];
                    var title = string.IsNullOrWhiteSpace(q.ChatTitle) ? "Claude is waiting on you" : $"Claude is waiting on you — {q.ChatTitle}";
                    var conversationId = q.ConversationId;
                    var secondary = new AlertAction("Open the chat", () =>
                    {
                        AlertActions.OpenChatInBrowser?.Invoke(conversationId);
                        return Task.CompletedTask;
                    });
                    var alert = new Alert($"pinq-{q.Id}", AlertKind.ClaudeWaiting, seed.Sev, title,
                        $"pinned {FormatAge(q.CreatedAt)}", q.QuestionText, null, secondary, true)
                    {
                        OnReply = text => { AlertActions.AppendToComposer?.Invoke(text); return Task.CompletedTask; }
                    };
                    AlertCenter.PublishAlert(alert);
                }
                alerted.IntersectWith(questions.Select(q => q.Id));
            }
            catch { }
            await DelayAsync(75, ct);
        }
    }

    // ── Git watcher — GitHub Milestones API, real closed-milestone transitions ────────────────
    // Git #2235: tier-4 "Milestone Closed" mega-celebration. BuildConsole's own equivalent
    // (IssueChompAnimation.PlayMilestoneClosedParty) fires off a real "Close Milestone" button
    // click in LeftSidebar.xaml.cs; ShaneBuilder has no such in-app action, so a poll against the
    // real GitHub Milestones API is the right trigger here — same baseline-then-diff shape as
    // RunGitHubBlockedWatcherAsync above, which is also how "a restart doesn't refire" is
    // satisfied without extra on-disk state: the first poll after a (re)start only captures the
    // current closed set as the baseline, it never celebrates on it.
    private static async Task RunMilestoneWatcherAsync(CancellationToken ct)
    {
        var client = GitHubReadClient.CreateFromEnvironment();
        if (client == null) return;

        HashSet<int>? known = null;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var closed = await client.GetClosedMilestonesAsync();
                var currentIds = closed.Select(m => m.Number).ToHashSet();
                if (known != null)
                {
                    foreach (var m in closed.Where(m => !known.Contains(m.Number)))
                    {
                        var label = $"Milestone #{m.Number} — {m.Title}";
                        AlertCenter.Celebrate(new Celebration($"milestone-{m.Number}", 4, Mood.Good, CelebrationShape.Party, m.Title) { Label = label });
                    }
                }
                known = currentIds;
            }
            catch { /* a poll failing must never crash the watcher loop */ }
            await DelayAsync(120, ct);
        }
    }
}
