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
        private readonly List<DomMutationRecord> _liveMutations;
        private VisualTestTrackerStore? _store;
        private readonly Action<List<DomMutationRecord>>? _onAttachToBug;

        public DomDriftDiffWindow(
            string baseUrl,
            string pagePath,
            VisualTestTrackerDomBaseline? baseline,
            List<DomMutationRecord> liveMutations,
            VisualTestTrackerStore? store = null,
            Action<List<DomMutationRecord>>? onAttachToBug = null)
        {
            InitializeComponent();
            _baseUrl = baseUrl;
            _pagePath = pagePath;
            _baseline = baseline;
            _liveMutations = liveMutations ?? new List<DomMutationRecord>();
            _store = store;
            _onAttachToBug = onAttachToBug;

            PopulateDriftData();
        }

        private void PopulateDriftData()
        {
            TxtPageRoute.Text = $"Route: {(!string.IsNullOrWhiteSpace(_baseUrl) ? _baseUrl : "")}{_pagePath}";
            if (_baseline != null)
            {
                int age = _baseline.AgeInDays;
                TxtBaselineAge.Text = $"Baseline recorded: {age} day(s) ago ({_baseline.LastVerifiedAt:yyyy-MM-dd HH:mm})";
            }
            else
            {
                TxtBaselineAge.Text = "Baseline recorded: Initial verification";
            }

            int addedCount = 0;
            int modifiedCount = 0;
            int removedCount = 0;

            var vms = new List<DomDriftItemViewModel>();

            foreach (var mut in _liveMutations)
            {
                string action = (mut.Action ?? "").ToLowerInvariant();
                string type = (mut.Type ?? "").ToLowerInvariant();

                if (action.Contains("added") || type.Contains("childlist")) addedCount++;
                else if (action.Contains("removed")) removedCount++;
                else modifiedCount++;

                vms.Add(new DomDriftItemViewModel(mut));
            }

            LstDriftItems.ItemsSource = vms;

            TxtTotalDrift.Text = $"{_liveMutations.Count} Total Drifts";
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
                var newBaseline = new VisualTestTrackerDomBaseline
                {
                    BaseUrl = _baseUrl,
                    PagePath = _pagePath,
                    Mutations = _liveMutations,
                    LastVerifiedAt = DateTime.Now,
                    UpdatedAt = DateTime.Now
                };
                await _store.SaveDomBaselineAsync(newBaseline);
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
            _onAttachToBug?.Invoke(_liveMutations);
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
