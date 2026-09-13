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

        public BugsDocumentView()
        {
            InitializeComponent();
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
                _allEntries = await _store.ListAllBugsAsync();
            }
            else
            {
                _allEntries = new List<VisualTestTrackerEntry>();
            }

            PopulateDropdowns();
            ApplyFilters();
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
            bool closedOnly = RadioFilterClosed?.IsChecked == true;

            var filtered = _allEntries.Where(e =>
            {
                // Status Filter (Default Open)
                if (openOnly && !string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (closedOnly && string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase))
                    return false;

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
            ApplyFilters();
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

            BtnToggleStatus.Content = string.Equals(entry.Status, "Resolved", StringComparison.OrdinalIgnoreCase) ? "Re-open Bug" : "Mark as Resolved";
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

        private async void BtnToggleStatus_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedEntry == null || _store == null) return;

            string newStatus = string.Equals(_selectedEntry.Status, "Resolved", StringComparison.OrdinalIgnoreCase) ? "Open" : "Resolved";
            _selectedEntry.Status = newStatus;
            await _store.UpdateEntryStatusAsync(_selectedEntry.EntryUuid, newStatus);

            DisplayBugDetail(_selectedEntry);

            BdrBanner.Visibility = Visibility.Visible;
            TxtBanner.Text = $"Status updated to {newStatus.ToUpperInvariant()}.";

            ApplyFilters();
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
