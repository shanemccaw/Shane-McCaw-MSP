using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3518 — the click-through detail behind the persistent "N builds were auto-reconciled" toast.
    /// Reads the persisted <see cref="ReconciliationNoticeStore"/> and lists every real row
    /// <see cref="FalseDoneReconciler"/> acted on (newest first), each traceable to its real GitHub issue
    /// with the exact action taken and why. Opening this window is Shane actually SEEING the summary, so
    /// it marks every notice seen — that is what stops the startup replay from re-nagging about the same
    /// items after he has reviewed them.
    /// </summary>
    public partial class ReconciliationDetailWindow : Window
    {
        private const string RepoSlug = "shanemccaw/Shane-McCaw-MSP";

        /// <summary>View-model for one row. Brushes are resolved once, in code, so the DataTemplate can
        /// bind them directly without a converter.</summary>
        public sealed class Row
        {
            public int IssueNumber { get; set; }
            public string IssueLabel => "#" + IssueNumber;
            public string ActionLabel { get; set; } = "";
            public string When { get; set; } = "";
            public string Reason { get; set; } = "";
            public Brush Accent { get; set; } = Brushes.SteelBlue;
        }

        public ReconciliationDetailWindow()
        {
            InitializeComponent();

            var all = ReconciliationNoticeStore.GetAll();
            var rows = all.Select(ToRow).ToList();
            ItemsList.ItemsSource = rows;
            SummaryText.Text = BuildSummary(all);

            // Opening the detail view = Shane has now seen these. Persisted immediately so a restart
            // won't replay them again.
            ReconciliationNoticeStore.MarkAllSeen();

            WindowStartupLocation = WindowStartupLocation.CenterOwner;
        }

        /// <summary>Human summary line, e.g. "31 builds auto-reconciled — 2 reverted to verifying,
        /// 29 reset for re-dispatch." Uses the same buckets the toast shows.</summary>
        public static string BuildSummary(IReadOnlyList<ReconciliationNotice> notices)
        {
            if (notices == null || notices.Count == 0)
                return "No auto-reconciled builds recorded.";

            int reverted = notices.Count(n => n.Kind == ReconciliationActionKind.FalseDoneReverted);
            int reset = notices.Count(n => n.Kind == ReconciliationActionKind.FalseDoneReset
                                        || n.Kind == ReconciliationActionKind.BlockedReset);
            int cleared = notices.Count(n => n.Kind == ReconciliationActionKind.StaleCanceledResolved);
            int archived = notices.Count(n => n.Kind == ReconciliationActionKind.CanceledArchivedClosedIssue
                                            || n.Kind == ReconciliationActionKind.CanceledArchivedNoIssue);

            var parts = new List<string>();
            if (reverted > 0) parts.Add($"{reverted} reverted to verifying");
            if (reset > 0) parts.Add($"{reset} reset for re-dispatch");
            if (cleared > 0) parts.Add($"{cleared} stale canceled cleared (issue closed)");
            if (archived > 0) parts.Add($"{archived} canceled row(s) archived");

            string tail = parts.Count > 0 ? " — " + string.Join(", ", parts) + "." : ".";
            return $"{notices.Count} build{(notices.Count == 1 ? "" : "s")} were auto-reconciled by the "
                 + "false-done safety pass (they were NOT relaunched)" + tail;
        }

        private static Row ToRow(ReconciliationNotice n) => new Row
        {
            IssueNumber = n.IssueNumber,
            ActionLabel = n.ActionLabel,
            When = ToLocalWhen(n.TimestampUtc),
            Reason = n.Reason,
            Accent = AccentFor(n.Kind),
        };

        private static string ToLocalWhen(DateTime utc)
        {
            try
            {
                var local = (utc.Kind == DateTimeKind.Utc ? utc : DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToLocalTime();
                return local.ToString("MMM d, h:mm tt");
            }
            catch { return utc.ToString("u"); }
        }

        private static Brush AccentFor(ReconciliationActionKind kind)
        {
            string key = kind switch
            {
                // A revert means the work genuinely landed — it just wasn't closed. Least alarming (green).
                ReconciliationActionKind.FalseDoneReverted => "GreenBrush",
                // Both resets mean real, dispatched work was cancelled back to re-dispatchable — the
                // trust-sensitive case the issue is about. Peach (warning).
                _ => "PeachBrush",
            };
            try { return (Brush)Application.Current.FindResource(key); }
            catch { return Brushes.SteelBlue; }
        }

        private void OpenIssue_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button b || b.Tag is not int number || number <= 0) return;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = $"https://github.com/{RepoSlug}/issues/{number}",
                    UseShellExecute = true
                });
            }
            catch { /* opening a browser must never crash the dialog */ }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();
    }
}
