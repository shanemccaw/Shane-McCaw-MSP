using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Re-imagined Settings & Environment Management view:
    /// - Comprehensive Test Environment Variables breakdown grouped by domain with live manifest references.
    /// - Interactive variable cards with inline reveal, copy, quick-save, and manifest usage tags.
    /// - Health status overview dashboard and category filter chips.
    /// - Preserves all existing settings persistence, events, and navigation contracts.
    /// </summary>
    public partial class SettingsTabView : UserControl
    {
        public event EventHandler? ReplitWatcherSettingsChanged;
        public event EventHandler? ScheduleSettingsChanged;

        private ManifestVariableScanResult? _lastScanResult;
        private string _activeVarCategory = "All";
        private string _varSearchQuery = "";
        private readonly HashSet<string> _revealedVariables = new(StringComparer.OrdinalIgnoreCase);

        // Git #1986 — guards LocationModeCombo's SelectionChanged from firing a spurious
        // save/log while the constructor seeds the control's initial value.
        private bool _loadingSettings;

        public SettingsTabView()
        {
            InitializeComponent();

            _loadingSettings = true;
            var savedSettings = BuildConsoleSettings.Load();
            GitHubPatBox.Password = savedSettings.GitHubPat;
            GitHubPatPlainBox.Text = savedSettings.GitHubPat;
            ZohoApiTokenBox.Password = savedSettings.ZohoApiToken;
            ZohoApiTokenPlainBox.Text = savedSettings.ZohoApiToken;

            EpicChatProjectUrlBox.Text = savedSettings.EpicChatProjectUrl;

            SecondaryClaudeConfigDirBox.Text = savedSettings.SecondaryClaudeConfigDir;

            ReplitWatcherEnabledCheck.IsChecked = savedSettings.ReplitWatcherEnabled;
            ReplitWatcherIntervalBox.Text = savedSettings.ReplitWatcherIntervalMinutes.ToString();
            ReplitRunSelectorBox.Text = savedSettings.ReplitRunButtonSelector;
            ReplitAppUrlBox.Text = savedSettings.ReplitAppUrl;
            ReplitWorkspaceUrlBox.Text = savedSettings.ReplitWorkspaceUrl;

            LinkedInComposerSelectorBox.Text = savedSettings.LinkedInComposerSelector;
            LinkedInComposeUrlBox.Text = savedSettings.LinkedInComposeUrl;

            ScheduledRunEnabledCheck.IsChecked = savedSettings.ScheduledRegressionEnabled;
            ScheduledRunIntervalBox.Text = savedSettings.ScheduledRegressionIntervalHours.ToString();
            AutoRunPostBuildTestsCheck.IsChecked = savedSettings.AutoRunTestsOnBuildComplete;
            AutoRunFullSuiteFallbackCheck.IsChecked = savedSettings.AutoRunFullSuiteFallbackOnBuildComplete;

            BuildSoundPathBox.Text = savedSettings.BuildCompleteSoundPath;

            SshKeyPathBox.Text = savedSettings.SshKeyPath;
            SshHostBox.Text = savedSettings.SshHost;
            SshUserBox.Text = savedSettings.SshUser;
            SshRemoteDirBox.Text = savedSettings.SshRemoteDir;
            UseSshForDeployCheck.IsChecked = savedSettings.UseSshForDeploy;
            UseSshForSqlCheck.IsChecked = savedSettings.UseSshForSql;

            EncouragementCrittersEnabledCheck.IsChecked = savedSettings.EncouragementCrittersEnabled;
            ShowUsageReadoutCheck.IsChecked = savedSettings.ShowUsageReadout;
            PinnedQuestionDetectionEnabledCheck.IsChecked = savedSettings.PinnedQuestionDetectionEnabled;

            // Git #1986 — Home/Rental location gate. Only "Rental" (case-insensitive) reads as
            // metered; every other value, including a missing/corrupt setting, seeds Home (index 0),
            // per the Home-is-the-safe-default rule.
            LocationModeCombo.SelectedIndex =
                BuildConsoleSettings.CurrentNetworkIsMetered() ? 1 : 0;

            _loadingSettings = false;

            RenderWebToolsSettingsList();
            RenderUserAccountsSettingsList();

            // Run manifest variable scan & render environment
            RunManifestVariableScan(showStatus: false);
            UpdateHealthDashboard();
            SelectCategory("TestEnvironment");
        }

        private void PostBuildTestOption_Changed(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.AutoRunTestsOnBuildComplete = AutoRunPostBuildTestsCheck.IsChecked == true;
            settings.AutoRunFullSuiteFallbackOnBuildComplete = AutoRunFullSuiteFallbackCheck.IsChecked == true;
            settings.Save();
        }

        /// <summary>
        /// Git #1639 — persists whether the automatic Encouragement critter timer
        /// (<see cref="EncouragementService.Instance.Start"/>, gated at MainWindow launch)
        /// is enabled. EncouragementService exposes no Stop(), so a change here takes
        /// effect on next launch, same as the other launch-time toggles on this page.
        /// </summary>
        private void EncouragementCrittersEnabledCheck_Changed(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.EncouragementCrittersEnabled = EncouragementCrittersEnabledCheck.IsChecked == true;
            settings.Save();
        }

        /// <summary>Git #2001 — persists whether the title-bar token/cost readout is shown. Purely
        /// a display choice: <see cref="Services.UsageTrackingService"/> keeps tracking and the
        /// title bar keeps refreshing the (possibly hidden) text regardless of this setting.
        /// Applied live to the running title bar so it takes effect without a restart.</summary>
        private void ShowUsageReadoutCheck_Changed(object sender, RoutedEventArgs e)
        {
            if (_loadingSettings) return;
            var settings = BuildConsoleSettings.Load();
            settings.ShowUsageReadout = ShowUsageReadoutCheck.IsChecked == true;
            settings.Save();
            try { (Application.Current?.MainWindow as BuildConsole.MainWindow)?.RefreshUsageReadoutVisibility(); } catch { /* best-effort */ }
        }

        /// <summary>Git #2124 — persists whether active Pinned Question detection (#2105) is
        /// enabled. Read fresh via <see cref="BuildConsoleSettings.Load"/> on every probe attempt
        /// in <see cref="BuildConsole.FloatingChatWindow.MaybeProbeForPinnedQuestionsAsync"/>, so
        /// this takes effect immediately — no restart, no live-apply plumbing needed.</summary>
        private void PinnedQuestionDetectionEnabledCheck_Changed(object sender, RoutedEventArgs e)
        {
            if (_loadingSettings) return;
            var settings = BuildConsoleSettings.Load();
            settings.PinnedQuestionDetectionEnabled = PinnedQuestionDetectionEnabledCheck.IsChecked == true;
            settings.Save();
        }

        /// <summary>Git #1986 — persists the Home/Rental location and refreshes the title-bar
        /// Location toggle live so both controls always agree. Index 1 = Rental (metered), index 0
        /// = Home (unmetered, the safe default). Guarded against the constructor's seeding.</summary>
        private void LocationModeCombo_Changed(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
        {
            if (_loadingSettings) return;
            var settings = BuildConsoleSettings.Load();
            bool metered = LocationModeCombo.SelectedIndex == 1;
            settings.LocationMode = metered ? "Rental" : "Home";
            settings.Save();
            LocationModeSavedText.Text = metered
                ? "Saved — Rental (metered). Network-heavy work is now gated."
                : "Saved — Home (unmetered).";
            ActivityLog.Log("system.core",
                $"Location set from Settings to {(metered ? "RENTAL (metered)" : "HOME (unmetered)")}.");
            // Keep the title-bar toggle in sync live (it reflects the same LocationMode field).
            try { (Application.Current?.MainWindow as BuildConsole.MainWindow)?.RefreshLocationToggle(); } catch { /* best-effort */ }
        }

        public void Initialize(BuildTrackerApiClient? api)
        {
            var cfg = BuildTrackerConfig.Load();
            DevBaseUrlDisplay.Text = cfg.GetBaseUrl(TargetEnvironment.Dev);
            StagingBaseUrlDisplay.Text = cfg.GetBaseUrl(TargetEnvironment.Staging);
            ProductionBaseUrlDisplay.Text = cfg.GetBaseUrl(TargetEnvironment.Production);
            // Git #2122 — live watcher's own current cap wins if one is already running (e.g. it was
            // live-applied earlier this session); otherwise fall back to the config file's value.
            MaxConcurrentBox.Text = ((Application.Current?.MainWindow as BuildConsole.MainWindow)?.QueueWatcher?.MaxConcurrent
                ?? cfg.MaxConcurrent).ToString();

            if (api == null)
            {
                ApiBaseUrlDisplay.Text = "(not connected)";
                ConfigPathText.Text = "No scripts\\build-queue-watcher.config.json found — copy the .example template next to it and fill in apiBaseUrl/ingestToken.";
                return;
            }
            ApiBaseUrlDisplay.Text = api.IsConfigured ? api.ConfiguredApiBaseUrl : "(not connected)";
            ConfigPathText.Text = api.ConfigPath ?? "No scripts\\build-queue-watcher.config.json found — copy the .example template next to it and fill in apiBaseUrl/ingestToken.";
        }

        private string _activeCategory = "TestEnvironment";

        public void ScrollToSection(string? category)
        {
            SelectCategory(category);
        }

        public void SelectCategory(string? category)
        {
            category = string.IsNullOrWhiteSpace(category) ? "TestEnvironment" : category;
            _activeCategory = category;

            // Hide all other pages, show only the selected category page
            PageTestEnvironment.Visibility = category == "TestEnvironment" ? Visibility.Visible : Visibility.Collapsed;
            PageCredentials.Visibility = category == "Credentials" ? Visibility.Visible : Visibility.Collapsed;
            PageGeneral.Visibility = category == "General" ? Visibility.Visible : Visibility.Collapsed;
            PageReplitWatcher.Visibility = category == "ReplitWatcher" ? Visibility.Visible : Visibility.Collapsed;
            PageScheduledRun.Visibility = category == "ScheduledRun" ? Visibility.Visible : Visibility.Collapsed;
            PageSshRemote.Visibility = category == "SshRemote" ? Visibility.Visible : Visibility.Collapsed;
            PageWebTools.Visibility = category == "WebTools" ? Visibility.Visible : Visibility.Collapsed;
            PageChatIntegration.Visibility = category == "ChatIntegration" ? Visibility.Visible : Visibility.Collapsed;
            PageBuildSound.Visibility = category == "BuildSound" ? Visibility.Visible : Visibility.Collapsed;
            PageLinkedIn.Visibility = category == "LinkedIn" ? Visibility.Visible : Visibility.Collapsed;
            PageUserAccounts.Visibility = category == "UserAccounts" ? Visibility.Visible : Visibility.Collapsed;

            // Update Left Navigation selection highlight
            UpdateNavSelection(category);

            if (category == "TestEnvironment")
                RunManifestVariableScan(showStatus: false);

            // Always scroll cleanly to the top for the selected category page
            RootScroll.ScrollToTop();
        }

        private void UpdateNavSelection(string activeCategory)
        {
            var navItems = new (Border? Wrap, TextBlock? Text, string Key)[]
            {
                (NavWrapTestEnvironment, NavTextTestEnvironment, "TestEnvironment"),
                (NavWrapCredentials, NavTextCredentials, "Credentials"),
                (NavWrapGeneral, NavTextGeneral, "General"),
                (NavWrapReplitWatcher, NavTextReplitWatcher, "ReplitWatcher"),
                (NavWrapScheduledRun, NavTextScheduledRun, "ScheduledRun"),
                (NavWrapSshRemote, NavTextSshRemote, "SshRemote"),
                (NavWrapWebTools, NavTextWebTools, "WebTools"),
                (NavWrapChatIntegration, NavTextChatIntegration, "ChatIntegration"),
                (NavWrapBuildSound, NavTextBuildSound, "BuildSound"),
                (NavWrapLinkedIn, NavTextLinkedIn, "LinkedIn"),
                (NavWrapUserAccounts, NavTextUserAccounts, "UserAccounts"),
            };

            foreach (var (wrap, text, key) in navItems)
            {
                if (wrap == null || text == null) continue;
                bool isSelected = string.Equals(activeCategory, key, StringComparison.OrdinalIgnoreCase);

                wrap.Background = isSelected
                    ? (Brush)FindResource("BlueBrush")
                    : Brushes.Transparent;

                text.Foreground = isSelected
                    ? (Brush)FindResource("CrustBrush")
                    : (Brush)FindResource("TextBrush");

                text.FontWeight = isSelected ? FontWeights.Bold : FontWeights.SemiBold;
            }
        }

        private void NavButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string category)
            {
                SelectCategory(category);
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // HEALTH DASHBOARD & TOP PILLS
        // ══════════════════════════════════════════════════════════════════════
        private void UpdateHealthDashboard()
        {
            var settings = BuildConsoleSettings.Load();

            // Test Env Health
            int totalVars = settings.TestEnvironmentVariables.Count;
            int needsReview = settings.TestEnvironmentVariables.Count(v => v.NeedsReview || string.Equals(v.Value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal));
            int configured = totalVars - needsReview;

            if (needsReview > 0)
            {
                TestEnvHealthText.Text = $"{configured}/{totalVars} Configured ({needsReview} Needs Value)";
                TestEnvHealthText.Foreground = (Brush)FindResource("PeachBrush");
                TestEnvAlertPill.Visibility = Visibility.Visible;
                TestEnvAlertCount.Text = $"{needsReview} Review";
            }
            else
            {
                TestEnvHealthText.Text = $"{totalVars} Ready";
                TestEnvHealthText.Foreground = (Brush)FindResource("GreenBrush");
                TestEnvAlertPill.Visibility = Visibility.Collapsed;
            }

            // GitHub PAT Health
            bool hasPat = settings.HasGitHubPat;
            GitHubPatHealthText.Text = hasPat ? "Configured" : "Missing Token";
            GitHubPatHealthText.Foreground = (Brush)FindResource(hasPat ? "GreenBrush" : "PeachBrush");

            // Zoho Health
            bool hasZoho = !string.IsNullOrWhiteSpace(settings.ZohoApiToken);
            ZohoTokenHealthText.Text = hasZoho ? "Configured" : "Not Set";
            ZohoTokenHealthText.Foreground = (Brush)FindResource(hasZoho ? "GreenBrush" : "Subtext0Brush");

            // Replit Watcher Health
            bool replitActive = settings.ReplitWatcherEnabled;
            ReplitWatcherHealthText.Text = replitActive ? "Active" : "Disabled";
            ReplitWatcherHealthText.Foreground = (Brush)FindResource(replitActive ? "GreenBrush" : "Subtext0Brush");
        }

        private void TestEnvHealthBadge_Click(object sender, MouseButtonEventArgs e) => ScrollToSection("TestEnvironment");
        private void GitHubPatBadge_Click(object sender, MouseButtonEventArgs e) => ScrollToSection("Credentials");
        private void ZohoTokenBadge_Click(object sender, MouseButtonEventArgs e) => ScrollToSection("Credentials");
        private void ReplitWatcherBadge_Click(object sender, MouseButtonEventArgs e) => ScrollToSection("ReplitWatcher");

        // ══════════════════════════════════════════════════════════════════════
        // SEARCH TEST ENVIRONMENT VARIABLES
        // ══════════════════════════════════════════════════════════════════════
        private void TestEnvSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _varSearchQuery = TestEnvSearchBox.Text.Trim();
            if (TestEnvSearchPlaceholder != null)
                TestEnvSearchPlaceholder.Visibility = string.IsNullOrEmpty(_varSearchQuery) ? Visibility.Visible : Visibility.Collapsed;
            RenderTestEnvVarsSettingsList();
        }

        // BtnClearTestEnvSearch_Click removed (Git #2000) — TestEnvSearchBox now uses
        // the shared SearchTextBox style, whose baked-in ✕ clears it directly (firing
        // this same TextChanged handler, same as before).

        private void SettingsSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _varSearchQuery = SettingsSearchBox.Text.Trim();
            if (TestEnvSearchBox != null && TestEnvSearchBox.Text != _varSearchQuery)
            {
                TestEnvSearchBox.Text = _varSearchQuery;
            }
            RenderTestEnvVarsSettingsList();
        }

        // BtnClearSearch_Click removed (Git #2000) — SettingsSearchBox now uses the
        // shared SearchTextBox style. Its baked-in ✕ clears the box, which fires
        // SettingsSearchBox_TextChanged above and mirrors the empty query into
        // TestEnvSearchBox exactly as before.

        // ══════════════════════════════════════════════════════════════════════
        // TEST ENVIRONMENT & MANIFEST VARIABLES (SUPERCHARGED)
        // ══════════════════════════════════════════════════════════════════════
        private void RunManifestVariableScan(bool showStatus)
        {
            var settings = BuildConsoleSettings.Load();
            try
            {
                _lastScanResult = TestManifestVariableScanner.Scan(settings);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(TestManifestVariableScanner.Channel, $"scan failed: {ex.Message}");
                if (showStatus && TestEnvScanStatusText != null)
                    TestEnvScanStatusText.Text = "Scan failed — check Activity Log.";
                RenderTestEnvVarsSettingsList();
                UpdateHealthDashboard();
                return;
            }

            RenderCategoryChips();
            RenderTestEnvVarsSettingsList();
            UpdateHealthDashboard();

            if (showStatus && TestEnvScanStatusText != null && _lastScanResult != null)
                TestEnvScanStatusText.Text = _lastScanResult.SummaryLine;
        }

        private void BtnRescanManifests_Click(object sender, RoutedEventArgs e)
        {
            RunManifestVariableScan(showStatus: true);
            if (_lastScanResult != null)
            {
                if (_lastScanResult.AddedNames.Count > 0 || _lastScanResult.RemovedOrphanedNames.Count > 0)
                {
                    ToastEngine.Success("Manifest Sync", _lastScanResult.SummaryLine);
                }
                else
                {
                    ToastEngine.Info("Manifest Sync", _lastScanResult.SummaryLine);
                }
            }
        }

        private void BtnToggleAddVarCard_Click(object sender, RoutedEventArgs e)
        {
            AddVarCard.Visibility = AddVarCard.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
            if (AddVarCard.Visibility == Visibility.Visible)
            {
                TestEnvVarNameBox.Focus();
            }
        }

        private static string InferCategory(string varName, List<string>? areas)
        {
            string upper = varName.ToUpperInvariant();
            if (upper.StartsWith("GRAPH_") || upper.StartsWith("TENANT_") || upper.StartsWith("M365_") || upper.StartsWith("MS_"))
                return "Microsoft Graph";
            if (upper.StartsWith("ZOHO_") || upper.StartsWith("CRM_"))
                return "Zoho CRM";
            if (upper.Contains("PASSWORD") || upper.Contains("PASS") || upper.Contains("SECRET") || upper.Contains("TOKEN") || upper.Contains("AUTH") || upper.Contains("CREDENTIAL"))
                return "Auth & Security";
            if (upper.Contains("STRIPE") || upper.Contains("BILLING") || upper.Contains("INVOICE") || upper.Contains("PAYMENT"))
                return "Billing & Payments";
            if (upper.Contains("MAIL") || upper.Contains("SMTP") || upper.Contains("EMAIL"))
                return "Mailer";
            if (upper.Contains("COPILOT") || upper.Contains("AI_") || upper.Contains("CLAUDE"))
                return "AI & Copilot";
            if (upper.Contains("ADMIN"))
                return "Admin";
            if (upper.Contains("SMOKE"))
                return "Smoke";
            if (upper.Contains("OBSERVABILITY") || upper.Contains("METRIC") || upper.Contains("LOG"))
                return "Observability";

            if (areas != null && areas.Count > 0)
            {
                string firstArea = areas[0].ToLowerInvariant();
                if (firstArea.Contains("auth")) return "Auth & Security";
                if (firstArea.Contains("crm")) return "Zoho CRM";
                if (firstArea.Contains("billing")) return "Billing & Payments";
                if (firstArea.Contains("mailer")) return "Mailer";
                if (firstArea.Contains("copilot")) return "AI & Copilot";
                if (firstArea.Contains("smoke")) return "Smoke";
                if (firstArea.Contains("admin")) return "Admin";
                if (firstArea.Contains("observability")) return "Observability";
            }

            return "General";
        }

        private static string GetCategoryIcon(string category) => category switch
        {
            "Microsoft Graph"    => "🏢",
            "Zoho CRM"           => "☁️",
            "Auth & Security"    => "🔐",
            "Billing & Payments" => "💳",
            "Mailer"             => "📧",
            "AI & Copilot"       => "🤖",
            "Admin"              => "🛡️",
            "Smoke"              => "💨",
            "Observability"      => "📊",
            _                    => "📦"
        };

        private void RenderCategoryChips()
        {
            var settings = BuildConsoleSettings.Load();
            EnvCategoryChipsPanel.Children.Clear();

            var categoryCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            int needsReviewCount = 0;

            foreach (var v in settings.TestEnvironmentVariables)
            {
                var areas = _lastScanResult?.VariableAreaMap.TryGetValue(v.Name, out var al) == true ? al : null;
                string cat = InferCategory(v.Name, areas);
                categoryCounts[cat] = categoryCounts.GetValueOrDefault(cat, 0) + 1;

                if (v.NeedsReview || string.Equals(v.Value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal))
                    needsReviewCount++;
            }

            // "All" chip
            AddCategoryChip("All", $"All ({settings.TestEnvironmentVariables.Count})", isAlert: false);

            // "Needs Review" chip
            if (needsReviewCount > 0)
            {
                AddCategoryChip("NeedsReview", $"⚠️ Needs Review ({needsReviewCount})", isAlert: true);
            }

            // Categories
            foreach (var kvp in categoryCounts.OrderBy(k => k.Key))
            {
                string icon = GetCategoryIcon(kvp.Key);
                AddCategoryChip(kvp.Key, $"{icon} {kvp.Key} ({kvp.Value})", isAlert: false);
            }
        }

        private void AddCategoryChip(string categoryKey, string label, bool isAlert)
        {
            bool isSelected = string.Equals(_activeVarCategory, categoryKey, StringComparison.OrdinalIgnoreCase);

            var chip = new Border
            {
                Background = isSelected
                    ? (Brush)FindResource(isAlert ? "PeachBrush" : "BlueBrush")
                    : (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(10, 4, 10, 4),
                Margin = new Thickness(0, 0, 8, 6),
                Cursor = Cursors.Hand,
                Tag = categoryKey
            };

            var text = new TextBlock
            {
                Text = label,
                FontSize = 11,
                FontWeight = isSelected ? FontWeights.Bold : FontWeights.SemiBold,
                Foreground = isSelected
                    ? (Brush)FindResource("CrustBrush")
                    : (Brush)FindResource(isAlert ? "PeachBrush" : "TextBrush")
            };
            chip.Child = text;

            chip.MouseLeftButtonDown += (s, e) =>
            {
                _activeVarCategory = categoryKey;
                RenderCategoryChips();
                RenderTestEnvVarsSettingsList();
            };

            EnvCategoryChipsPanel.Children.Add(chip);
        }

        private void RenderTestEnvVarsSettingsList()
        {
            var settings = BuildConsoleSettings.Load();
            TestEnvVarsSettingsList.Children.Clear();

            var vars = settings.TestEnvironmentVariables.AsEnumerable();

            // Category Filter
            if (string.Equals(_activeVarCategory, "NeedsReview", StringComparison.OrdinalIgnoreCase))
            {
                vars = vars.Where(v => v.NeedsReview || string.Equals(v.Value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal));
            }
            else if (!string.Equals(_activeVarCategory, "All", StringComparison.OrdinalIgnoreCase))
            {
                vars = vars.Where(v =>
                {
                    var areas = _lastScanResult?.VariableAreaMap.TryGetValue(v.Name, out var al) == true ? al : null;
                    return string.Equals(InferCategory(v.Name, areas), _activeVarCategory, StringComparison.OrdinalIgnoreCase);
                });
            }

            // Search Filter
            if (!string.IsNullOrWhiteSpace(_varSearchQuery))
            {
                vars = vars.Where(v =>
                {
                    if (v.Name.Contains(_varSearchQuery, StringComparison.OrdinalIgnoreCase)) return true;
                    if (v.Value.Contains(_varSearchQuery, StringComparison.OrdinalIgnoreCase)) return true;
                    if (_lastScanResult?.VariableManifestMap.TryGetValue(v.Name, out var manifests) == true)
                    {
                        if (manifests.Any(m => m.Contains(_varSearchQuery, StringComparison.OrdinalIgnoreCase))) return true;
                    }
                    return false;
                });
            }

            var list = vars.ToList();

            if (list.Count == 0)
            {
                TestEnvVarsSettingsList.Children.Add(new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(20),
                    Margin = new Thickness(0, 4, 0, 4),
                    Child = new TextBlock
                    {
                        Text = "No test environment variables matched the current filter.",
                        Foreground = (Brush)FindResource("Subtext0Brush"),
                        FontSize = 12,
                        HorizontalAlignment = HorizontalAlignment.Center
                    }
                });
                return;
            }

            foreach (var v in list)
            {
                var card = BuildVariableCard(v);
                TestEnvVarsSettingsList.Children.Add(card);
            }
        }

        private FrameworkElement BuildVariableCard(TestEnvVar v)
        {
            var areas = _lastScanResult?.VariableAreaMap.TryGetValue(v.Name, out var al) == true ? al : null;
            var manifests = _lastScanResult?.VariableManifestMap.TryGetValue(v.Name, out var ml) == true ? ml : new List<string>();

            string category = InferCategory(v.Name, areas);
            string icon = GetCategoryIcon(category);

            bool isUnset = v.NeedsReview || string.Equals(v.Value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal) || string.IsNullOrEmpty(v.Value);
            bool isRevealed = _revealedVariables.Contains(v.Name);

            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource(isUnset ? "PeachBrush" : "Surface1Brush"),
                BorderThickness = new Thickness(isUnset ? 1.5 : 1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(14, 12, 14, 12),
                Margin = new Thickness(0, 0, 0, 10)
            };

            var mainStack = new StackPanel();

            // ── TOP ROW: Name + Category Badge + Health Status ─────────────────
            var topRow = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };

            var titleStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            titleStack.Children.Add(new TextBlock
            {
                Text = v.Name,
                FontFamily = new FontFamily("Consolas, Courier New, Segoe UI"),
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource(isUnset ? "PeachBrush" : "TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });

            // Category badge
            titleStack.Children.Add(new Border
            {
                Background = (Brush)FindResource("BaseBrush"),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 2, 6, 2),
                Margin = new Thickness(10, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = $"{icon} {category}",
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Subtext1Brush")
                }
            });
            topRow.Children.Add(titleStack);

            // Status Pill (Right side)
            var statusPill = new Border
            {
                Background = (Brush)FindResource(isUnset ? "PeachBrush" : "GreenBrush"),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(8, 2, 8, 2),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = isUnset ? "⚠️ NEEDS VALUE" : "✅ CONFIGURED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("CrustBrush")
                }
            };
            DockPanel.SetDock(statusPill, Dock.Right);
            topRow.Children.Add(statusPill);

            mainStack.Children.Add(topRow);

            // ── MANIFEST USAGE ROW ─────────────────────────────────────────────
            if (manifests.Count > 0)
            {
                var manifestWrap = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 8) };
                manifestWrap.Children.Add(new TextBlock
                {
                    Text = "Used in: ",
                    FontSize = 10,
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 4, 2)
                });

                foreach (var m in manifests)
                {
                    manifestWrap.Children.Add(new Border
                    {
                        Background = (Brush)FindResource("BaseBrush"),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(5, 1, 5, 1),
                        Margin = new Thickness(0, 0, 4, 2),
                        Child = new TextBlock
                        {
                            Text = $"📄 {m}",
                            FontSize = 9.5,
                            Foreground = (Brush)FindResource("Subtext1Brush")
                        }
                    });
                }
                mainStack.Children.Add(manifestWrap);
            }
            else
            {
                mainStack.Children.Add(new TextBlock
                {
                    Text = "No test manifest currently references this variable directly.",
                    FontSize = 10,
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    Margin = new Thickness(0, 0, 0, 8)
                });
            }

            // ── VALUE EDIT ROW ────────────────────────────────────────────────
            var editGrid = new Grid();
            editGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            editGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            editGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            editGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            editGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Value Input
            var valueBox = new TextBox
            {
                Height = 28,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                Text = isRevealed ? v.Value : MaskValue(v.Value)
            };
            if (!isRevealed)
            {
                valueBox.GotFocus += (s, e) =>
                {
                    valueBox.Text = v.Value;
                };
                valueBox.LostFocus += (s, e) =>
                {
                    if (!_revealedVariables.Contains(v.Name) && string.Equals(valueBox.Text, v.Value, StringComparison.Ordinal))
                        valueBox.Text = MaskValue(v.Value);
                };
            }
            Grid.SetColumn(valueBox, 0);
            editGrid.Children.Add(valueBox);

            // Reveal/Hide Eye Toggle
            var revealBtn = new Button
            {
                Content = isRevealed ? "🔒" : "👁",
                ToolTip = isRevealed ? "Mask Value" : "Reveal Value",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(8, 4, 8, 4),
                Margin = new Thickness(0, 0, 4, 0),
                FontSize = 11
            };
            revealBtn.Click += (s, e) =>
            {
                if (_revealedVariables.Contains(v.Name))
                    _revealedVariables.Remove(v.Name);
                else
                    _revealedVariables.Add(v.Name);

                RenderTestEnvVarsSettingsList();
            };
            Grid.SetColumn(revealBtn, 1);
            editGrid.Children.Add(revealBtn);

            // Copy Button
            var copyBtn = new Button
            {
                Content = "📋",
                ToolTip = "Copy to Clipboard",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(8, 4, 8, 4),
                Margin = new Thickness(0, 0, 4, 0),
                FontSize = 11
            };
            copyBtn.Click += (s, e) =>
            {
                try
                {
                    Clipboard.SetText(v.Value);
                    ToastEngine.Success("Copied", $"Copied {v.Name} value to clipboard.");
                }
                catch { }
            };
            Grid.SetColumn(copyBtn, 2);
            editGrid.Children.Add(copyBtn);

            // Save Button
            var saveBtn = new Button
            {
                Content = "Save",
                Style = (Style)FindResource("PrimaryButton"),
                Padding = new Thickness(14, 4, 14, 4),
                Margin = new Thickness(0, 0, 4, 0),
                FontSize = 11
            };
            saveBtn.Click += (s, e) =>
            {
                var newVal = valueBox.Text.Trim();
                var set = BuildConsoleSettings.Load();
                var match = set.TestEnvironmentVariables.Find(x => string.Equals(x.Name, v.Name, StringComparison.OrdinalIgnoreCase));
                if (match != null)
                {
                    match.Value = newVal;
                    if (!string.Equals(newVal, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal) && !string.IsNullOrEmpty(newVal))
                        match.NeedsReview = false;
                    set.Save();
                    ToastEngine.Success("Saved", $"Updated {v.Name}.");
                    ActivityLog.Log(TestManifestVariableScanner.Channel, $"saved {v.Name}");
                    RenderCategoryChips();
                    RenderTestEnvVarsSettingsList();
                    UpdateHealthDashboard();
                }
            };
            Grid.SetColumn(saveBtn, 3);
            editGrid.Children.Add(saveBtn);

            // Delete Button
            var deleteBtn = new Button
            {
                Content = "🗑",
                ToolTip = "Delete Variable",
                Style = (Style)FindResource("IconButton"),
                Padding = new Thickness(8, 4, 8, 4),
                FontSize = 11
            };
            deleteBtn.Click += (s, e) =>
            {
                var set = BuildConsoleSettings.Load();
                set.TestEnvironmentVariables.RemoveAll(x => string.Equals(x.Name, v.Name, StringComparison.OrdinalIgnoreCase));
                set.Save();
                ToastEngine.Success("Removed", $"Deleted {v.Name}.");
                ActivityLog.Log(TestManifestVariableScanner.Channel, $"removed {v.Name}");
                RenderCategoryChips();
                RenderTestEnvVarsSettingsList();
                UpdateHealthDashboard();
            };
            Grid.SetColumn(deleteBtn, 4);
            editGrid.Children.Add(deleteBtn);

            mainStack.Children.Add(editGrid);
            card.Child = mainStack;
            return card;
        }

        private static string MaskValue(string? value)
        {
            if (string.IsNullOrEmpty(value) || value == TestManifestVariableScanner.AutoDefaultValue)
                return value ?? "";
            if (value.Length <= 4) return new string('•', value.Length);
            return value.Substring(0, 2) + new string('•', Math.Min(value.Length - 2, 8));
        }

        private void BtnAddTestEnvVar_Click(object sender, RoutedEventArgs e)
        {
            var name = TestEnvVarNameBox.Text.Trim();
            var value = TestEnvVarValueBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(name)) return;

            var settings = BuildConsoleSettings.Load();
            var existing = settings.TestEnvironmentVariables.Find(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                existing.Value = value;
                if (!string.Equals(value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal))
                    existing.NeedsReview = false;
            }
            else
            {
                settings.TestEnvironmentVariables.Add(new TestEnvVar { Name = name, Value = value, NeedsReview = false });
            }

            settings.Save();
            TestEnvVarNameBox.Text = "";
            TestEnvVarValueBox.Text = "";
            AddVarCard.Visibility = Visibility.Collapsed;

            ToastEngine.Success("Added", $"Saved variable {name}.");
            RenderCategoryChips();
            RenderTestEnvVarsSettingsList();
            UpdateHealthDashboard();
        }

        private void BtnCancelAddVar_Click(object sender, RoutedEventArgs e)
        {
            TestEnvVarNameBox.Text = "";
            TestEnvVarValueBox.Text = "";
            AddVarCard.Visibility = Visibility.Collapsed;
        }

        // ══════════════════════════════════════════════════════════════════════
        // CREDENTIALS & INTEGRATIONS
        // ══════════════════════════════════════════════════════════════════════
        private void GitHubPatBox_PasswordChanged(object sender, RoutedEventArgs e)
        {
            if (GitHubPatPlainBox.Text != GitHubPatBox.Password)
                GitHubPatPlainBox.Text = GitHubPatBox.Password;
        }

        private void GitHubPatPlainBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (GitHubPatBox.Password != GitHubPatPlainBox.Text)
                GitHubPatBox.Password = GitHubPatPlainBox.Text;
        }

        private void BtnToggleRevealGitHubPat_Click(object sender, RoutedEventArgs e)
        {
            if (GitHubPatPlainBox.Visibility == Visibility.Visible)
            {
                GitHubPatPlainBox.Visibility = Visibility.Collapsed;
                GitHubPatBox.Visibility = Visibility.Visible;
                BtnToggleRevealGitHubPat.Content = "👁 Reveal";
            }
            else
            {
                GitHubPatPlainBox.Text = GitHubPatBox.Password;
                GitHubPatBox.Visibility = Visibility.Collapsed;
                GitHubPatPlainBox.Visibility = Visibility.Visible;
                BtnToggleRevealGitHubPat.Content = "🔒 Hide";
                GitHubPatPlainBox.Focus();
                GitHubPatPlainBox.SelectAll();
            }
        }

        private void BtnCopyGitHubPat_Click(object sender, RoutedEventArgs e)
        {
            string token = GitHubPatBox.Password.Trim();
            if (string.IsNullOrEmpty(token))
                token = BuildConsoleSettings.Load().GitHubPat;

            if (string.IsNullOrEmpty(token))
            {
                GitHubPatSavedText.Foreground = (Brush)FindResource("PeachBrush");
                GitHubPatSavedText.Text = "No GitHub PAT configured to copy.";
                return;
            }

            try
            {
                Clipboard.SetText(token);
                GitHubPatSavedText.Foreground = (Brush)FindResource("GreenBrush");
                GitHubPatSavedText.Text = "✓ GitHub PAT copied to clipboard!";
            }
            catch (Exception ex)
            {
                GitHubPatSavedText.Foreground = (Brush)FindResource("RedBrush");
                GitHubPatSavedText.Text = $"Failed to copy: {ex.Message}";
            }
        }

        private void BtnSaveGitHubPat_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.GitHubPat = GitHubPatBox.Password.Trim();
            settings.Save();
            GitHubPatSavedText.Foreground = (Brush)FindResource("GreenBrush");
            GitHubPatSavedText.Text = "GitHub PAT saved successfully.";
            UpdateHealthDashboard();
        }

        private void ZohoApiTokenBox_PasswordChanged(object sender, RoutedEventArgs e)
        {
            if (ZohoApiTokenPlainBox.Text != ZohoApiTokenBox.Password)
                ZohoApiTokenPlainBox.Text = ZohoApiTokenBox.Password;
        }

        private void ZohoApiTokenPlainBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (ZohoApiTokenBox.Password != ZohoApiTokenPlainBox.Text)
                ZohoApiTokenBox.Password = ZohoApiTokenPlainBox.Text;
        }

        private void BtnToggleRevealZohoToken_Click(object sender, RoutedEventArgs e)
        {
            if (ZohoApiTokenPlainBox.Visibility == Visibility.Visible)
            {
                ZohoApiTokenPlainBox.Visibility = Visibility.Collapsed;
                ZohoApiTokenBox.Visibility = Visibility.Visible;
                BtnToggleRevealZohoToken.Content = "👁 Reveal";
            }
            else
            {
                ZohoApiTokenPlainBox.Text = ZohoApiTokenBox.Password;
                ZohoApiTokenBox.Visibility = Visibility.Collapsed;
                ZohoApiTokenPlainBox.Visibility = Visibility.Visible;
                BtnToggleRevealZohoToken.Content = "🔒 Hide";
                ZohoApiTokenPlainBox.Focus();
                ZohoApiTokenPlainBox.SelectAll();
            }
        }

        private void BtnCopyZohoApiToken_Click(object sender, RoutedEventArgs e)
        {
            string token = ZohoApiTokenBox.Password.Trim();
            if (string.IsNullOrEmpty(token))
                token = BuildConsoleSettings.Load().ZohoApiToken;

            if (string.IsNullOrEmpty(token))
            {
                ZohoApiTokenSavedText.Foreground = (Brush)FindResource("PeachBrush");
                ZohoApiTokenSavedText.Text = "No Zoho API token configured to copy.";
                return;
            }

            try
            {
                Clipboard.SetText(token);
                ZohoApiTokenSavedText.Foreground = (Brush)FindResource("GreenBrush");
                ZohoApiTokenSavedText.Text = "✓ Zoho API token copied to clipboard!";
            }
            catch (Exception ex)
            {
                ZohoApiTokenSavedText.Foreground = (Brush)FindResource("RedBrush");
                ZohoApiTokenSavedText.Text = $"Failed to copy: {ex.Message}";
            }
        }

        private void BtnSaveZohoApiToken_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.ZohoApiToken = ZohoApiTokenBox.Password.Trim();
            settings.Save();
            ZohoApiTokenSavedText.Foreground = (Brush)FindResource("GreenBrush");
            ZohoApiTokenSavedText.Text = "Zoho API token saved successfully.";
            UpdateHealthDashboard();
        }

        /// <summary>
        /// Git #2122 — persists the max concurrent build slots to
        /// scripts\build-queue-watcher.config.json (the same file build-queue-watcher.ps1's own
        /// -MaxConcurrent default reads) AND live-applies it to a running QueueWatcherService via
        /// MainWindow, so it takes effect on the watcher's next ~10s poll tick with no restart.
        /// </summary>
        private void BtnSaveMaxConcurrent_Click(object sender, RoutedEventArgs e)
        {
            if (!int.TryParse(MaxConcurrentBox.Text.Trim(), out var value) || value < 1)
            {
                MaxConcurrentSavedText.Foreground = (Brush)FindResource("RedBrush");
                MaxConcurrentSavedText.Text = "Enter a whole number of at least 1.";
                return;
            }

            var cfg = BuildTrackerConfig.Load();
            cfg.MaxConcurrent = value;
            cfg.Save();

            bool liveApplied = false;
            try
            {
                var mainWindow = Application.Current?.MainWindow as BuildConsole.MainWindow;
                if (mainWindow?.QueueWatcher != null)
                {
                    mainWindow.UpdateMaxConcurrentBuildSlots(value);
                    liveApplied = true;
                }
            }
            catch { /* best-effort live-apply; the file write above already succeeded */ }

            MaxConcurrentSavedText.Foreground = (Brush)FindResource("GreenBrush");
            MaxConcurrentSavedText.Text = liveApplied
                ? $"✓ Saved and applied live — {value} max concurrent (takes effect on the watcher's next ~10s poll, no restart needed)."
                : $"✓ Saved — {value} max concurrent. No queue watcher is running yet in this session; it will read this on next launch.";
            ActivityLog.Log("settings.tab", $"Max concurrent build slots set to {value} (config persisted{(liveApplied ? " + live-applied" : "")}).");
        }

        private void BtnSaveEpicChatProjectUrl_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.EpicChatProjectUrl = EpicChatProjectUrlBox.Text.Trim();
            settings.Save();
            EpicChatProjectUrlSavedText.Text = "Project URL saved.";
        }

        /// <summary>Git #1416 — persist the secondary-account CLAUDE_CONFIG_DIR a "secondary"
        /// queue build is launched against. Blank falls back to the ~/.claude-secondary default
        /// on next load.</summary>
        private void BtnSaveSecondaryClaudeConfigDir_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            var path = SecondaryClaudeConfigDirBox.Text.Trim();
            settings.SecondaryClaudeConfigDir = path;
            settings.Save();
            SecondaryClaudeConfigDirSavedText.Text = string.IsNullOrEmpty(path)
                ? "Saved (blank — will use the ~/.claude-secondary default)."
                : $"Secondary account path saved: {path}";
        }

        private void BtnSaveReplitWatcher_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.ReplitWatcherEnabled = ReplitWatcherEnabledCheck.IsChecked == true;

            if (int.TryParse(ReplitWatcherIntervalBox.Text.Trim(), out var mins) && mins >= 1)
                settings.ReplitWatcherIntervalMinutes = mins;

            settings.ReplitRunButtonSelector = ReplitRunSelectorBox.Text.Trim();

            var app = ReplitAppUrlBox.Text.Trim();
            if (!string.IsNullOrWhiteSpace(app)) settings.ReplitAppUrl = app;

            var ws = ReplitWorkspaceUrlBox.Text.Trim();
            if (!string.IsNullOrWhiteSpace(ws)) settings.ReplitWorkspaceUrl = ws;

            settings.Save();
            ReplitWatcherSavedText.Text = "Watcher settings saved.";
            ActivityLog.Log("replit-watcher",
                $"Settings saved — enabled={settings.ReplitWatcherEnabled}, every {settings.ReplitWatcherIntervalMinutes} min, selector='{settings.ReplitRunButtonSelector}'.");

            UpdateHealthDashboard();
            ReplitWatcherSettingsChanged?.Invoke(this, EventArgs.Empty);
        }

        private void BtnSaveLinkedIn_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            var selector = LinkedInComposerSelectorBox.Text.Trim();
            if (!string.IsNullOrWhiteSpace(selector))
                settings.LinkedInComposerSelector = selector;

            var url = LinkedInComposeUrlBox.Text.Trim();
            if (!string.IsNullOrWhiteSpace(url))
                settings.LinkedInComposeUrl = url;

            settings.Save();
            LinkedInSavedText.Text = "LinkedIn settings saved.";
        }

        private void BtnSaveScheduledRun_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.ScheduledRegressionEnabled = ScheduledRunEnabledCheck.IsChecked == true;

            if (int.TryParse(ScheduledRunIntervalBox.Text.Trim(), out var hours) && hours >= 1)
                settings.ScheduledRegressionIntervalHours = hours;

            settings.PushOnRegressionFailure = ScheduledRunPushCheck.IsChecked == true;

            settings.Save();
            ScheduledRunSavedText.Text = "Schedule saved.";
            UpdateHealthDashboard();
            ScheduleSettingsChanged?.Invoke(this, EventArgs.Empty);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SSH & REMOTE REPLIT EXECUTION
        // ══════════════════════════════════════════════════════════════════════
        private void BtnBrowseSshKey_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Select SSH Private Key File",
                Filter = "All Files (*.*)|*.*|Key Files (*.key;*.pem;id_*;replit)|*.key;*.pem;id_*;replit",
                InitialDirectory = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh")
            };

            if (dlg.ShowDialog() == true)
            {
                SshKeyPathBox.Text = dlg.FileName;
            }
        }

        private void BtnSaveSshSettings_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.SshKeyPath = SshKeyPathBox.Text.Trim();
            settings.SshHost = SshHostBox.Text.Trim();
            settings.SshUser = SshUserBox.Text.Trim();
            settings.SshRemoteDir = SshRemoteDirBox.Text.Trim();
            settings.UseSshForDeploy = UseSshForDeployCheck.IsChecked == true;
            settings.UseSshForSql = UseSshForSqlCheck.IsChecked == true;
            settings.Save();

            SshSettingsSavedText.Foreground = (Brush)FindResource("GreenBrush");
            SshSettingsSavedText.Text = $"✓ SSH settings saved ({DateTime.Now:HH:mm:ss})";
            ToastEngine.Success("SSH Settings Saved", "Remote Replit SSH configuration has been persisted.");
        }

        private async void BtnTestSshConnection_Click(object sender, RoutedEventArgs e)
        {
            BtnTestSshConnection.IsEnabled = false;
            SshSettingsSavedText.Text = "⏳ Testing SSH connection…";
            SshSettingsSavedText.Foreground = (Brush)FindResource("PeachBrush");

            try
            {
                // Save current settings first
                BtnSaveSshSettings_Click(sender, e);

                var (ok, msg, latency) = await ReplitSshService.Instance.TestConnectionAsync();
                if (ok)
                {
                    SshSettingsSavedText.Text = $"✓ Connected in {latency}ms ({DateTime.Now:HH:mm:ss})";
                    SshSettingsSavedText.Foreground = (Brush)FindResource("GreenBrush");
                    ToastEngine.Success("SSH Connected", $"Successfully connected to Replit in {latency}ms.");
                }
                else
                {
                    SshSettingsSavedText.Text = $"✕ Connection failed: {msg}";
                    SshSettingsSavedText.Foreground = (Brush)FindResource("RedBrush");
                    ToastEngine.Warning("SSH Failed", msg);
                }
            }
            catch (Exception ex)
            {
                SshSettingsSavedText.Text = $"✕ Error: {ex.Message}";
                SshSettingsSavedText.Foreground = (Brush)FindResource("RedBrush");
                ToastEngine.Warning("SSH Error", ex.Message);
            }
            finally
            {
                BtnTestSshConnection.IsEnabled = true;
            }
        }

        private void SshField_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (SshSettingsSavedText != null)
                SshSettingsSavedText.Text = "";
        }

        // ══════════════════════════════════════════════════════════════════════
        // WEB TOOLS
        // ══════════════════════════════════════════════════════════════════════
        private int _editingWebToolIndex = -1;

        private void RenderWebToolsSettingsList()
        {
            var settings = BuildConsoleSettings.Load();
            WebToolsSettingsList.Children.Clear();

            for (int i = 0; i < settings.WebTools.Count; i++)
            {
                var tool = settings.WebTools[i];
                var row = new Grid { Margin = new Thickness(0, 0, 0, 6) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var label = new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(tool.Icon) ? $"{tool.Name} — {tool.Url}" : $"{tool.Icon} {tool.Name} — {tool.Url}",
                    FontSize = 11.5,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextBrush")
                };
                Grid.SetColumn(label, 0);
                row.Children.Add(label);

                var editBtn = new Button
                {
                    Content = "✏", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(4, 0, 0, 0), Tag = i
                };
                editBtn.Click += BtnEditWebTool_Click;
                Grid.SetColumn(editBtn, 1);
                row.Children.Add(editBtn);

                var removeBtn = new Button
                {
                    Content = "✕", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(4, 0, 0, 0), Tag = i
                };
                removeBtn.Click += BtnRemoveWebTool_Click;
                Grid.SetColumn(removeBtn, 2);
                row.Children.Add(removeBtn);

                WebToolsSettingsList.Children.Add(row);
            }
        }

        private void BtnEditWebTool_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not int index) return;
            var settings = BuildConsoleSettings.Load();
            if (index < 0 || index >= settings.WebTools.Count) return;

            var tool = settings.WebTools[index];
            WebToolNameBox.Text = tool.Name;
            WebToolUrlBox.Text = tool.Url;
            WebToolIconBox.Text = tool.Icon;
            _editingWebToolIndex = index;
            BtnAddWebTool.Content = "Save Changes";
        }

        private void BtnRemoveWebTool_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not int index) return;
            var settings = BuildConsoleSettings.Load();
            if (index < 0 || index >= settings.WebTools.Count) return;

            settings.WebTools.RemoveAt(index);
            settings.Save();

            _editingWebToolIndex = -1;
            BtnAddWebTool.Content = "Add Web Tool";
            RenderWebToolsSettingsList();
        }

        private void BtnAddWebTool_Click(object sender, RoutedEventArgs e)
        {
            var name = WebToolNameBox.Text.Trim();
            var url = WebToolUrlBox.Text.Trim();
            var icon = WebToolIconBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(url)) return;

            var settings = BuildConsoleSettings.Load();
            if (_editingWebToolIndex >= 0 && _editingWebToolIndex < settings.WebTools.Count)
            {
                var tool = settings.WebTools[_editingWebToolIndex];
                tool.Name = name;
                tool.Url = url;
                tool.Icon = icon;
            }
            else
            {
                settings.WebTools.Add(new WebToolEntry { Name = name, Url = url, Icon = icon });
            }

            settings.Save();
            _editingWebToolIndex = -1;
            BtnAddWebTool.Content = "Add Web Tool";
            WebToolNameBox.Text = "";
            WebToolUrlBox.Text = "";
            WebToolIconBox.Text = "";
            RenderWebToolsSettingsList();
        }

        // ══════════════════════════════════════════════════════════════════════
        // BUILD SOUND
        // ══════════════════════════════════════════════════════════════════════
        private System.Windows.Media.MediaPlayer? _testSoundPlayer;

        private void BtnBrowseBuildSound_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "Audio files (*.mp3;*.wav)|*.mp3;*.wav|All files (*.*)|*.*",
                Title = "Choose Build Completion Sound",
            };
            if (dialog.ShowDialog() == true)
            {
                BuildSoundPathBox.Text = dialog.FileName;
            }
        }

        private void BtnSaveBuildSound_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.BuildCompleteSoundPath = BuildSoundPathBox.Text.Trim();
            settings.Save();
            BuildSoundSavedText.Text = "Sound preference saved.";
        }

        private void BtnResetBuildSound_Click(object sender, RoutedEventArgs e)
        {
            BuildSoundPathBox.Text = "";
            var settings = BuildConsoleSettings.Load();
            settings.BuildCompleteSoundPath = "";
            settings.Save();
            BuildSoundSavedText.Text = "Reset to bundled default sound.";
        }

        private void BtnTestBuildSound_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                var path = BuildSoundPathBox.Text.Trim();
                if (string.IsNullOrEmpty(path)) path = BuildCompletionSoundService.ResolveSoundPath(settings) ?? "";

                if (!string.IsNullOrEmpty(path) && System.IO.File.Exists(path))
                {
                    _testSoundPlayer?.Close();
                    _testSoundPlayer = new System.Windows.Media.MediaPlayer();
                    _testSoundPlayer.Open(new Uri(path, UriKind.Absolute));
                    _testSoundPlayer.Play();
                }
            }
            catch (Exception ex)
            {
                BuildSoundSavedText.Text = $"Couldn't play sound: {ex.Message}";
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // USER ACCOUNTS MANAGEMENT (Gated profiles & Test credentials)
        // ══════════════════════════════════════════════════════════════════════
        private string _editingUserAccountId = "";

        private void RenderUserAccountsSettingsList()
        {
            var settings = BuildConsoleSettings.Load();
            UserAccountsSettingsList.Children.Clear();

            if (settings.UserAccounts == null) return;

            foreach (var acc in settings.UserAccounts)
            {
                var isCurrentlyActive = string.Equals(acc.Id, settings.ActiveUserAccountId, StringComparison.OrdinalIgnoreCase);

                var border = new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    BorderBrush = (Brush)FindResource("Surface1Brush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(6),
                    Padding = new Thickness(12),
                    Margin = new Thickness(0, 0, 0, 8),
                    Width = 600,
                    HorizontalAlignment = HorizontalAlignment.Left
                };

                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Radio / Active icon
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Info
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Tier Badge
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Actions

                // 1. Radio / Active icon button
                var radioBtn = new Button
                {
                    Content = new TextBlock
                    {
                        Text = isCurrentlyActive ? "🟢" : "⚪",
                        FontSize = 14,
                        VerticalAlignment = VerticalAlignment.Center
                    },
                    Style = (Style)FindResource("IconButton"),
                    Margin = new Thickness(0, 0, 12, 0),
                    ToolTip = isCurrentlyActive ? "Active Test Profile (Selected)" : "Click to set as Active Profile",
                    Tag = acc.Id
                };
                radioBtn.Click += BtnSelectActiveUserAccount_Click;
                Grid.SetColumn(radioBtn, 0);
                grid.Children.Add(radioBtn);

                // 2. Account info stack
                var infoStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                
                var userRow = new StackPanel { Orientation = Orientation.Horizontal };
                userRow.Children.Add(new TextBlock { Text = "User: ", FontSize = 11, Foreground = (Brush)FindResource("Subtext1Brush") });
                userRow.Children.Add(new TextBlock { Text = acc.Username, FontSize = 12, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("TextBrush") });
                infoStack.Children.Add(userRow);

                var passRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
                passRow.Children.Add(new TextBlock { Text = "Pass: ", FontSize = 11, Foreground = (Brush)FindResource("Subtext1Brush") });
                passRow.Children.Add(new TextBlock { Text = acc.Password, FontSize = 11, Foreground = (Brush)FindResource("Subtext0Brush") });
                infoStack.Children.Add(passRow);

                if (!string.IsNullOrWhiteSpace(acc.Notes))
                {
                    infoStack.Children.Add(new TextBlock
                    {
                        Text = acc.Notes,
                        FontSize = 10,
                        Foreground = (Brush)FindResource("Subtext1Brush"),
                        FontStyle = FontStyles.Italic,
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 2, 0, 0)
                    });
                }
                Grid.SetColumn(infoStack, 1);
                grid.Children.Add(infoStack);

                // 3. Tier badge color coding (Green for Standard, Blue for Premium, Purple for Enterprise, Red for Admin)
                Brush badgeBg;
                Brush badgeFg;
                switch ((acc.AccountTier ?? "").ToUpperInvariant())
                {
                    case "ADMIN":
                        badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33F38BA8")); // Soft red
                        badgeFg = (Brush)FindResource("RedBrush");
                        break;
                    case "ENTERPRISE":
                        badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33CBA6F7")); // Soft purple
                        badgeFg = (Brush)FindResource("MauveBrush");
                        break;
                    case "PREMIUM":
                        badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3389B4FA")); // Soft blue
                        badgeFg = (Brush)FindResource("BlueBrush");
                        break;
                    default:
                        badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33A6E3A1")); // Soft green
                        badgeFg = (Brush)FindResource("GreenBrush");
                        break;
                }

                var badgeBorder = new Border
                {
                    Background = badgeBg,
                    BorderBrush = badgeFg,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(12, 0, 12, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Child = new TextBlock
                    {
                        Text = acc.AccountTier,
                        FontSize = 9.5,
                        FontWeight = FontWeights.Bold,
                        Foreground = badgeFg
                    }
                };
                Grid.SetColumn(badgeBorder, 2);
                grid.Children.Add(badgeBorder);

                // 4. Actions stack (edit / delete)
                var actionsStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
                
                var editBtn = new Button
                {
                    Content = "✏",
                    FontSize = 10,
                    Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(4, 0, 0, 0),
                    ToolTip = "Edit Profile",
                    Tag = acc.Id
                };
                editBtn.Click += BtnEditUserAccount_Click;
                actionsStack.Children.Add(editBtn);

                var deleteBtn = new Button
                {
                    Content = "🗑",
                    FontSize = 10,
                    Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(4, 0, 0, 0),
                    Foreground = (Brush)FindResource("RedBrush"),
                    ToolTip = "Delete Profile",
                    Tag = acc.Id
                };
                deleteBtn.Click += BtnRemoveUserAccount_Click;
                actionsStack.Children.Add(deleteBtn);

                Grid.SetColumn(actionsStack, 3);
                grid.Children.Add(actionsStack);

                border.Child = grid;
                UserAccountsSettingsList.Children.Add(border);
            }
        }

        private void BtnSelectActiveUserAccount_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string accountId) return;
            var settings = BuildConsoleSettings.Load();
            settings.ActiveUserAccountId = accountId;
            settings.Save();
            RenderUserAccountsSettingsList();
            UserAccountSavedText.Text = "Active test profile updated successfully!";
            
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            timer.Tick += (s2, e2) => { UserAccountSavedText.Text = ""; timer.Stop(); };
            timer.Start();
        }

        private void BtnEditUserAccount_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string accountId) return;
            var settings = BuildConsoleSettings.Load();
            var acc = settings.UserAccounts?.FirstOrDefault(a => a.Id == accountId);
            if (acc == null) return;

            UserAccountUsernameBox.Text = acc.Username;
            UserAccountPasswordBox.Text = acc.Password;
            UserAccountNotesBox.Text = acc.Notes;

            int selIdx = 0;
            switch ((acc.AccountTier ?? "").ToUpperInvariant())
            {
                case "STANDARD": selIdx = 0; break;
                case "PREMIUM": selIdx = 1; break;
                case "ENTERPRISE": selIdx = 2; break;
                case "ADMIN": selIdx = 3; break;
            }
            UserAccountTierBox.SelectedIndex = selIdx;

            _editingUserAccountId = accountId;
            UserAccountFormTitle.Text = "Edit Account Profile Settings";
            BtnSaveUserAccount.Content = "Save Changes";
            BtnCancelUserAccountEdit.Visibility = Visibility.Visible;
        }

        private void BtnRemoveUserAccount_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string accountId) return;
            var settings = BuildConsoleSettings.Load();
            var acc = settings.UserAccounts?.FirstOrDefault(a => a.Id == accountId);
            if (acc == null) return;

            if (MessageBox.Show($"Are you sure you want to delete profile '{acc.Username}' ({acc.AccountTier})?", "Delete Profile", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
                return;

            if (settings.UserAccounts == null) return;
            settings.UserAccounts.Remove(acc);

            if (string.Equals(settings.ActiveUserAccountId, accountId, StringComparison.OrdinalIgnoreCase))
            {
                settings.ActiveUserAccountId = settings.UserAccounts.Count > 0 ? settings.UserAccounts[0].Id : "";
            }

            settings.Save();
            RenderUserAccountsSettingsList();
            UserAccountSavedText.Text = "Account profile deleted.";
            
            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            timer.Tick += (s2, e2) => { UserAccountSavedText.Text = ""; timer.Stop(); };
            timer.Start();
        }

        private void BtnSaveUserAccount_Click(object sender, RoutedEventArgs e)
        {
            string username = UserAccountUsernameBox.Text.Trim();
            string password = UserAccountPasswordBox.Text.Trim();
            string notes = UserAccountNotesBox.Text.Trim();
            string tier = (UserAccountTierBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Standard";

            if (string.IsNullOrEmpty(username))
            {
                MessageBox.Show("Please enter a username or email.", "Validation Error", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            var settings = BuildConsoleSettings.Load();
            if (settings.UserAccounts == null) settings.UserAccounts = new List<UserAccountEntry>();

            if (string.IsNullOrEmpty(_editingUserAccountId))
            {
                var newAcc = new UserAccountEntry
                {
                    Username = username,
                    Password = password,
                    Notes = notes,
                    AccountTier = tier
                };
                settings.UserAccounts.Add(newAcc);
                
                if (settings.UserAccounts.Count == 1 || string.IsNullOrEmpty(settings.ActiveUserAccountId))
                {
                    settings.ActiveUserAccountId = newAcc.Id;
                }

                UserAccountSavedText.Text = "Gated test profile added successfully!";
            }
            else
            {
                var existing = settings.UserAccounts.FirstOrDefault(a => a.Id == _editingUserAccountId);
                if (existing != null)
                {
                    existing.Username = username;
                    existing.Password = password;
                    existing.Notes = notes;
                    existing.AccountTier = tier;
                }
                
                _editingUserAccountId = "";
                UserAccountFormTitle.Text = "Create Gated Test Profile";
                BtnSaveUserAccount.Content = "Add Gated Profile";
                BtnCancelUserAccountEdit.Visibility = Visibility.Collapsed;

                UserAccountSavedText.Text = "Profile settings saved successfully!";
            }

            settings.Save();
            RenderUserAccountsSettingsList();

            UserAccountUsernameBox.Text = "";
            UserAccountPasswordBox.Text = "";
            UserAccountNotesBox.Text = "";
            UserAccountTierBox.SelectedIndex = 0;

            var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            timer.Tick += (s2, e2) => { UserAccountSavedText.Text = ""; timer.Stop(); };
            timer.Start();
        }

        private void BtnCancelUserAccountEdit_Click(object sender, RoutedEventArgs e)
        {
            _editingUserAccountId = "";
            UserAccountFormTitle.Text = "Create Gated Test Profile";
            BtnSaveUserAccount.Content = "Add Gated Profile";
            BtnCancelUserAccountEdit.Visibility = Visibility.Collapsed;

            UserAccountUsernameBox.Text = "";
            UserAccountPasswordBox.Text = "";
            UserAccountNotesBox.Text = "";
            UserAccountTierBox.SelectedIndex = 0;
        }
    }
}
