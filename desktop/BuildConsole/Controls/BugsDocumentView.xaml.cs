using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public partial class BugsDocumentView : UserControl
    {
        private VisualTestTrackerStore? _store;
        private Action<string>? _navigateToUrlHandler;
        private List<VisualTestTrackerEntry> _allEntries = new();
        private VisualTestTrackerEntry? _selectedEntry;
        private bool _suppressDesignCheckboxEvent;

        /// <summary>Git #4160 — false until the constructor finishes. WPF's XamlObjectWriter assigns
        /// named (x:Name) fields in document order as it parses; RadioFilterOpen is IsChecked="True" by
        /// default and is declared before LstBugs in BugsDocumentView.xaml, so its Checked event (wired
        /// to Filter_Changed → ApplyFilters) fires mid-InitializeComponent, while LstBugs is still null.
        /// Filter_Changed no-ops until this flips true at the end of the constructor.</summary>
        private bool _initialized;

        /// <summary>Git #3982 — Reject packages the entry's real evidence (screenshots, console/network
        /// logs, repro steps — via <see cref="VisualTestTrackerEntry.ToMarkdown"/>, the same builder
        /// already used for GitHub/Jira-ready export) and raises this instead of calling GitHub. The
        /// owning MainWindow wires it to the shared #937 <c>SendTextToActiveClaudeChatAsync</c> path —
        /// the same one the SQL Runner (#940) and Log Viewer (#2786) already use — so Shane reviews and
        /// sends it himself from whichever epic chat is active. This view never calls a GitHub API.</summary>
        public event EventHandler<string>? SendToChatRequested;

        public BugsDocumentView()
        {
            InitializeComponent();
            _initialized = true;
        }

        public void Initialize(VisualTestTrackerStore store, Action<string>? navigateToUrlHandler = null)
        {
            _store = store;
            _navigateToUrlHandler = navigateToUrlHandler;
            _ = RefreshBugsAsync();
        }

        public async Task RefreshBugsAsync()
        {
            if (_store == null)
            {
                var connStr = VisualTestTrackerStore.ResolveConnectionString();
                if (!string.IsNullOrWhiteSpace(connStr))
                {
                    _store = new VisualTestTrackerStore(connStr);
                }
            }

            if (_store != null)
            {
                await _store.ReconcileGitIssueSyncAsync();
                _allEntries = await _store.ListAllBugsAsync();
            }
            else
            {
                _allEntries = new List<VisualTestTrackerEntry>();
            }

            PopulateDropdowns();
            ApplyFilters();
        }

        private async void BtnCleanFiles_Click(object sender, RoutedEventArgs e)
        {
            BtnCleanFiles.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCleanup.RunCleanupAsync(_store);
                BdrBanner.Visibility = Visibility.Visible;
                TxtBanner.Text = $"🧹 Disk Cleanup Completed: {result.SummaryDisplay}";
                await RefreshBugsAsync();
            }
            finally
            {
                BtnCleanFiles.IsEnabled = true;
            }
        }

        private void PopulateDropdowns()
        {
            var sites = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "All Sites" };
            var epics = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "All Epics" };

            foreach (var e in _allEntries)
            {
                if (!string.IsNullOrWhiteSpace(e.SiteName)) sites.Add(e.SiteName);
                if (!string.IsNullOrWhiteSpace(e.EpicName)) epics.Add(e.EpicName);
            }

            ComboSiteFilter.ItemsSource = sites.ToList();
            ComboSiteFilter.SelectedIndex = 0;

            ComboEpicFilter.ItemsSource = epics.ToList();
            ComboEpicFilter.SelectedIndex = 0;
        }

        private void ApplyFilters()
        {
            string search = TxtSearch?.Text?.Trim().ToLowerInvariant() ?? "";
            string selSite = ComboSiteFilter?.SelectedItem as string ?? "All Sites";
            string selEpic = ComboEpicFilter?.SelectedItem as string ?? "All Epics";

            bool openOnly = RadioFilterOpen?.IsChecked == true;
            bool verifyingOnly = RadioFilterVerifying?.IsChecked == true;
            bool closedOnly = RadioFilterClosed?.IsChecked == true;
            bool designOnly = ChkDesignOnly?.IsChecked == true;

            var filtered = _allEntries.Where(e =>
            {
                // Design Filter (Git #3982) — "shows every is_design = true bug regardless of its
                // status," Shane's own words. Deliberately bypasses the status radios entirely: a
                // design-flagged bug stays Open indefinitely and isn't part of the Open/Verifying/Closed
                // engineering lifecycle, so this filter is the one place status doesn't gate visibility.
                if (designOnly)
                {
                    if (!e.IsDesign) return false;
                }
                else
                {
                    // Status Filter (Default Open)
                    if (openOnly && !string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase))
                        return false;
                    if (verifyingOnly && !string.Equals(e.Status, "Verifying", StringComparison.OrdinalIgnoreCase))
                        return false;
                    if (closedOnly && !string.Equals(e.Status, "Closed", StringComparison.OrdinalIgnoreCase))
                        return false;
                }

                // Site Filter
                if (!string.Equals(selSite, "All Sites", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(e.SiteName, selSite, StringComparison.OrdinalIgnoreCase))
                    return false;

                // Epic Filter
                if (!string.Equals(selEpic, "All Epics", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(e.EpicName, selEpic, StringComparison.OrdinalIgnoreCase))
                    return false;

                // Search Filter
                if (!string.IsNullOrEmpty(search))
                {
                    string bugNumStr = $"bug-{e.BugNumber}";
                    string gitIssueStr = e.GitIssueNumber.HasValue ? $"#{e.GitIssueNumber.Value}" : "";
                    bool matchesText = (e.Title ?? "").ToLowerInvariant().Contains(search) ||
                                       (e.Notes ?? "").ToLowerInvariant().Contains(search) ||
                                       (e.SiteName ?? "").ToLowerInvariant().Contains(search) ||
                                       (e.EpicName ?? "").ToLowerInvariant().Contains(search) ||
                                       bugNumStr.Contains(search) ||
                                       gitIssueStr.Contains(search);
                    if (!matchesText) return false;
                }

                return true;
            }).ToList();

            var vms = filtered.ConvertAll(e => new BugItemViewModel(e));
            LstBugs.ItemsSource = vms;
            TxtBugCount.Text = $"{filtered.Count} Bugs ({_allEntries.Count} total)";

            if (filtered.Count == 0)
            {
                PnlBugDetails.Visibility = Visibility.Collapsed;
                TxtEmptyDetail.Visibility = Visibility.Visible;
                TxtEmptyDetail.Text = "No bugs match the current status/site/epic filter criteria.";
            }
        }

        private void Filter_Changed(object sender, RoutedEventArgs e)
        {
            if (!_initialized) return;
            ApplyFilters();
        }

        /// <summary>Git #3982 — reports the real Send-to-Chat outcome (same pattern as SqlDocumentView's
        /// own ShowSendStatus) back on this view's own banner, since Reject's evidence hand-off happens
        /// asynchronously after the status flip already showed its own banner text.</summary>
        public void ShowSendStatus(string message)
        {
            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = message;
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e)
        {
            await RefreshBugsAsync();
        }

        private void LstBugs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (LstBugs.SelectedItem is BugItemViewModel vm)
            {
                DisplayBugDetail(vm.Entry);
            }
        }

        private void DisplayBugDetail(VisualTestTrackerEntry entry)
        {
            _selectedEntry = entry;
            TxtEmptyDetail.Visibility = Visibility.Collapsed;
            PnlBugDetails.Visibility = Visibility.Visible;

            TxtDetailBugNum.Text = entry.BugNumber > 0 ? $"BUG-{entry.BugNumber}" : $"BUG-{entry.Id}";
            TxtDetailSeverity.Text = (entry.Severity ?? "BUG").ToUpperInvariant();
            TxtDetailStatus.Text = (entry.Status ?? "OPEN").ToUpperInvariant();

            string titleStr = !string.IsNullOrWhiteSpace(entry.Title)
                ? entry.Title
                : (!string.IsNullOrWhiteSpace(entry.Notes) ? entry.Notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0] : "Visual Bug");
            TxtDetailTitle.Text = titleStr;

            string siteEpicStr = "Site / Epic: ";
            siteEpicStr += !string.IsNullOrWhiteSpace(entry.SiteName) ? entry.SiteName : "Default Site";
            siteEpicStr += " / ";
            siteEpicStr += !string.IsNullOrWhiteSpace(entry.EpicName) ? entry.EpicName : "General";
            if (!string.IsNullOrWhiteSpace(entry.PagePath)) siteEpicStr += $" · Route: {entry.PagePath}";
            TxtDetailMeta.Text = siteEpicStr;

            TxtGitIssueInput.Text = entry.GitIssueNumber.HasValue ? entry.GitIssueNumber.Value.ToString() : "";
            TxtDetailNotes.Text = entry.Notes ?? "";
            TxtDetailSteps.Text = entry.StepsToReproduce ?? "";
            TxtDetailExpected.Text = entry.ExpectedBehavior ?? "";
            TxtDetailActual.Text = entry.ActualBehavior ?? "";

            // Format diagnostics log
            var diagLines = new List<string>();
            if (!string.IsNullOrWhiteSpace(entry.CurrentUrl)) diagLines.Add($"URL: {entry.CurrentUrl}");
            if (entry.ConsoleLogs != null && entry.ConsoleLogs.Count > 0)
                diagLines.Add($"Console Errors ({entry.ConsoleLogs.Count}): {entry.ConsoleLogs[0].Message}");
            if (entry.NetworkFailures != null && entry.NetworkFailures.Count > 0)
                diagLines.Add($"Network Failures ({entry.NetworkFailures.Count}): {entry.NetworkFailures[0].Url} [{entry.NetworkFailures[0].Status}]");
            if (entry.ReproductionEvents != null && entry.ReproductionEvents.Count > 0)
                diagLines.Add($"Reproduction Events Recorded: {entry.ReproductionEvents.Count} steps");

            TxtDetailDiagnostics.Text = diagLines.Count > 0 ? string.Join("\n", diagLines) : "No diagnostic issues attached.";

            // Git #3982 — Confirm/Reject are only ever meaningful on a Verifying row (the issue's own
            // enablement rule); Mark-as-Verifying/Re-open are the manual entry/exit points for the two
            // ends of that lifecycle until the real dispatch-driven auto-transition (#TBD8) lands.
            bool isOpen = string.Equals(entry.Status, "Open", StringComparison.OrdinalIgnoreCase);
            bool isVerifying = string.Equals(entry.Status, "Verifying", StringComparison.OrdinalIgnoreCase);
            bool isClosed = string.Equals(entry.Status, "Closed", StringComparison.OrdinalIgnoreCase);
            BtnMarkVerifying.Visibility = isOpen ? Visibility.Visible : Visibility.Collapsed;
            BtnConfirmFixed.Visibility = isVerifying ? Visibility.Visible : Visibility.Collapsed;
            BtnReject.Visibility = isVerifying ? Visibility.Visible : Visibility.Collapsed;
            BtnReopen.Visibility = isClosed ? Visibility.Visible : Visibility.Collapsed;

            if (!string.IsNullOrWhiteSpace(entry.ResolutionReason))
            {
                string resolutionLabel = entry.Resolution == "NotABug" ? "Not a Bug" : entry.Resolution ?? "";
                TxtDetailResolution.Text = $"{resolutionLabel}: {entry.ResolutionReason}";
                TxtDetailResolution.Visibility = Visibility.Visible;
            }
            else
            {
                TxtDetailResolution.Text = "";
                TxtDetailResolution.Visibility = Visibility.Collapsed;
            }

            _suppressDesignCheckboxEvent = true;
            ChkIsDesign.IsChecked = entry.IsDesign;
            _suppressDesignCheckboxEvent = false;

            BdrBanner.Visibility = Visibility.Collapsed;
        }

        private async void BtnSaveGitIssue_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || _store == null) return;

            int? gitNum = null;
            if (int.TryParse(TxtGitIssueInput.Text.Trim().TrimStart('#'), out int parsed))
            {
                gitNum = parsed;
            }

            _selectedEntry.GitIssueNumber = gitNum;
            await _store.UpdateGitIssueNumberAsync(_selectedEntry.EntryUuid, gitNum);

            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = gitNum.HasValue
                ? $"✅ Updated Git Issue number to #{gitNum.Value} for BUG-{_selectedEntry.BugNumber}."
                : $"✅ Removed Git Issue association for BUG-{_selectedEntry.BugNumber}.";

            ApplyFilters();
        }

        private async Task SetStatusAsync(string newStatus, string? newResolution, string bannerText)
        {
            if (_selectedEntry == null || _store == null) return;

            _selectedEntry.Status = newStatus;
            _selectedEntry.Resolution = newResolution;
            _selectedEntry.ResolutionReason = null;
            await _store.UpdateEntryStatusAsync(_selectedEntry.EntryUuid, newStatus, newResolution, null);

            DisplayBugDetail(_selectedEntry);

            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = bannerText;

            ApplyFilters();
        }

        /// <summary>Git #3982 — manual Open → Verifying entry point (the real automatic dispatch-driven
        /// transition is a later child issue, #TBD8, not built yet).</summary>
        private async void BtnMarkVerifying_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || !string.Equals(_selectedEntry.Status, "Open", StringComparison.OrdinalIgnoreCase)) return;
            await SetStatusAsync("Verifying", null, "Status updated to VERIFYING.");
        }

        /// <summary>Git #3982 — Confirm: only meaningful on a Verifying row. Closed/Fixed.</summary>
        private async void BtnConfirmFixed_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || !string.Equals(_selectedEntry.Status, "Verifying", StringComparison.OrdinalIgnoreCase)) return;
            await SetStatusAsync("Closed", "Fixed", "Confirmed fixed — status updated to CLOSED.");
        }

        /// <summary>Git #3982 — Re-open: manual Closed → Open override (e.g. correcting a wrong Confirm
        /// or Not-a-Bug). Plain status flip, no evidence packaging, no GitHub call.</summary>
        private async void BtnReopen_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || !string.Equals(_selectedEntry.Status, "Closed", StringComparison.OrdinalIgnoreCase)) return;
            await SetStatusAsync("Open", null, "Re-opened — status updated to OPEN.");
        }

        /// <summary>Git #3982 — Reject: only meaningful on a Verifying row. Real, explicit non-goal per
        /// the issue: this NEVER calls any GitHub API. It sets status back to Open, then packages the
        /// entry's real captured evidence (screenshots, console/network logs, repro steps — via
        /// <see cref="VisualTestTrackerEntry.ToMarkdown"/>) and raises <see cref="SendToChatRequested"/>
        /// so the owning MainWindow hands it to the shared #937 send-to-active-chat path. A real person
        /// (Claude, in that chat) is the one who decides what's actually wrong and reopens/comments on
        /// the GitHub issue with its own tools — this view has no GitHub client anywhere in it.</summary>
        private async void BtnReject_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || _store == null) return;
            if (!string.Equals(_selectedEntry.Status, "Verifying", StringComparison.OrdinalIgnoreCase)) return;

            var entry = _selectedEntry;
            await SetStatusAsync("Open", null, "Rejected — reopened and evidence sent to chat for review.");

            string issueRef = entry.GitIssueNumber.HasValue ? $" (GitHub #{entry.GitIssueNumber.Value})" : "";
            string preamble =
                $"🔴 **Rejected from Verifying** — BUG-{(entry.BugNumber > 0 ? entry.BugNumber : entry.Id)}{issueRef} was reviewed and is NOT actually fixed. " +
                "Reopened locally (status = Open). Real captured evidence below — please look into it and, if warranted, reopen/comment on the GitHub issue yourself.\n\n";
            string evidence = preamble + entry.ToMarkdown();
            SendToChatRequested?.Invoke(this, evidence);
        }

        private async void BtnMarkNotABug_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || _store == null) return;

            string? reason = SimpleTextPromptDialog.Show(this, "Not a Bug",
                $"Why is “BUG-{(_selectedEntry.BugNumber > 0 ? _selectedEntry.BugNumber : _selectedEntry.Id)}” not a bug? A reason is required.");
            if (string.IsNullOrWhiteSpace(reason)) return;

            _selectedEntry.Status = "Closed";
            _selectedEntry.Resolution = "NotABug";
            _selectedEntry.ResolutionReason = reason.Trim();
            await _store.UpdateEntryStatusAsync(_selectedEntry.EntryUuid, "Closed", "NotABug", reason.Trim());

            DisplayBugDetail(_selectedEntry);

            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = "Marked as Not a Bug.";

            ApplyFilters();
        }

        private async void ChkIsDesign_Changed(object sender, RoutedEventArgs e)
        {
            if (_suppressDesignCheckboxEvent || _selectedEntry == null || _store == null) return;

            bool isDesign = ChkIsDesign.IsChecked == true;
            _selectedEntry.IsDesign = isDesign;
            await _store.UpdateEntryDesignFlagAsync(_selectedEntry.EntryUuid, isDesign);
        }

        private void BtnRerunTest_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null) return;

            string url = !string.IsNullOrWhiteSpace(_selectedEntry.CurrentUrl)
                ? _selectedEntry.CurrentUrl
                : $"{_selectedEntry.BaseUrl}{_selectedEntry.PagePath}";

            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = $"▶ Navigating to {url} to re-run test verification for BUG-{_selectedEntry.BugNumber}...";

            if (!string.IsNullOrWhiteSpace(url) && _navigateToUrlHandler != null)
            {
                _navigateToUrlHandler.Invoke(url);
            }
        }
    }

    public class BugItemViewModel
    {
        public VisualTestTrackerEntry Entry { get; }

        public BugItemViewModel(VisualTestTrackerEntry entry)
        {
            Entry = entry;
        }

        public int BugNumber => Entry.BugNumber > 0 ? Entry.BugNumber : Entry.Id;
        public int? GitIssueNumber => Entry.GitIssueNumber;
        public bool HasGitIssue => Entry.GitIssueNumber.HasValue;
        public string Severity => Entry.Severity ?? "Bug";
        public string Status => Entry.Status ?? "Open";

        public string DisplayTitle => !string.IsNullOrWhiteSpace(Entry.Title)
            ? Entry.Title
            : (!string.IsNullOrWhiteSpace(Entry.Notes) ? Entry.Notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0] : "Visual Observation");

        public string SiteEpicSummary => $"{(!string.IsNullOrWhiteSpace(Entry.SiteName) ? Entry.SiteName : "Default Site")} / {(!string.IsNullOrWhiteSpace(Entry.EpicName) ? Entry.EpicName : "General")}";

        public DateTime CreatedAt => Entry.CreatedAt;
    }
}
