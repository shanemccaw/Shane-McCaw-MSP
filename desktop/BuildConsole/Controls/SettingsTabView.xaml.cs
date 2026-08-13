using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #954 (Epic #803) — the full native Settings tab. Every field, x:Name,
    /// Click handler, and BuildConsoleSettings persistence path here was moved
    /// verbatim from LeftSidebar's old in-sidebar SettingsView panel (#834 PAT,
    /// #880 Zoho, #922 chat URL, #864 Web Tools, #953 Test Environment Variables,
    /// #902 Replit watcher) — this is a layout/navigation change, not a functional
    /// change to any setting. Hosted as a real editor TabItem via
    /// MainWindow.OpenSettingsTab, reusing the #893/#894/#921 multi-pane tab infra.
    ///
    /// The sidebar's Settings view is now just a category nav list that opens (or
    /// focuses) this tab and scrolls to a section via <see cref="ScrollToSection"/>.
    /// </summary>
    public partial class SettingsTabView : UserControl
    {
        /// <summary>Git #902 — raised when the Replit idle watcher's Settings are saved, so MainWindow can re-apply them (start/stop, new interval) live without a restart. Rewired per-instance each time the tab opens (see MainWindow.OpenSettingsTab).</summary>
        public event EventHandler? ReplitWatcherSettingsChanged;

        public SettingsTabView()
        {
            InitializeComponent();

            // Git #834 — pre-fill the PAT box from the local store
            // (%AppData%\BuildConsole\settings.json) so it round-trips visibly.
            var savedSettings = BuildConsoleSettings.Load();
            GitHubPatBox.Password = savedSettings.GitHubPat;
            ZohoApiTokenBox.Password = savedSettings.ZohoApiToken;

            // Git #922 — pre-fill the epic-chat "New chat project URL" from the same store.
            EpicChatProjectUrlBox.Text = savedSettings.EpicChatProjectUrl;

            // Git #902 — pre-fill the Replit idle watcher fields from the same store.
            ReplitWatcherEnabledCheck.IsChecked = savedSettings.ReplitWatcherEnabled;
            ReplitWatcherIntervalBox.Text = savedSettings.ReplitWatcherIntervalMinutes.ToString();
            ReplitRunSelectorBox.Text = savedSettings.ReplitRunButtonSelector;
            ReplitAppUrlBox.Text = savedSettings.ReplitAppUrl;
            ReplitWorkspaceUrlBox.Text = savedSettings.ReplitWorkspaceUrl;

            // Git #864
            RenderWebToolsSettingsList();

            // Git #953
            RenderTestEnvVarsSettingsList();
        }

        /// <summary>Fills the read-only Build Tracker API display from the shared
        /// client MainWindow already built — same source of truth as before, when
        /// LeftSidebar.Initialize populated these controls.</summary>
        public void Initialize(BuildTrackerApiClient? api)
        {
            if (api == null)
            {
                ApiBaseUrlDisplay.Text = "(not connected)";
                ConfigPathText.Text = "No scripts\\build-queue-watcher.config.json found — copy the .example template next to it and fill in apiBaseUrl/ingestToken.";
                return;
            }
            ApiBaseUrlDisplay.Text = api.IsConfigured ? api.ConfiguredApiBaseUrl : "(not connected)";
            ConfigPathText.Text = api.ConfigPath ?? "No scripts\\build-queue-watcher.config.json found — copy the .example template next to it and fill in apiBaseUrl/ingestToken.";
        }

        /// <summary>Git #954 — scroll the tab to a named section (the sidebar's
        /// category nav list hands the category key here via MainWindow). Falls
        /// back to the top for an unknown key.</summary>
        public void ScrollToSection(string? category)
        {
            FrameworkElement? target = category switch
            {
                "General"         => SectionGeneral,
                "Credentials"     => SectionCredentials,
                "TestEnvironment" => SectionTestEnvironment,
                "ChatIntegration" => SectionChatIntegration,
                "WebTools"        => SectionWebTools,
                "ReplitWatcher"   => SectionReplitWatcher,
                _                 => null,
            };
            if (target != null)
                target.BringIntoView();
            else
                RootScroll.ScrollToTop();
        }

        // ── SETTINGS: GitHub PAT (Git #834) ──────────────────────────────────
        private void BtnSaveGitHubPat_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.GitHubPat = GitHubPatBox.Password.Trim();
            settings.Save();
            GitHubPatSavedText.Text = "Saved.";
        }

        // ── SETTINGS: Zoho API Token (Git #880) ──────────────────────────────
        private void BtnSaveZohoApiToken_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.ZohoApiToken = ZohoApiTokenBox.Password.Trim();
            settings.Save();
            ZohoApiTokenSavedText.Text = "Saved.";
        }

        // ── SETTINGS: New Chat Project URL for epic right-click (Git #922) ────
        private void BtnSaveEpicChatProjectUrl_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            settings.EpicChatProjectUrl = EpicChatProjectUrlBox.Text.Trim();
            settings.Save();
            EpicChatProjectUrlSavedText.Text = "Saved.";
        }

        // ── SETTINGS: Replit Idle Watcher (Git #902) ─────────────────────────
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
            ReplitWatcherSavedText.Text = "Saved.";
            ActivityLog.Log("replit-watcher",
                $"Settings saved — enabled={settings.ReplitWatcherEnabled}, every {settings.ReplitWatcherIntervalMinutes} min, selector='{settings.ReplitRunButtonSelector}'.");

            // Let MainWindow re-apply live (start/stop, new interval) without a restart.
            ReplitWatcherSettingsChanged?.Invoke(this, EventArgs.Empty);
        }

        // ── SETTINGS: Web Tools (Git #864) ───────────────────────────────────
        private int _editingWebToolIndex = -1;

        private void RenderWebToolsSettingsList()
        {
            var settings = BuildConsoleSettings.Load();
            WebToolsSettingsList.Children.Clear();

            for (int i = 0; i < settings.WebTools.Count; i++)
            {
                var tool = settings.WebTools[i];
                var row = new Grid { Margin = new Thickness(0, 0, 0, 4) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var label = new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(tool.Icon) ? $"{tool.Name} — {tool.Url}" : $"{tool.Icon} {tool.Name} — {tool.Url}",
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextBrush")
                };
                Grid.SetColumn(label, 0);
                row.Children.Add(label);

                var editBtn = new Button
                {
                    Content = "✏", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(4, 0, 0, 0), Tag = i
                };
                editBtn.Click += BtnEditWebTool_Click;
                Grid.SetColumn(editBtn, 1);
                row.Children.Add(editBtn);

                var removeBtn = new Button
                {
                    Content = "✕", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(4, 0, 0, 0), Tag = i
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

            var removed = settings.WebTools[index];
            settings.WebTools.RemoveAt(index);
            settings.Save();
            ActivityLog.Log("web-tools.settings", $"removed \"{removed.Name}\"");

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
                ActivityLog.Log("web-tools.settings", $"edited \"{name}\"");
            }
            else
            {
                settings.WebTools.Add(new WebToolEntry { Name = name, Url = url, Icon = icon });
                ActivityLog.Log("web-tools.settings", $"added \"{name}\"");
            }

            settings.Save();

            _editingWebToolIndex = -1;
            BtnAddWebTool.Content = "Add Web Tool";
            WebToolNameBox.Text = "";
            WebToolUrlBox.Text = "";
            WebToolIconBox.Text = "";
            RenderWebToolsSettingsList();
        }

        // ── SETTINGS: Test Environment Variables (Git #953) ──────────────────
        // Add/edit/remove NAME=value pairs the manifest runner resolves {{NAME}}
        // against (TestRunVariables.SeedConfigVariables). Same render/edit/remove
        // shape as Web Tools above, values masked in the list since they're often
        // secrets (TEST_PORTAL_PASSWORD etc).
        private int _editingTestEnvVarIndex = -1;

        private const string TestEnvVarsChannel = "testing.config-vars";

        private void RenderTestEnvVarsSettingsList()
        {
            var settings = BuildConsoleSettings.Load();
            TestEnvVarsSettingsList.Children.Clear();

            for (int i = 0; i < settings.TestEnvironmentVariables.Count; i++)
            {
                var v = settings.TestEnvironmentVariables[i];
                var row = new Grid { Margin = new Thickness(0, 0, 0, 4) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var label = new TextBlock
                {
                    Text = $"{v.Name} = {MaskValue(v.Value)}",
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextBrush")
                };
                Grid.SetColumn(label, 0);
                row.Children.Add(label);

                var editBtn = new Button
                {
                    Content = "✏", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(4, 0, 0, 0), Tag = i
                };
                editBtn.Click += BtnEditTestEnvVar_Click;
                Grid.SetColumn(editBtn, 1);
                row.Children.Add(editBtn);

                var removeBtn = new Button
                {
                    Content = "✕", FontSize = 10, Style = (Style)FindResource("IconButton"),
                    Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(4, 0, 0, 0), Tag = i
                };
                removeBtn.Click += BtnRemoveTestEnvVar_Click;
                Grid.SetColumn(removeBtn, 2);
                row.Children.Add(removeBtn);

                TestEnvVarsSettingsList.Children.Add(row);
            }
        }

        /// <summary>Never render a stored secret in full — show a short masked preview only.</summary>
        private static string MaskValue(string? value)
        {
            if (string.IsNullOrEmpty(value)) return "(empty)";
            if (value.Length <= 4) return new string('•', value.Length);
            return value.Substring(0, 2) + new string('•', Math.Min(value.Length - 2, 8));
        }

        private void BtnEditTestEnvVar_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not int index) return;
            var settings = BuildConsoleSettings.Load();
            if (index < 0 || index >= settings.TestEnvironmentVariables.Count) return;

            var v = settings.TestEnvironmentVariables[index];
            TestEnvVarNameBox.Text = v.Name;
            TestEnvVarValueBox.Text = v.Value;
            _editingTestEnvVarIndex = index;
            BtnAddTestEnvVar.Content = "Save Changes";
        }

        private void BtnRemoveTestEnvVar_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not int index) return;
            var settings = BuildConsoleSettings.Load();
            if (index < 0 || index >= settings.TestEnvironmentVariables.Count) return;

            var removed = settings.TestEnvironmentVariables[index];
            settings.TestEnvironmentVariables.RemoveAt(index);
            settings.Save();
            ActivityLog.Log(TestEnvVarsChannel, $"removed \"{removed.Name}\"");

            _editingTestEnvVarIndex = -1;
            BtnAddTestEnvVar.Content = "Add Variable";
            TestEnvVarNameBox.Text = "";
            TestEnvVarValueBox.Text = "";
            RenderTestEnvVarsSettingsList();
        }

        private void BtnAddTestEnvVar_Click(object sender, RoutedEventArgs e)
        {
            var name = TestEnvVarNameBox.Text.Trim();
            var value = TestEnvVarValueBox.Text;
            if (string.IsNullOrWhiteSpace(name)) return;

            var settings = BuildConsoleSettings.Load();

            if (_editingTestEnvVarIndex >= 0 && _editingTestEnvVarIndex < settings.TestEnvironmentVariables.Count)
            {
                var v = settings.TestEnvironmentVariables[_editingTestEnvVarIndex];
                v.Name = name;
                v.Value = value;
                ActivityLog.Log(TestEnvVarsChannel, $"edited \"{name}\"");
            }
            else
            {
                // A repeat NAME edits the existing entry in place rather than adding a
                // duplicate — SeedConfigVariables would let the last one win anyway, but
                // keeping the store clean avoids a confusing double row in the list.
                var existing = settings.TestEnvironmentVariables.Find(x => string.Equals(x.Name, name, StringComparison.Ordinal));
                if (existing != null)
                {
                    existing.Value = value;
                    ActivityLog.Log(TestEnvVarsChannel, $"updated \"{name}\"");
                }
                else
                {
                    settings.TestEnvironmentVariables.Add(new TestEnvVar { Name = name, Value = value });
                    ActivityLog.Log(TestEnvVarsChannel, $"added \"{name}\"");
                }
            }

            settings.Save();

            _editingTestEnvVarIndex = -1;
            BtnAddTestEnvVar.Content = "Add Variable";
            TestEnvVarNameBox.Text = "";
            TestEnvVarValueBox.Text = "";
            RenderTestEnvVarsSettingsList();
        }
    }
}
