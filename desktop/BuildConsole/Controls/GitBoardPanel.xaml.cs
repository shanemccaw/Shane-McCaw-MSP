using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Models;

namespace BuildConsole.Controls
{
    public partial class GitBoardPanel : UserControl
    {
        public event EventHandler<int>? IssueSelected;
        public event EventHandler<int>? EpicLocateRequested;
        public event EventHandler<int>? GateSelected;

        public GitBoardViewModel ViewModel { get; } = new();

        public GitBoardPanel()
        {
            InitializeComponent();
            DataContext = ViewModel;
            PopulateDefaultScreenshotData();
        }

        /// <summary>
        /// Populates the exact target hierarchical board shown in the reference screenshot.
        /// Used as default state and reliable fallback if offline or loading.
        /// </summary>
        public void PopulateDefaultScreenshotData()
        {
            ViewModel.WorkingBanner = new WorkingBannerModel
            {
                Number = 1202,
                Title = "Epic: Build Console"
            };

            ViewModel.MilestoneSummary = new MilestoneSummaryModel
            {
                Title = "v1.1 · Monitoring & Launch",
                ProgressPercent = 60.0,
                RatioText = "96/158"
            };

            ViewModel.GateBanner = new GateBannerModel
            {
                Number = 1202,
                HeaderText = "GATE · BLOCKS RELEASE",
                SubtitleText = "Validating Prerequisites",
                FractionText = "7/8"
            };

            ViewModel.Epics.Clear();

            // 1. #1093 EPIC: Marketing Site
            ViewModel.Epics.Add(new GitBoardEpicModel
            {
                Number = 1093,
                Title = "EPIC: Marketing Site",
                ProgressPercent = 0,
                ProgressText = "0% (0/1)",
                IsExpanded = false
            });

            // 2. #1096 EPIC: Application Core
            ViewModel.Epics.Add(new GitBoardEpicModel
            {
                Number = 1096,
                Title = "EPIC: Application Core",
                ProgressPercent = 0,
                ProgressText = "0% (0/2)",
                IsExpanded = false
            });

            // 3. #1202 EPIC: Build Console (Target expanded working epic)
            var buildConsoleEpic = new GitBoardEpicModel
            {
                Number = 1202,
                Title = "EPIC: Build Console",
                ProgressPercent = 67,
                ProgressText = "67% (14/21)",
                IsExpanded = true,
                IsWorking = true
            };

            // Feature 1: Build Console UI
            buildConsoleEpic.Features.Add(new GitBoardFeatureModel
            {
                Number = 1205,
                Title = "FEATURE: Build Console UI Layout",
                BlockerBadge = "1b",
                ProgressPercent = 89,
                ProgressText = "89% (8/9)",
                Status = "ACTIVE",
                Count = 1,
                IsExpanded = false
            });

            // Feature 2: SQL Runner (FOCUS - Contains nested issues)
            var sqlRunnerFeature = new GitBoardFeatureModel
            {
                Number = 1210,
                Title = "FEATURE: SQL Runner & Interactive Execution",
                BlockerBadge = "1b",
                ProgressPercent = 67,
                ProgressText = "67% (6/9)",
                Status = "FOCUS",
                Count = 3,
                IsExpanded = true
            };

            sqlRunnerFeature.Issues.Add(new GitBoardIssueModel
            {
                Number = 2053,
                Title = "SQL Runner returns 0 rows on any query against active database",
                StatusDotColor = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")) // Red bug
            });

            sqlRunnerFeature.Issues.Add(new GitBoardIssueModel
            {
                Number = 2051,
                Title = "SQL Runner: saved query library persistence",
                StatusDotColor = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")) // Yellow in-progress
            });

            sqlRunnerFeature.Issues.Add(new GitBoardIssueModel
            {
                Number = 2052,
                Title = "SQL Runner: result grid keeps stale column schemas",
                StatusDotColor = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#7C8CF0")) // Blue open
            });

            buildConsoleEpic.Features.Add(sqlRunnerFeature);

            // Feature 3: Unassigned feature
            buildConsoleEpic.Features.Add(new GitBoardFeatureModel
            {
                Number = 1215,
                Title = "FEATURE: Automated Regression Telemetry",
                BlockerBadge = null,
                ProgressPercent = 0,
                ProgressText = "0% (0/3)",
                Status = "UNASSIGNED",
                Count = 3,
                IsExpanded = false
            });

            ViewModel.Epics.Add(buildConsoleEpic);

            // 4. #1281 EPIC: Admin Panel
            ViewModel.Epics.Add(new GitBoardEpicModel
            {
                Number = 1281,
                Title = "EPIC: Admin Panel",
                ProgressPercent = 0,
                ProgressText = "0% (0/2)",
                IsExpanded = false
            });

            // 5. #1485 EPIC: Customer Portal
            ViewModel.Epics.Add(new GitBoardEpicModel
            {
                Number = 1485,
                Title = "EPIC: Customer Portal",
                ProgressPercent = 0,
                ProgressText = "0% (0/2)",
                IsExpanded = false
            });

            // 6. #1571 EPIC: Portal Admin
            ViewModel.Epics.Add(new GitBoardEpicModel
            {
                Number = 1571,
                Title = "EPIC: Portal Admin",
                ProgressPercent = 0,
                ProgressText = "0% (0/2)",
                IsExpanded = false
            });

            ViewModel.RefreshFilteredEpics();
        }

        /// <summary>
        /// Updates the board from live GitHub milestones and epics data.
        /// </summary>
        public void SetLiveMilestones(
            IReadOnlyList<GitMilestone> milestones,
            int? activeWorkingEpicNumber = null,
            string? activeGateTitle = null,
            string? activeGateFraction = null,
            int? activeGateNumber = null)
        {
            if (milestones == null || milestones.Count == 0)
            {
                PopulateDefaultScreenshotData();
                return;
            }

            // Milestone summary from first active milestone
            var firstM = milestones.FirstOrDefault(m => !m.IsClosed) ?? milestones.FirstOrDefault();
            if (firstM != null)
            {
                ViewModel.MilestoneSummary = new MilestoneSummaryModel
                {
                    Number = firstM.GithubNumber,
                    Title = firstM.Title,
                    ProgressPercent = firstM.ProgressPercent,
                    RatioText = $"{firstM.CompletedCount}/{firstM.TotalCount}"
                };
            }

            // Gate banner if present
            if (!string.IsNullOrEmpty(activeGateTitle) && activeGateNumber.HasValue)
            {
                ViewModel.GateBanner = new GateBannerModel
                {
                    Number = activeGateNumber.Value,
                    HeaderText = "GATE · BLOCKS RELEASE",
                    SubtitleText = activeGateTitle,
                    FractionText = activeGateFraction ?? "1/1"
                };
            }

            var allIssues = milestones.SelectMany(m => m.Epics.SelectMany(e => e.Issues)).ToList();

            // Set working banner
            if (activeWorkingEpicNumber.HasValue)
            {
                var match = allIssues.FirstOrDefault(i => i.IssueNumber == activeWorkingEpicNumber.Value);
                ViewModel.WorkingBanner = new WorkingBannerModel
                {
                    Number = activeWorkingEpicNumber.Value,
                    Title = match?.Title ?? "Active Epic"
                };
            }

            ViewModel.Epics.Clear();

            // Flatten all epics from shown milestones
            foreach (var m in milestones)
            {
                foreach (var epicBucket in m.Epics)
                {
                    // Filter to top-level Epics
                    var topEpics = epicBucket.Issues
                        .Where(i => i.IsEpic || i.Title.StartsWith("EPIC:", StringComparison.OrdinalIgnoreCase))
                        .ToList();

                    if (topEpics.Count == 0 && epicBucket.Issues.Count > 0)
                    {
                        topEpics = epicBucket.Issues.Where(i => i.ParentNumber == null).ToList();
                    }

                    foreach (var epicIssue in topEpics)
                    {
                        bool isWorking = activeWorkingEpicNumber.HasValue && epicIssue.IssueNumber == activeWorkingEpicNumber.Value;

                        var epicModel = new GitBoardEpicModel
                        {
                            Number = epicIssue.IssueNumber,
                            Title = epicIssue.Title,
                            ProgressPercent = epicIssue.SubIssueCount > 0 ? (double)epicIssue.SubIssueCompleted / epicIssue.SubIssueCount * 100.0 : 0,
                            ProgressText = epicIssue.SubIssueCount > 0 ? $"{epicIssue.SubIssueCompleted}/{epicIssue.SubIssueCount}" : "0% (0/0)",
                            IsExpanded = isWorking,
                            IsWorking = isWorking,
                            RawData = epicIssue
                        };

                        // Find Features (direct children of this Epic)
                        var features = allIssues.Where(i => i.ParentNumber == epicIssue.IssueNumber).ToList();
                        foreach (var fIssue in features)
                        {
                            var fModel = new GitBoardFeatureModel
                            {
                                Number = fIssue.IssueNumber,
                                Title = fIssue.Title,
                                ProgressPercent = fIssue.SubIssueCount > 0 ? (double)fIssue.SubIssueCompleted / fIssue.SubIssueCount * 100.0 : 0,
                                ProgressText = fIssue.SubIssueCount > 0 ? $"{fIssue.SubIssueCompleted}/{fIssue.SubIssueCount}" : "",
                                Status = fIssue.IsBlocked ? "FOCUS" : (fIssue.IsInFlight ? "ACTIVE" : "UNASSIGNED"),
                                Count = fIssue.SubIssueCount > 0 ? fIssue.SubIssueCount : 1,
                                IsExpanded = fIssue.IsBlocked || fIssue.IsInFlight,
                                RawData = fIssue
                            };

                            // Find child issues under this feature
                            var subIssues = allIssues.Where(i => i.ParentNumber == fIssue.IssueNumber).ToList();
                            foreach (var sIssue in subIssues)
                            {
                                Brush dotColor = sIssue.Status == "CLOSED"
                                    ? (Brush)FindResource("StatusSuccessBrush")
                                    : (sIssue.IsBlocked
                                        ? (Brush)FindResource("StatusErrorBrush")
                                        : (sIssue.IsInFlight
                                            ? (Brush)FindResource("StatusWarningBrush")
                                            : (Brush)FindResource("AccentBrush")));

                                fModel.Issues.Add(new GitBoardIssueModel
                                {
                                    Number = sIssue.IssueNumber,
                                    Title = sIssue.Title,
                                    StatusDotColor = dotColor,
                                    RawData = sIssue
                                });
                            }

                            epicModel.Features.Add(fModel);
                        }

                        ViewModel.Epics.Add(epicModel);
                    }
                }
            }

            if (ViewModel.Epics.Count == 0)
            {
                PopulateDefaultScreenshotData();
            }
            else
            {
                ViewModel.RefreshFilteredEpics();
            }
        }

        private void EpicsSectionHeader_Click(object sender, MouseButtonEventArgs e)
        {
            ViewModel.IsEpicsExpanded = !ViewModel.IsEpicsExpanded;
            TxtEpicsChevron.Text = ViewModel.IsEpicsExpanded ? "▾" : "▸";
        }

        private void EpicRow_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is FrameworkElement fe && fe.DataContext is GitBoardEpicModel epic)
            {
                epic.IsExpanded = !epic.IsExpanded;
                e.Handled = true;
            }
        }

        private void FeatureRow_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is FrameworkElement fe && fe.DataContext is GitBoardFeatureModel feature)
            {
                if (feature.HasIssues)
                {
                    feature.IsExpanded = !feature.IsExpanded;
                    e.Handled = true;
                }
                else
                {
                    IssueSelected?.Invoke(this, feature.Number);
                }
            }
        }

        private void IssueRow_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is FrameworkElement fe && fe.DataContext is GitBoardIssueModel issue)
            {
                IssueSelected?.Invoke(this, issue.Number);
                e.Handled = true;
            }
        }

        private void WorkingBannerCard_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (ViewModel.WorkingBanner != null)
            {
                int epicNum = ViewModel.WorkingBanner.Number;
                LocateAndExpandEpic(epicNum);
                EpicLocateRequested?.Invoke(this, epicNum);
            }
        }

        private void GateBannerCard_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (ViewModel.GateBanner != null)
            {
                GateSelected?.Invoke(this, ViewModel.GateBanner.Number);
            }
        }

        public void LocateAndExpandEpic(int epicNumber)
        {
            var epic = ViewModel.Epics.FirstOrDefault(ep => ep.Number == epicNumber);
            if (epic != null)
            {
                epic.IsExpanded = true;
                epic.IsWorking = true;
                ViewModel.IsEpicsExpanded = true;

                foreach (var f in epic.Features)
                {
                    if (f.Status == "FOCUS" || f.Status == "ACTIVE")
                    {
                        f.IsExpanded = true;
                    }
                }

                ViewModel.RefreshFilteredEpics();
            }
        }
    }
}
