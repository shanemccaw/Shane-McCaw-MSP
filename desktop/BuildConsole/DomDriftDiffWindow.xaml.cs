using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class DomDriftDiffWindow : Window
    {
        private readonly string _baseUrl;
        private readonly string _pagePath;
        private readonly VisualTestTrackerDomBaseline? _baseline;
        private readonly DomPageObservation _live;
        private readonly List<DomMutationRecord> _drift;
        private VisualTestTrackerStore? _store;
        private readonly Action<List<DomMutationRecord>>? _onAttachToBug;

        /// <summary>Git #4442 — takes the live observation rather than a raw mutation list, and shows only
        /// real drift against <paramref name="baseline"/> (<see cref="DomBaselineDiff.ComputeDrift"/>, the same
        /// comparison the Test Mode page auto-check banner uses) instead of every mutation that fired.</summary>
        public DomDriftDiffWindow(
            string baseUrl,
            string pagePath,
            VisualTestTrackerDomBaseline? baseline,
            DomPageObservation live,
            VisualTestTrackerStore? store = null,
            Action<List<DomMutationRecord>>? onAttachToBug = null)
        {
            InitializeComponent();
            _baseUrl = baseUrl;
            _pagePath = pagePath;
            _baseline = baseline;
            _live = live ?? new DomPageObservation();
            _drift = DomBaselineDiff.ComputeDrift(baseline, _live);
            _store = store;
            _onAttachToBug = onAttachToBug;

            PopulateDriftData();
        }

        private void PopulateDriftData()
        {
            TxtPageRoute.Text = $"Route: {(!string.IsNullOrWhiteSpace(_baseUrl) ? _baseUrl : "")}{_pagePath}";
            string observed = $"live DOM observed {_live.ObservedAt:HH:mm:ss} ({_live.Mutations.Count} mutation(s))";
            if (_baseline != null)
            {
                int age = _baseline.AgeInDays;
                TxtBaselineAge.Text = $"Baseline recorded: {age} day(s) ago ({_baseline.LastVerifiedAt:yyyy-MM-dd HH:mm}) — {observed}";
            }
            else
            {
                TxtBaselineAge.Text = $"Baseline recorded: Initial verification — {observed}";
            }

            int addedCount = 0;
            int modifiedCount = 0;
            int removedCount = 0;

            var vms = new List<DomDriftItemViewModel>();

            foreach (var mut in _drift)
            {
                string action = (mut.Action ?? "").ToLowerInvariant();

                // Was `|| type.Contains("childlist")`, which counted every childList removal as Added.
                if (action.Contains("added")) addedCount++;
                else if (action.Contains("removed")) removedCount++;
                else modifiedCount++;

                vms.Add(new DomDriftItemViewModel(mut));
            }

            LstDriftItems.ItemsSource = vms;

            TxtTotalDrift.Text = $"{_drift.Count} Total Drifts";
            TxtAddedCount.Text = $"{addedCount} Added";
            TxtModifiedCount.Text = $"{modifiedCount} Modified";
            TxtRemovedCount.Text = $"{removedCount} Removed";
        }

        private async void BtnAcceptUpdateBaseline_Click(object sender, RoutedEventArgs e)
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
                // Accepting adds the live mutations to what the baseline already knows and takes the live
                // structure as the new snapshot — accepting today's drift must not forget yesterday's.
                var newBaseline = DomBaselineDiff.MergeIntoBaseline(_baseline, _live, _baseUrl, _pagePath);
                try
                {
                    await _store.SaveDomBaselineOrThrowAsync(newBaseline);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(VisualTestTrackerStore.Channel, $"Accept DOM baseline failed: {ex.Message}");
                    MessageBox.Show($"The DOM baseline was NOT updated: {ex.Message}", "Store Error", MessageBoxButton.OK, MessageBoxImage.Error);
                    return;
                }
                PageAutoCheckService.RecordAcceptedBaseline(_baseUrl, _pagePath, newBaseline);
                MessageBox.Show($"DOM baseline for {_baseUrl}{_pagePath} has been updated to current live state.", "Baseline Updated", MessageBoxButton.OK, MessageBoxImage.Information);
                DialogResult = true;
                Close();
            }
            else
            {
                MessageBox.Show("Unable to connect to database store to update baseline.", "Store Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnCreateBugReport_Click(object sender, RoutedEventArgs e)
        {
            _onAttachToBug?.Invoke(_drift);
            DialogResult = false;
            Close();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }

    public class DomDriftItemViewModel
    {
        public DomMutationRecord Record { get; }

        public DomDriftItemViewModel(DomMutationRecord record)
        {
            Record = record;
        }

        public string Tag => !string.IsNullOrWhiteSpace(Record.Tag) ? Record.Tag.ToLowerInvariant() : "element";
        public string Selector => !string.IsNullOrWhiteSpace(Record.Selector) ? Record.Selector : "N/A";
        public string Timestamp => !string.IsNullOrWhiteSpace(Record.Timestamp) ? Record.Timestamp : DateTime.Now.ToString("HH:mm:ss");

        public string ActionDisplay
        {
            get
            {
                string act = (Record.Action ?? "").ToUpperInvariant();
                if (string.IsNullOrWhiteSpace(act)) act = "MUTATION";
                return act;
            }
        }

        public Brush ActionBadgeColor
        {
            get
            {
                string act = (Record.Action ?? "").ToLowerInvariant();
                if (act.Contains("added")) return new SolidColorBrush(Color.FromRgb(34, 197, 94)); // Green
                if (act.Contains("removed")) return new SolidColorBrush(Color.FromRgb(239, 68, 68)); // Red
                return new SolidColorBrush(Color.FromRgb(234, 179, 8)); // Yellow/Gold
            }
        }

        public string Description
        {
            get
            {
                if (!string.IsNullOrWhiteSpace(Record.TargetDescription)) return Record.TargetDescription;
                if (!string.IsNullOrWhiteSpace(Record.AttributeName)) return $"Attribute '{Record.AttributeName}' modified";
                return "DOM Mutation recorded";
            }
        }

        public string OldValue => Record.OldValue ?? "";
        public string NewValue => Record.NewValue ?? "";

        public Visibility HasValueDiffVisibility =>
            (!string.IsNullOrWhiteSpace(OldValue) || !string.IsNullOrWhiteSpace(NewValue))
                ? Visibility.Visible
                : Visibility.Collapsed;
    }
}
