using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1779 — "Dispatch #___": a third door into the exact same
    /// <see cref="Services.BuildQueuePostgresClient.QueueBuildAsync"/> pipeline #1709's Batter
    /// Up panel and #1710's AI Batter Up panel already feed. Fetches one issue directly via
    /// <see cref="Services.GitHubApiClient.GetIssueAsync"/> — deliberately NOT filtered by
    /// board status, since typing a number and hitting Dispatch is itself the explicit
    /// approval — parses its `BUILD:` comment with #1709's existing
    /// <see cref="Services.BatterUpQueueService.FindBuildCommentAsync"/>, and queues it through
    /// the same client BatterUpPanel and BuildQueuePanel already use. Owns no launch logic of
    /// its own and never touches BatterUpPanel, AiBatterUpPanel, or BuildQueuePanel's own
    /// Queue/Send to Builder/Cancel actions.
    /// </summary>
    public partial class DispatchPanel : UserControl
    {
        private Services.BuildQueuePostgresClient? _db;
        private bool _dispatching;

        /// <summary>Fired after a successful direct dispatch so MainWindow can tell the
        /// sibling BuildQueuePanel to repaint — same "best-effort visual refresh" pattern
        /// BatterUpPanel.RowsAutoQueued already follows.</summary>
        public event EventHandler? Dispatched;

        public DispatchPanel()
        {
            InitializeComponent();
        }

        /// <summary>Mirrors BatterUpPanel.Initialize's shape — called once from MainWindow.</summary>
        public void Initialize(Services.BuildQueuePostgresClient? db)
        {
            _db = db;
        }

        private void TxtIssueNumber_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) _ = DispatchAsync();
        }

        private async void BtnDispatch_Click(object sender, RoutedEventArgs e) => await DispatchAsync();

        private void ShowStatus(string text, Brush brush)
        {
            TxtStatus.Text = text;
            TxtStatus.Foreground = brush;
            TxtStatus.Visibility = Visibility.Visible;
        }

        public async System.Threading.Tasks.Task DispatchAsync()
        {
            if (_dispatching) return;

            var raw = TxtIssueNumber.Text?.Trim().TrimStart('#') ?? "";
            if (!int.TryParse(raw, out var issueNumber) || issueNumber <= 0)
            {
                ShowStatus("Enter a valid issue number.", (Brush)Application.Current.FindResource("RedBrush"));
                return;
            }

            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ShowStatus("No GitHub PAT configured — set one in Settings.", (Brush)Application.Current.FindResource("RedBrush"));
                return;
            }

            _dispatching = true;
            BtnDispatch.IsEnabled = false;
            ShowStatus($"Fetching #{issueNumber}…", (Brush)Application.Current.FindResource("Subtext0Brush"));
            try
            {
                var gh = new Services.GitHubApiClient(settings.GitHubPat);

                // Fetched directly by number, deliberately bypassing GetBatterUpIssuesAsync's
                // board-status filter — this entry point exists precisely to skip that gate.
                Services.GitHubIssueDetail? issue;
                try
                {
                    issue = await gh.GetIssueAsync(issueNumber);
                }
                catch (Exception ex)
                {
                    ShowStatus($"Couldn't reach GitHub: {ex.Message}", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                if (issue == null)
                {
                    ShowStatus($"#{issueNumber} not found.", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                // Reuse #1709's own parser — not a second one.
                var (rawComment, parsed) = await Services.BatterUpQueueService.FindBuildCommentAsync(gh, issueNumber);
                if (rawComment == null || parsed == null)
                {
                    ShowStatus($"No build prompt found on #{issueNumber} yet.", (Brush)Application.Current.FindResource("RedBrush"));
                    Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} \"{issue.Title}\" — no BUILD: comment found, nothing queued.");
                    return;
                }

                var (model, effort, buildSet, prompt) = parsed.Value;

                var blockers = await gh.GetBlockedByAsync(issueNumber);
                var blockedByNumbers = blockers.Select(b => b.Number).ToList();
                var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();

                if (_db == null)
                {
                    ShowStatus("Not connected to the build queue database.", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                // Same dedup convention BatterUpQueueService follows — an already-tracked row
                // for this issue is reported rather than silently duplicated.
                var existing = await _db.FindDedupCandidateAsync(issueNumber, prompt);
                if (existing != null)
                {
                    ShowStatus($"#{issueNumber} is already tracked (status: {existing.Status}).", (Brush)Application.Current.FindResource("BlueBrush"));
                    return;
                }

                await _db.QueueBuildAsync(
                    title: issue.Title,
                    prompt: prompt,
                    model: model,
                    effort: effort,
                    cwd: null,
                    githubNumber: issueNumber,
                    blockedByNumbers: blockedByNumbers,
                    buildSet: buildSet);

                Services.ActivityLog.Log("dispatch",
                    $"Dispatch #{issueNumber} \"{issue.Title}\" — queued (model={model ?? "default"}, effort={effort ?? "default"}, buildSet={buildSet ?? "none"}" +
                    (blockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", blockedByNumbers)}" : "") + ").");

                // Fail-closed (#1600) governs launch, same as every other path — an open real
                // blocker holds it after queueing rather than refusing to queue it at all.
                if (openBlockedByNumbers.Count > 0)
                {
                    ShowStatus($"#{issueNumber} queued, but held — blocked by #{string.Join(", #", openBlockedByNumbers)}.",
                        (Brush)Application.Current.FindResource("RedBrush"));
                }
                else
                {
                    ShowStatus($"#{issueNumber} \"{issue.Title}\" queued.", (Brush)Application.Current.FindResource("GreenBrush"));
                }

                TxtIssueNumber.Text = "";
                try { Dispatched?.Invoke(this, EventArgs.Empty); }
                catch { /* best-effort visual refresh of the sibling queue panel */ }
            }
            catch (Exception ex)
            {
                ShowStatus($"Dispatch failed: {ex.Message}", (Brush)Application.Current.FindResource("RedBrush"));
                Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — FAILED: {ex.Message}");
            }
            finally
            {
                _dispatching = false;
                BtnDispatch.IsEnabled = true;
            }
        }
    }
}
