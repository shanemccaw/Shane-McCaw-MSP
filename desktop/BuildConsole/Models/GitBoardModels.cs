using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Media;

namespace BuildConsole.Models
{
    public class GitBoardViewModel : ObservableModelBase
    {
        private string _searchQuery = "";
        private bool _isEpicsExpanded = true;
        private WorkingBannerModel? _workingBanner;
        private MilestoneSummaryModel? _milestoneSummary;
        private GateBannerModel? _gateBanner;

        public string SearchQuery
        {
            get => _searchQuery;
            set
            {
                if (_searchQuery != value)
                {
                    _searchQuery = value;
                    OnPropertyChanged();
                    FilterItems();
                }
            }
        }

        public bool IsEpicsExpanded
        {
            get => _isEpicsExpanded;
            set
            {
                if (_isEpicsExpanded != value)
                {
                    _isEpicsExpanded = value;
                    OnPropertyChanged();
                }
            }
        }

        public WorkingBannerModel? WorkingBanner
        {
            get => _workingBanner;
            set { if (_workingBanner != value) { _workingBanner = value; OnPropertyChanged(); } }
        }

        public MilestoneSummaryModel? MilestoneSummary
        {
            get => _milestoneSummary;
            set { if (_milestoneSummary != value) { _milestoneSummary = value; OnPropertyChanged(); } }
        }

        public GateBannerModel? GateBanner
        {
            get => _gateBanner;
            set { if (_gateBanner != value) { _gateBanner = value; OnPropertyChanged(); } }
        }

        public ObservableCollection<GitBoardEpicModel> Epics { get; } = new();
        public ObservableCollection<GitBoardEpicModel> FilteredEpics { get; } = new();

        public int TotalEpicsCount => Epics.Count;

        public void RefreshFilteredEpics()
        {
            FilterItems();
            OnPropertyChanged(nameof(TotalEpicsCount));
        }

        private void FilterItems()
        {
            FilteredEpics.Clear();
            string q = _searchQuery?.Trim() ?? "";

            foreach (var epic in Epics)
            {
                if (string.IsNullOrEmpty(q))
                {
                    epic.ResetFilter();
                    FilteredEpics.Add(epic);
                }
                else
                {
                    bool epicMatches = epic.Title.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                                       epic.Number.ToString().Contains(q, StringComparison.OrdinalIgnoreCase);

                    bool anyFeatureMatches = epic.ApplyFilter(q);

                    if (epicMatches || anyFeatureMatches)
                    {
                        FilteredEpics.Add(epic);
                    }
                }
            }
        }
    }

    public class WorkingBannerModel : ObservableModelBase
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string DisplayText => $"WORKING: #{Number} — {Title}";
    }

    public class MilestoneSummaryModel : ObservableModelBase
    {
        public int? Number { get; set; }
        public string Title { get; set; } = "v1.1 - Monitoring & Launch";
        public double ProgressPercent { get; set; } = 60.0;
        public string RatioText { get; set; } = "96/158";
        public string ProgressDisplay => $"{ProgressPercent:F0}% ({RatioText})";
    }

    public class GateBannerModel : ObservableModelBase
    {
        public int Number { get; set; }
        public string HeaderText { get; set; } = "GATE · BLOCKS RELEASE";
        public string SubtitleText { get; set; } = "Validating Prerequisites";
        public string FractionText { get; set; } = "7/8";
    }

    public class GitBoardEpicModel : ObservableModelBase
    {
        private bool _isExpanded;
        private bool _isWorking;

        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string NumberDisplay => $"#{Number}";
        public double ProgressPercent { get; set; }
        public string ProgressText { get; set; } = "0% (0/0)";
        public string ColorHex { get; set; } = "#FAB387";
        public object? RawData { get; set; }

        public bool IsExpanded
        {
            get => _isExpanded;
            set
            {
                if (_isExpanded != value)
                {
                    _isExpanded = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(ChevronIcon));
                }
            }
        }

        public string ChevronIcon => IsExpanded ? "▾" : "▸";

        public bool IsWorking
        {
            get => _isWorking;
            set
            {
                if (_isWorking != value)
                {
                    _isWorking = value;
                    OnPropertyChanged();
                }
            }
        }

        public ObservableCollection<GitBoardFeatureModel> Features { get; } = new();
        public ObservableCollection<GitBoardFeatureModel> FilteredFeatures { get; } = new();

        public void ResetFilter()
        {
            FilteredFeatures.Clear();
            foreach (var f in Features)
            {
                f.ResetFilter();
                FilteredFeatures.Add(f);
            }
        }

        public bool ApplyFilter(string query)
        {
            FilteredFeatures.Clear();
            bool anyMatch = false;

            foreach (var f in Features)
            {
                bool featureMatches = f.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                      f.Number.ToString().Contains(query, StringComparison.OrdinalIgnoreCase);

                bool childMatches = f.ApplyFilter(query);

                if (featureMatches || childMatches)
                {
                    FilteredFeatures.Add(f);
                    anyMatch = true;
                }
            }

            if (anyMatch)
            {
                IsExpanded = true;
            }

            return anyMatch;
        }
    }

    public class GitBoardFeatureModel : ObservableModelBase
    {
        private bool _isExpanded;

        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string? BlockerBadge { get; set; } // e.g. "1b"
        public bool HasBlocker => !string.IsNullOrEmpty(BlockerBadge);
        public double ProgressPercent { get; set; }
        public string ProgressText { get; set; } = ""; // e.g. "89% (8/9)"
        public string Status { get; set; } = "ACTIVE"; // ACTIVE, FOCUS, UNASSIGNED
        public int Count { get; set; } = 1;
        public object? RawData { get; set; }

        public bool IsExpanded
        {
            get => _isExpanded;
            set
            {
                if (_isExpanded != value)
                {
                    _isExpanded = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(ChevronIcon));
                }
            }
        }

        public string ChevronIcon => IsExpanded ? "▾" : "▸";
        public bool HasIssues => Issues.Count > 0;

        public ObservableCollection<GitBoardIssueModel> Issues { get; } = new();
        public ObservableCollection<GitBoardIssueModel> FilteredIssues { get; } = new();

        public void ResetFilter()
        {
            FilteredIssues.Clear();
            foreach (var i in Issues)
            {
                FilteredIssues.Add(i);
            }
        }

        public bool ApplyFilter(string query)
        {
            FilteredIssues.Clear();
            bool anyMatch = false;

            foreach (var i in Issues)
            {
                if (i.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                    i.Number.ToString().Contains(query, StringComparison.OrdinalIgnoreCase))
                {
                    FilteredIssues.Add(i);
                    anyMatch = true;
                }
            }

            if (anyMatch)
            {
                IsExpanded = true;
            }

            return anyMatch;
        }
    }

    public class GitBoardIssueModel : ObservableModelBase
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string DisplayText => $"#{Number} {Title}";
        public Brush StatusDotColor { get; set; } = new SolidColorBrush(Color.FromRgb(0x7C, 0x8C, 0xF0));
        public object? RawData { get; set; }
    }
}
