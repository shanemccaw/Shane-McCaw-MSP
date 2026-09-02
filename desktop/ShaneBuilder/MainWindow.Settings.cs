using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2204 (Epic #2198, wpf-handoff/readme-phase2.md Step 15) — Settings, redesigned. Real
/// audit before this build: ShaneBuilder had ZERO Settings surface — no view, no store, the gear
/// icon (<c>BtnRailSettings</c>) had no click handler at all. The "31 identical cards nagging
/// 'Needs Value'" state the issue describes lives only in the frozen legacy
/// <c>desktop/BuildConsole/MainWindow.SettingsTab.cs</c> (a different, separately-frozen app) —
/// this is a greenfield build against the real screen markup + <c>computeSettings()</c> logic in
/// <c>wpf-handoff/Shell Skeleton v2.dc.html</c> (lines 1441-1630, 6003-6147).
///
/// One surface only, per the readme's own trap warning: the gear icon
/// (<see cref="BtnRailSettings_Click"/>), the wrench-menu "Settings" entry, and the Ctrl+K
/// palette result all call <see cref="OpenSettingsTab"/> — there is no second/placeholder
/// Settings view anywhere else in this app.
///
/// Split into its own partial-class file so it stays isolated from the concurrently-edited
/// MainWindow.xaml.cs, same convention the old BuildConsole's MainWindow.SettingsTab.cs used.
/// </summary>
public partial class MainWindow
{
    private SettingsStoreService? _settingsStore;
    private SettingsStoreService SettingsStore => _settingsStore ??= new SettingsStoreService(_logService.MainRepoRoot);

    private string _settingsCategory = "testenv";
    private string _settingsQuery = "";
    private string _envDomainFilter = "ALL";
    private bool _envNeedsOnly;
    private readonly HashSet<string> _envRevealed = new(StringComparer.Ordinal);
    private readonly HashSet<string> _profileRevealed = new(StringComparer.Ordinal);
    private string _claudeAccount = "primary";
    private string _npUser = "", _npPw = "", _npDesc = "", _npTier = "Standard";
    private readonly Dictionary<string, string> _linkProjectDraft = new(StringComparer.Ordinal);

    private sealed record SettingsCatDef(string Id, string Label);
    private sealed record SettingsGroupDef(string Label, SettingsCatDef[] Items);
    private sealed record SimpleRowDef(string Id, string Label, SettingType Type, object Default, string[]? Options = null);
    private sealed record SimpleCatDef(string Title, string Desc, SimpleRowDef[] Rows);

    private static readonly SettingsGroupDef[] SettingsGroups =
    {
        new("Environment", new[] { new SettingsCatDef("testenv", "Test Environment"), new SettingsCatDef("sched", "Scheduled Runs") }),
        new("Credentials", new[] { new SettingsCatDef("apicreds", "API Tokens"), new SettingsCatDef("accounts", "Accounts & Tiers"), new SettingsCatDef("claude", "Claude Projects") }),
        new("Automation", new[] { new SettingsCatDef("watcher", "Replit Watcher"), new SettingsCatDef("ssh", "SSH & Remote"), new SettingsCatDef("webtools", "Web Tools") }),
        new("This machine", new[] { new SettingsCatDef("general", "General"), new SettingsCatDef("sound", "Sound & Audio"), new SettingsCatDef("linkedin", "LinkedIn Pre-fill") }),
    };

    // Real domain palette — every tone below is an EXISTING brush in Themes/Colors.xaml (the same
    // hex values the design source already uses for these exact concepts), not invented.
    private static readonly (string Id, string Label, string BrushKey)[] EnvDomains =
    {
        ("auth", "Auth & Security", "Brush.Epic.Gate"),
        ("graph", "Microsoft Graph", "Brush.Workspace.Designs"),
        ("mailer", "Mailer", "Brush.LogLevel.Warn"),
        ("admin", "Admin", "Brush.Epic.Portal"),
        ("ai", "AI & Copilot", "Brush.Accent.Primary"),
        ("smoke", "Smoke", "Brush.Status.Running"),
        ("general", "General", "Brush.Status.Verifying"),
    };

    private static readonly Dictionary<string, SimpleCatDef> SimpleCats = new()
    {
        ["general"] = new SimpleCatDef("General", "How the shell itself behaves.", new[]
        {
            new SimpleRowDef("theme", "Theme", SettingType.Select, "Dark", new[] { "Dark", "Midnight", "System" }),
            new SimpleRowDef("reopen", "Reopen the last workspace on launch", SettingType.Toggle, true),
            new SimpleRowDef("homefirst", "Always start on the Home page", SettingType.Toggle, false),
            new SimpleRowDef("apibase", "API server base URL", SettingType.Text, "http://localhost:8080"),
            new SimpleRowDef("graphver", "Graph API version", SettingType.Select, "v1.0", new[] { "v1.0", "beta" }),
            new SimpleRowDef("crash", "Send crash reports", SettingType.Toggle, false),
        }),
        ["watcher"] = new SimpleCatDef("Replit Watcher", "Watches a Replit workspace and reacts when a deploy lands.", new[]
        {
            new SimpleRowDef("wOn", "Watch deployments", SettingType.Toggle, false),
            new SimpleRowDef("wUrl", "Workspace URL", SettingType.Text, ""),
            new SimpleRowDef("wPoll", "Poll interval (seconds)", SettingType.Number, "30"),
            new SimpleRowDef("wRestart", "Restart the local service after a successful deploy", SettingType.Toggle, true),
            new SimpleRowDef("wCritter", "Send a critter across the screen when it succeeds", SettingType.Toggle, true),
        }),
        ["sched"] = new SimpleCatDef("Scheduled Runs", "Cron-style jobs the shell runs for you.", new[]
        {
            new SimpleRowDef("sReg", "Nightly regression suite", SettingType.Toggle, true),
            new SimpleRowDef("sRegCron", "Regression schedule", SettingType.Text, "0 2 * * *"),
            new SimpleRowDef("sDrift", "Hourly Graph drift sweep", SettingType.Toggle, true),
            new SimpleRowDef("sDriftCron", "Drift schedule", SettingType.Text, "0 * * * *"),
            new SimpleRowDef("sSeat", "Weekly seat reconcile", SettingType.Toggle, false),
            new SimpleRowDef("sSeatCron", "Seat reconcile schedule", SettingType.Text, "0 6 * * 1"),
        }),
        ["ssh"] = new SimpleCatDef("SSH & Remote", "The remote box builds and deploys are pushed to.", new[]
        {
            new SimpleRowDef("sshHost", "Host", SettingType.Text, ""),
            new SimpleRowDef("sshUser", "User", SettingType.Text, ""),
            new SimpleRowDef("sshPort", "Port", SettingType.Number, "22"),
            new SimpleRowDef("sshKey", "Private key path", SettingType.Text, ""),
            new SimpleRowDef("sshAlive", "Keepalive pings", SettingType.Toggle, true),
        }),
        ["webtools"] = new SimpleCatDef("Web Tools", "WebView2 tabs, external links, and the autofill lock.", new[]
        {
            new SimpleRowDef("browser", "Open external links in", SettingType.Select, "Edge", new[] { "Edge", "Chrome", "Default browser" }),
            new SimpleRowDef("lockOn", "Show the autofill lock on WebView2 tabs", SettingType.Toggle, true),
            new SimpleRowDef("lockClaude", "Never offer autofill on claude.ai", SettingType.Toggle, true),
            new SimpleRowDef("devtools", "Allow DevTools in WebView2 tabs", SettingType.Toggle, true),
            new SimpleRowDef("zoom", "Default zoom (%)", SettingType.Number, "100"),
        }),
        ["sound"] = new SimpleCatDef("Sound & Audio", "What the shell is allowed to make noise about.", new[]
        {
            new SimpleRowDef("vol", "Master volume (%)", SettingType.Number, "60"),
            new SimpleRowDef("chime", "Build finished chime", SettingType.Select, "Soft", new[] { "Soft", "Arcade", "Off" }),
            new SimpleRowDef("critterSfx", "Critter sound effects", SettingType.Toggle, true),
            new SimpleRowDef("muteStream", "Stay quiet while logs are streaming", SettingType.Toggle, true),
            new SimpleRowDef("voice", "Read Claude questions aloud", SettingType.Toggle, false),
        }),
        ["linkedin"] = new SimpleCatDef("LinkedIn Pre-fill", "Values the shell types into application forms for you.", new[]
        {
            new SimpleRowDef("liName", "Full name", SettingType.Text, ""),
            new SimpleRowDef("liHeadline", "Headline", SettingType.Text, ""),
            new SimpleRowDef("liEmail", "Email", SettingType.Text, ""),
            new SimpleRowDef("liPhone", "Phone", SettingType.Text, ""),
            new SimpleRowDef("liAuto", "Pre-fill automatically on job pages", SettingType.Toggle, true),
        }),
    };

    // ── Entry points — gear icon, wrench menu, Ctrl+K palette all land here ─────────────────────
    private void BtnRailSettings_Click(object sender, RoutedEventArgs e) => OpenSettingsTab();

    private void OpenSettingsTab(string? category = null)
    {
        if (_tabs.Find(t => t.Id == "settings") == null)
            _tabs.Add(new TabDef("settings", "Settings", isSettings: true, kind: TabKind.Log, dot: (Brush)FindResource("Brush.Status.Verifying")));
        if (category != null)
        {
            _settingsCategory = category;
            if (category == "testenv") { _envNeedsOnly = true; _envDomainFilter = "ALL"; _settingsQuery = ""; }
        }
        SelectTab("settings");
    }

    // ── Top-level render ─────────────────────────────────────────────────────────────────────────
    private void RenderSettings()
    {
        RenderSettingsHealthChips();
        RenderSettingsRail();
        RenderSettingsContent();
    }

    private void RenderSettingsHealthChips()
    {
        SettingsHealthChips.Children.Clear();
        var vars = SettingsStore.ScanManifests();
        var needsCount = vars.Count(v => string.IsNullOrEmpty(v.Value));
        var githubPat = SettingsStore.Get("secret:token:github", "");
        var zohoToken = SettingsStore.Get("secret:token:zoho", "");
        var watcherOn = SettingsStore.Get("wOn", false);

        AddHealthChip(needsCount == 0 ? "Every variable has a value" : $"{needsCount} variable{(needsCount == 1 ? "" : "s")} still need a value",
            needsCount == 0, () => OpenSettingsTab("testenv"));
        AddHealthChip(string.IsNullOrEmpty(githubPat) ? "GitHub PAT missing" : "GitHub PAT configured",
            !string.IsNullOrEmpty(githubPat), () => { _settingsCategory = "apicreds"; RenderSettings(); });
        AddHealthChip(string.IsNullOrEmpty(zohoToken) ? "Zoho API not set" : "Zoho API configured",
            !string.IsNullOrEmpty(zohoToken), () => { _settingsCategory = "apicreds"; RenderSettings(); });
        AddHealthChip(watcherOn ? "Replit watcher on" : "Replit watcher off",
            watcherOn, () => { _settingsCategory = "watcher"; RenderSettings(); });
    }

    private void AddHealthChip(string label, bool ok, Action onClick)
    {
        var okBrush = (Brush)FindResource("Brush.Status.Running");
        var warnBrush = (Brush)FindResource("Brush.LogLevel.Warn");
        var tone = ok ? okBrush : warnBrush;
        var chip = new Border
        {
            CornerRadius = new CornerRadius(99), Padding = new Thickness(9, 4, 9, 4), Margin = new Thickness(0, 0, 5, 0),
            Cursor = Cursors.Hand, Background = Tint(tone, 0x1A), BorderBrush = Tint(tone, 0x57), BorderThickness = new Thickness(1),
        };
        var sp = new StackPanel { Orientation = Orientation.Horizontal };
        sp.Children.Add(new Ellipse { Width = 5, Height = 5, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center, Fill = tone });
        sp.Children.Add(new TextBlock
        {
            Text = label, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = tone,
        });
        chip.Child = sp;
        chip.MouseLeftButtonDown += (s, e) => onClick();
        SettingsHealthChips.Children.Add(chip);
    }

    private void RenderSettingsRail()
    {
        SettingsRailColumn.Width = new GridLength(ActualWidth < 1150 ? 186 : 214);
        SettingsRailPanel.Children.Clear();
        var vars = SettingsStore.ScanManifests();
        var needsCount = vars.Count(v => string.IsNullOrEmpty(v.Value));
        var zohoSet = !string.IsNullOrEmpty(SettingsStore.Get("secret:token:zoho", ""));

        foreach (var g in SettingsGroups)
        {
            var header = new TextBlock
            {
                Text = g.Label.ToUpperInvariant(), Margin = new Thickness(8, 6, 8, 4),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8.5,
                FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Dim"),
            };
            SettingsRailPanel.Children.Add(header);

            foreach (var item in g.Items)
            {
                bool on = item.Id == _settingsCategory;
                string badge = item.Id == "testenv" ? (needsCount > 0 ? needsCount.ToString() : "")
                    : item.Id == "apicreds" && !zohoSet ? "1" : "";

                var row = new Border
                {
                    CornerRadius = new CornerRadius(7), Padding = new Thickness(9, 7, 9, 7), Margin = new Thickness(0, 0, 0, 1),
                    Cursor = Cursors.Hand, Background = on ? Tint((Brush)FindResource("Brush.Status.Verifying"), 0x1F) : Brushes.Transparent,
                    BorderThickness = new Thickness(2, 0, 0, 0), BorderBrush = on ? (Brush)FindResource("Brush.Status.Verifying") : Brushes.Transparent,
                };
                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var label = new TextBlock
                {
                    Text = item.Label, TextTrimming = TextTrimming.CharacterEllipsis,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
                    FontWeight = on ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
                    Foreground = on ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Text.Muted"),
                };
                Grid.SetColumn(label, 0);
                grid.Children.Add(label);
                if (!string.IsNullOrEmpty(badge))
                {
                    var badgeChip = new Border
                    {
                        CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                        Background = Tint((Brush)FindResource("Brush.LogLevel.Warn"), 0x29),
                        Child = new TextBlock
                        {
                            Text = badge, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 8.5,
                            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.LogLevel.Warn"),
                        }
                    };
                    Grid.SetColumn(badgeChip, 1);
                    grid.Children.Add(badgeChip);
                }
                row.Child = grid;
                var capturedId = item.Id;
                row.MouseLeftButtonDown += (s, e) => { _settingsCategory = capturedId; _settingsQuery = ""; SettingsSearchBox.Text = ""; RenderSettings(); };
                SettingsRailPanel.Children.Add(row);
            }
        }
    }

    private void RenderSettingsContent()
    {
        SettingsContentPanel.Children.Clear();
        SettingsSearchBox.ToolTip = _settingsCategory == "testenv" ? "Search variables by name or manifest…" : "Search these settings…";

        switch (_settingsCategory)
        {
            case "testenv": RenderSettingsEnv(); break;
            case "apicreds": RenderSettingsCreds(); break;
            case "accounts": RenderSettingsAccounts(); break;
            case "claude": RenderSettingsClaude(); break;
            default: RenderSettingsSimple(_settingsCategory); break;
        }
    }

    private void SettingsSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _settingsQuery = SettingsSearchBox.Text ?? "";
        RenderSettingsContent();
    }

    // ── Test Environment Variables — real ISettingsStore.ScanManifests(), no fixture rows ────────
    private void RenderSettingsEnv()
    {
        var panel = SettingsContentPanel;
        var allVars = SettingsStore.ScanManifests();
        var needsCount = allVars.Count(v => string.IsNullOrEmpty(v.Value));

        var headRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
        headRow.Children.Add(new TextBlock
        {
            Text = "Test Environment Variables", FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.15"),
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading"),
        });
        panel.Children.Add(headRow);
        panel.Children.Add(new TextBlock
        {
            Text = "Injected into test manifests wherever {{NAME}} appears. Real scan of test-manifests/ — anything without a value is called out first.",
            Margin = new Thickness(0, 0, 0, 10), TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
        });

        var toolsRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        toolsRow.Children.Add(MakeGhostButton("Re-scan manifests", () => { RenderSettings(); ToastEngine.Show("Settings", $"Re-scanned test-manifests/ — {allVars.Count} variable{(allVars.Count == 1 ? "" : "s")} found.", ToastKind.Info); }));
        toolsRow.Children.Add(MakeGhostButton("Copy as .env", () =>
        {
            try { Clipboard.SetText(string.Join('\n', allVars.Select(v => $"{v.Name}={v.Value}"))); ToastEngine.Show("Settings", "Copied .env to clipboard.", ToastKind.Success); }
            catch { /* clipboard can be locked by another process — not fatal */ }
        }));
        panel.Children.Add(toolsRow);

        var filterRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        var needsBtn = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 5, 10, 5), Margin = new Thickness(0, 0, 5, 5), Cursor = Cursors.Hand,
            Background = _envNeedsOnly ? Tint((Brush)FindResource("Brush.LogLevel.Warn"), 0x24) : Brushes.Transparent,
            BorderBrush = _envNeedsOnly ? Tint((Brush)FindResource("Brush.LogLevel.Warn"), 0x80) : (Brush)FindResource("Brush.Border.Card"),
            BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = $"NEEDS VALUE ({needsCount})", FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10"),
                FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
                Foreground = _envNeedsOnly ? (Brush)FindResource("Brush.LogLevel.Warn") : (Brush)FindResource("Brush.Text.Dim"),
            }
        };
        needsBtn.MouseLeftButtonDown += (s, e) => { _envNeedsOnly = !_envNeedsOnly; RenderSettings(); };
        filterRow.Children.Add(needsBtn);

        var domainCounts = new[] { ("ALL", "All", "Brush.Status.Verifying") }
            .Concat(EnvDomains.Select(d => (d.Id, d.Label, d.BrushKey)))
            .ToArray();
        foreach (var (id, label, brushKey) in domainCounts)
        {
            int n = id == "ALL" ? allVars.Count : allVars.Count(v => v.Domain == id);
            bool on = _envDomainFilter == id;
            var tone = (Brush)FindResource(brushKey);
            var chip = new Border
            {
                CornerRadius = new CornerRadius(6), Padding = new Thickness(9, 4, 9, 4), Margin = new Thickness(0, 0, 5, 5), Cursor = Cursors.Hand,
                Background = on ? Tint(tone, 0x24) : Brushes.Transparent, BorderBrush = on ? Tint(tone, 0x80) : (Brush)FindResource("Brush.Border.Card"),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = $"{label} ({n})", FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = on ? tone : (Brush)FindResource("Brush.Text.Dim"),
                }
            };
            var capturedId = id;
            chip.MouseLeftButtonDown += (s, e) => { _envDomainFilter = capturedId; RenderSettings(); };
            filterRow.Children.Add(chip);
        }
        panel.Children.Add(filterRow);

        var q = _settingsQuery.Trim();
        var shown = allVars.Where(v => _envDomainFilter == "ALL" || v.Domain == _envDomainFilter);
        if (_envNeedsOnly) shown = shown.Where(v => string.IsNullOrEmpty(v.Value));
        if (!string.IsNullOrEmpty(q)) shown = shown.Where(v => (v.Name + " " + string.Join(' ', v.UsedInManifests)).Contains(q, StringComparison.OrdinalIgnoreCase));
        var shownList = shown.ToList();

        panel.Children.Add(new TextBlock
        {
            Text = $"{shownList.Count} of {allVars.Count} shown", Margin = new Thickness(0, 0, 0, 6),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5, Foreground = (Brush)FindResource("Brush.Text.Dim"),
        });

        if (shownList.Count == 0)
        {
            panel.Children.Add(new TextBlock
            {
                Text = allVars.Count == 0 ? "No {{NAME}} tokens found under test-manifests/." : "Nothing matches the current filters.",
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim"), Margin = new Thickness(0, 4, 0, 0),
            });
        }

        foreach (var v in shownList)
        {
            panel.Children.Add(BuildEnvVarRow(v));
        }
    }

    private FrameworkElement BuildEnvVarRow(EnvVar v)
    {
        bool filled = !string.IsNullOrEmpty(v.Value);
        bool secret = SettingsStoreService.IsSecretShaped(v.Name);
        bool revealed = _envRevealed.Contains(v.Name);
        var domainTone = (Brush)FindResource(EnvDomains.FirstOrDefault(d => d.Id == v.Domain).BrushKey ?? "Brush.Status.Verifying");
        var accent = filled ? (Brush)FindResource("Brush.Border.Card") : Tint((Brush)FindResource("Brush.LogLevel.Warn"), 0x52);

        var row = new Border
        {
            CornerRadius = new CornerRadius(8), Padding = new Thickness(11, 8, 11, 8), Margin = new Thickness(0, 0, 0, 4),
            Background = filled ? (Brush)FindResource("Brush.Bg.Card") : Tint((Brush)FindResource("Brush.LogLevel.Warn"), 0x0D),
            BorderBrush = accent, BorderThickness = new Thickness(1),
        };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 160 });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var nameCol = new StackPanel();
        nameCol.Children.Add(new TextBlock
        {
            Text = v.Name, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.11"),
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), TextWrapping = TextWrapping.Wrap,
            Foreground = filled ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.LogLevel.Warn"),
        });
        var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 3, 0, 0) };
        metaRow.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 6, 0),
            Background = Tint(domainTone, 0x24),
            Child = new TextBlock { Text = EnvDomains.FirstOrDefault(d => d.Id == v.Domain).Label ?? v.Domain, FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = domainTone },
        });
        var usedText = v.UsedInManifests.Length == 0 || (v.UsedInManifests.Length == 1 && v.UsedInManifests[0].StartsWith("—"))
            ? "not referenced by any manifest"
            : $"used in {v.UsedInManifests.Length} manifest{(v.UsedInManifests.Length == 1 ? "" : "s")}";
        metaRow.Children.Add(new TextBlock { Text = usedText, FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim"), ToolTip = string.Join('\n', v.UsedInManifests) });
        nameCol.Children.Add(metaRow);
        Grid.SetColumn(nameCol, 0);
        grid.Children.Add(nameCol);

        var displayValue = filled && secret && !revealed ? MaskSecret(v.Value) : v.Value;
        var input = new TextBox
        {
            Text = displayValue, Margin = new Thickness(9, 0, 6, 0), Height = 26, VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(8, 0, 8, 0), IsReadOnly = secret && !revealed,
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = accent,
            Foreground = filled ? (Brush)FindResource("Brush.Text.Primary") : (Brush)FindResource("Brush.LogLevel.Warn"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
        };
        var capturedName = v.Name;
        input.LostFocus += (s, e) => { if (!(secret && !revealed)) SettingsStore.SetEnvVarValue(capturedName, input.Text); };
        input.KeyDown += (s, e) => { if (e.Key == Key.Enter && !(secret && !revealed)) { SettingsStore.SetEnvVarValue(capturedName, input.Text); RenderSettings(); } };
        Grid.SetColumn(input, 1);
        grid.Children.Add(input);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(MakeIconAction("Reveal", () => { if (revealed) _envRevealed.Remove(capturedName); else _envRevealed.Add(capturedName); RenderSettings(); }, (Brush)FindResource("Brush.Text.Muted")));
        actions.Children.Add(MakeIconAction("Copy", () => { try { Clipboard.SetText(v.Value); ToastEngine.Show("Settings", $"Copied {v.Name}.", ToastKind.Success); } catch { } }, (Brush)FindResource("Brush.Text.Muted")));
        actions.Children.Add(MakeIconAction("Clear", () => { SettingsStore.SetEnvVarValue(capturedName, ""); RenderSettings(); }, (Brush)FindResource("Brush.Epic.Gate")));
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        row.Child = grid;
        return row;
    }

    private static string MaskSecret(string value) => value.Length <= 2 ? new string('•', 4) : value.Substring(0, 2) + new string('•', Math.Max(4, value.Length - 2));

    private UIElement MakeIconAction(string label, Action onClick, Brush fg)
    {
        var tb = new TextBlock { Text = label, Margin = new Thickness(6, 0, 0, 0), FontSize = 9.5, Foreground = fg, Cursor = Cursors.Hand, ToolTip = label };
        tb.MouseLeftButtonDown += (s, e) => onClick();
        return tb;
    }

    // ── API Tokens & Credentials ─────────────────────────────────────────────────────────────────
    private void RenderSettingsCreds()
    {
        var panel = SettingsContentPanel;
        panel.Children.Add(SectionTitle("API Tokens & Credentials"));
        panel.Children.Add(SectionDesc("Stored in the Windows credential store on this machine, never in the repo."));

        panel.Children.Add(BuildTokenCard("GitHub Personal Access Token", "Git Board sync, milestones, sub-issue links, closing issues.", "secret:token:github"));
        panel.Children.Add(BuildTokenCard("Zoho API Token", "Zoho CRM test manifests and automation auth.", "secret:token:zoho"));
    }

    private FrameworkElement BuildTokenCard(string label, string hint, string storeKey)
    {
        var value = SettingsStore.Get(storeKey, "");
        bool set = !string.IsNullOrEmpty(value);
        var card = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(13, 11, 13, 11), Margin = new Thickness(0, 0, 0, 8), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
        var col = new StackPanel();
        var head = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
        head.Children.Add(new TextBlock { Text = label, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"), FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"), Margin = new Thickness(0, 0, 8, 0) });
        var pillTone = set ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.LogLevel.Warn");
        head.Children.Add(new Border { CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), Background = Tint(pillTone, 0x29), Child = new TextBlock { Text = set ? "CONFIGURED" : "NOT SET", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = pillTone } });
        col.Children.Add(head);
        col.Children.Add(new TextBlock { Text = hint, Margin = new Thickness(0, 0, 0, 7), FontSize = 10.5, Foreground = (Brush)FindResource("Brush.Text.Dim") });

        var row = new DockPanel();
        var input = new TextBox { Text = value, Height = 28, Padding = new Thickness(9, 0, 9, 0), VerticalContentAlignment = VerticalAlignment.Center, Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), Foreground = (Brush)FindResource("Brush.Text.Primary"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5 };
        var saveBtn = MakeGhostButton("Save", () => { SettingsStore.Set(storeKey, input.Text); RenderSettings(); ToastEngine.Show("Settings", $"{label} saved to the local credential store.", ToastKind.Success); });
        var copyBtn = MakeGhostButton("Copy", () => { try { Clipboard.SetText(value); ToastEngine.Show("Settings", "Copied.", ToastKind.Success); } catch { } });
        DockPanel.SetDock(saveBtn, Dock.Right); DockPanel.SetDock(copyBtn, Dock.Right);
        saveBtn.Margin = new Thickness(6, 0, 0, 0); copyBtn.Margin = new Thickness(6, 0, 0, 0);
        row.Children.Add(saveBtn); row.Children.Add(copyBtn); row.Children.Add(input);
        col.Children.Add(row);
        card.Child = col;
        return card;
    }

    // ── Accounts & Tiers — real source of truth for #2202's autofill lock ───────────────────────
    private void RenderSettingsAccounts()
    {
        var panel = SettingsContentPanel;
        panel.Children.Add(SectionTitle("Accounts & Tiers"));
        panel.Children.Add(SectionDesc("These are the profiles the autofill lock offers on WebView2 tabs and in the API explorers. Add one here or straight from the lock."));

        var profiles = SettingsStore.GetProfiles();
        if (profiles.Count == 0)
        {
            panel.Children.Add(new TextBlock { Text = "No gated profiles yet — add one below.", FontSize = 11, Foreground = (Brush)FindResource("Brush.Text.Dim"), Margin = new Thickness(0, 0, 0, 10) });
        }
        foreach (var p in profiles) panel.Children.Add(BuildProfileRow(p));

        panel.Children.Add(BuildAddProfileForm());
    }

    private FrameworkElement BuildProfileRow(AccountProfile p)
    {
        bool revealed = _profileRevealed.Contains(p.Id);
        var row = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(0, 0, 0, 5), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var infoCol = new StackPanel();
        infoCol.Children.Add(new TextBlock { Text = p.User, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"), FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"), TextTrimming = TextTrimming.CharacterEllipsis });
        var pw = revealed ? p.Password : new string('•', Math.Max(8, p.Password.Length));
        infoCol.Children.Add(new TextBlock { Text = $"{pw} · {p.Description}", FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Dim"), Margin = new Thickness(0, 2, 0, 0) });
        Grid.SetColumn(infoCol, 0);
        grid.Children.Add(infoCol);

        var tierTone = p.Tier switch { "Enterprise" => (Brush)FindResource("Brush.Workspace.Designs"), "Premium" => (Brush)FindResource("Brush.Epic.Portal"), _ => (Brush)FindResource("Brush.Status.Verifying") };
        var tierChip = new Border { CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 2, 7, 2), Margin = new Thickness(8, 0, 8, 0), Background = Tint(tierTone, 0x29), BorderBrush = Tint(tierTone, 0x66), BorderThickness = new Thickness(1), Child = new TextBlock { Text = p.Tier, FontSize = 9, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = tierTone } };
        Grid.SetColumn(tierChip, 1);
        grid.Children.Add(tierChip);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        var capturedId = p.Id;
        actions.Children.Add(MakeIconAction("Reveal", () => { if (revealed) _profileRevealed.Remove(capturedId); else _profileRevealed.Add(capturedId); RenderSettings(); }, (Brush)FindResource("Brush.Text.Muted")));
        actions.Children.Add(MakeIconAction("Copy", () => { try { Clipboard.SetText(p.User + "\t" + p.Password); ToastEngine.Show("Settings", "Copied.", ToastKind.Success); } catch { } }, (Brush)FindResource("Brush.Text.Muted")));
        actions.Children.Add(MakeIconAction("Remove", () => { SettingsStore.RemoveProfile(capturedId); RenderSettings(); }, (Brush)FindResource("Brush.Epic.Gate")));
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        row.Child = grid;
        return row;
    }

    private FrameworkElement BuildAddProfileForm()
    {
        var card = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(13, 12, 13, 12), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
        var col = new StackPanel();
        col.Children.Add(new TextBlock { Text = "Add a gated test profile", FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"), Margin = new Thickness(0, 0, 0, 8) });

        var row1 = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };
        var userBox = new TextBox { Text = _npUser, Width = 220, Height = 28, Margin = new Thickness(0, 0, 6, 0), Padding = new Thickness(8, 0, 8, 0), Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), Foreground = (Brush)FindResource("Brush.Text.Heading"), FontSize = 11, Tag = "username or email" };
        SetPlaceholder(userBox, "username or email");
        userBox.TextChanged += (s, e) => _npUser = userBox.Text;
        var pwBox = new TextBox { Text = _npPw, Width = 180, Height = 28, Padding = new Thickness(8, 0, 8, 0), Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), Foreground = (Brush)FindResource("Brush.Text.Heading"), FontSize = 11 };
        pwBox.TextChanged += (s, e) => _npPw = pwBox.Text;
        row1.Children.Add(userBox); row1.Children.Add(pwBox);
        col.Children.Add(row1);

        var descBox = new TextBox { Text = _npDesc, Height = 28, Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(8, 0, 8, 0), Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), Foreground = (Brush)FindResource("Brush.Text.Heading"), FontSize = 11 };
        descBox.TextChanged += (s, e) => _npDesc = descBox.Text;
        col.Children.Add(descBox);

        var tierRow = new WrapPanel();
        foreach (var tier in new[] { "Standard", "Enterprise", "Premium" })
        {
            bool on = _npTier == tier;
            var btn = new Border { CornerRadius = new CornerRadius(6), Padding = new Thickness(11, 5, 11, 5), Margin = new Thickness(0, 0, 5, 0), Cursor = Cursors.Hand, Background = on ? Tint((Brush)FindResource("Brush.Workspace.Designs"), 0x24) : Brushes.Transparent, BorderBrush = on ? Tint((Brush)FindResource("Brush.Workspace.Designs"), 0x80) : (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1), Child = new TextBlock { Text = tier, FontSize = 11, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = on ? (Brush)FindResource("Brush.Workspace.Designs") : (Brush)FindResource("Brush.Text.Dim") } };
            var capturedTier = tier;
            btn.MouseLeftButtonDown += (s, e) => { _npTier = capturedTier; RenderSettings(); };
            tierRow.Children.Add(btn);
        }
        var addBtn = new Border { CornerRadius = new CornerRadius(6), Padding = new Thickness(14, 5, 14, 5), Margin = new Thickness(8, 0, 0, 0), Cursor = Cursors.Hand, Background = (Brush)FindResource("Brush.Workspace.Designs"), Child = new TextBlock { Text = "Add profile", FontSize = 11, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = Brushes.Black } };
        addBtn.MouseLeftButtonDown += (s, e) =>
        {
            if (string.IsNullOrWhiteSpace(_npUser)) { ToastEngine.Show("Settings", "Enter a username or email first.", ToastKind.Info); return; }
            SettingsStore.AddProfile(_npUser.Trim(), _npPw, _npDesc.Trim(), _npTier);
            _npUser = ""; _npPw = ""; _npDesc = ""; _npTier = "Standard";
            RenderSettings();
            ToastEngine.Show("Settings", "Profile added.", ToastKind.Success);
        };
        tierRow.Children.Add(addBtn);
        col.Children.Add(tierRow);

        card.Child = col;
        return card;
    }

    // ── Claude Projects — Primary/Secondary, each with its own real project list ────────────────
    private void RenderSettingsClaude()
    {
        var panel = SettingsContentPanel;
        panel.Children.Add(SectionTitle("Claude Projects"));
        panel.Children.Add(SectionDesc("Both accounts are configured separately — the shell routes a chat to whichever account owns its project."));

        var tabRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
        foreach (var (id, label) in new[] { ("primary", "Primary account"), ("secondary", "Secondary account") })
        {
            bool on = _claudeAccount == id;
            var btn = new Border { CornerRadius = new CornerRadius(7), Padding = new Thickness(13, 6, 13, 6), Margin = new Thickness(0, 0, 6, 0), Cursor = Cursors.Hand, Background = on ? Tint((Brush)FindResource("Brush.Accent.Primary"), 0x24) : Brushes.Transparent, BorderBrush = on ? Tint((Brush)FindResource("Brush.Accent.Primary"), 0x80) : (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1), Child = new TextBlock { Text = label, FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = on ? (Brush)FindResource("Brush.Accent.Primary") : (Brush)FindResource("Brush.Text.Dim") } };
            var capturedId = id;
            btn.MouseLeftButtonDown += (s, e) => { _claudeAccount = capturedId; RenderSettings(); };
            tabRow.Children.Add(btn);
        }
        panel.Children.Add(tabRow);

        var emailKey = $"claude:{_claudeAccount}:email";
        var planKey = $"claude:{_claudeAccount}:plan";
        var idCard = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(13, 11, 13, 11), Margin = new Thickness(0, 0, 0, 10), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
        var idCol = new StackPanel();
        var emailBox = new TextBox { Text = SettingsStore.Get(emailKey, ""), Height = 26, Margin = new Thickness(0, 0, 0, 5), Padding = new Thickness(0), BorderThickness = new Thickness(0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Heading"), FontSize = 12, FontWeight = (FontWeight)FindResource("FontWeight.Bold") };
        SetPlaceholder(emailBox, "account email — not set");
        emailBox.LostFocus += (s, e) => SettingsStore.Set(emailKey, emailBox.Text);
        var planBox = new TextBox { Text = SettingsStore.Get(planKey, ""), Height = 22, Padding = new Thickness(0), BorderThickness = new Thickness(0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Dim"), FontSize = 10.5 };
        SetPlaceholder(planBox, "plan & routing — not set");
        planBox.LostFocus += (s, e) => SettingsStore.Set(planKey, planBox.Text);
        idCol.Children.Add(emailBox); idCol.Children.Add(planBox);
        idCard.Child = idCol;
        panel.Children.Add(idCard);

        var projects = SettingsStore.GetClaudeProjects(_claudeAccount);
        if (projects.Count == 0)
        {
            panel.Children.Add(new TextBlock { Text = "No projects linked to this account yet.", FontSize = 11, Foreground = (Brush)FindResource("Brush.Text.Dim"), Margin = new Thickness(0, 0, 0, 8) });
        }
        foreach (var p in projects)
        {
            var row = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(11, 8, 11, 8), Margin = new Thickness(0, 0, 0, 5), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
            var rowGrid = new StackPanel { Orientation = Orientation.Horizontal };
            rowGrid.Children.Add(new TextBlock { Text = p.Name, FontSize = 12, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"), Margin = new Thickness(0, 0, 10, 0) });
            rowGrid.Children.Add(new TextBlock { Text = $"{p.ChatCount} chat{(p.ChatCount == 1 ? "" : "s")} · last used {p.LastUsedLabel}", FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Dim") });
            row.Child = rowGrid;
            panel.Children.Add(row);
        }

        if (!_linkProjectDraft.TryGetValue(_claudeAccount, out var draft)) draft = "";
        var linkRow = new DockPanel { Margin = new Thickness(0, 8, 0, 0) };
        var linkBox = new TextBox { Text = draft, Height = 28, Padding = new Thickness(9, 0, 9, 0), Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), Foreground = (Brush)FindResource("Brush.Text.Heading"), FontSize = 11 };
        SetPlaceholder(linkBox, "project name to link");
        linkBox.TextChanged += (s, e) => _linkProjectDraft[_claudeAccount] = linkBox.Text;
        var linkBtn = MakeGhostButton("Link another project to this account", () =>
        {
            if (string.IsNullOrWhiteSpace(linkBox.Text)) { ToastEngine.Show("Settings", "Type the project name first.", ToastKind.Info); return; }
            SettingsStore.AddClaudeProject(_claudeAccount, linkBox.Text.Trim());
            _linkProjectDraft[_claudeAccount] = "";
            RenderSettings();
        });
        DockPanel.SetDock(linkBtn, Dock.Right); linkBtn.Margin = new Thickness(6, 0, 0, 0);
        linkRow.Children.Add(linkBtn); linkRow.Children.Add(linkBox);
        panel.Children.Add(linkRow);
    }

    // ── "Simple" settings categories — toggle / text / select rows, real persisted values ───────
    private void RenderSettingsSimple(string catId)
    {
        var panel = SettingsContentPanel;
        if (!SimpleCats.TryGetValue(catId, out var cat))
        {
            panel.Children.Add(new TextBlock { Text = "Unknown settings category.", Foreground = (Brush)FindResource("Brush.Text.Dim") });
            return;
        }
        panel.Children.Add(SectionTitle(cat.Title));
        panel.Children.Add(SectionDesc(cat.Desc));

        var q = _settingsQuery.Trim();
        var defs = string.IsNullOrEmpty(q) ? cat.Rows : cat.Rows.Where(r => r.Label.Contains(q, StringComparison.OrdinalIgnoreCase)).ToArray();

        // Materialize the contract's own SettingRow — id/label/type straight off the static
        // schema, Value resolved live from ISettingsStore.Get. This is the actual live row
        // instance the readme's contract describes, not just a definition table.
        var rows = defs.Select(d => new SettingRow(
            d.Id, d.Label, d.Type,
            d.Type == SettingType.Toggle ? SettingsStore.Get(d.Id, (bool)d.Default) : SettingsStore.Get(d.Id, d.Default.ToString() ?? ""),
            d.Options ?? Array.Empty<string>()));

        foreach (var r in rows) panel.Children.Add(BuildSimpleRow(r));
    }

    private FrameworkElement BuildSimpleRow(SettingRow r)
    {
        var row = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(0, 0, 0, 2), Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1) };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = 150 });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new TextBlock { Text = r.Label, TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = (Brush)FindResource("Brush.Text.Primary"), VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        UIElement control = r.Type switch
        {
            SettingType.Toggle => BuildToggle(r),
            SettingType.Text or SettingType.Number => BuildTextControl(r),
            SettingType.Select => BuildSelectControl(r),
            _ => new TextBlock(),
        };
        Grid.SetColumn(control, 1);
        grid.Children.Add(control);
        row.Child = grid;
        return row;
    }

    private UIElement BuildToggle(SettingRow r)
    {
        bool v = (bool)r.Value;
        var track = new Border
        {
            Width = 34, Height = 18, CornerRadius = new CornerRadius(99), Cursor = Cursors.Hand, VerticalAlignment = VerticalAlignment.Center,
            Background = v ? Tint((Brush)FindResource("Brush.Status.Running"), 0x80) : new SolidColorBrush(Color.FromArgb(0x18, 0xFF, 0xFF, 0xFF)),
        };
        var knob = new Ellipse { Width = 12, Height = 12, Fill = v ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Text.Muted"), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(v ? 19 : 3, 3, 0, 0) };
        var host = new Grid(); host.Children.Add(knob);
        track.Child = host;
        track.MouseLeftButtonDown += (s, e) => { SettingsStore.Set(r.Id, !v); RenderSettings(); };
        return track;
    }

    private UIElement BuildTextControl(SettingRow r)
    {
        var v = (string)r.Value;
        var box = new TextBox
        {
            Text = v, Width = 190, Height = 28, Padding = new Thickness(9, 0, 9, 0), VerticalContentAlignment = VerticalAlignment.Center,
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 11,
        };
        box.LostFocus += (s, e) => SettingsStore.Set(r.Id, box.Text);
        box.KeyDown += (s, e) => { if (e.Key == Key.Enter) SettingsStore.Set(r.Id, box.Text); };
        return box;
    }

    private UIElement BuildSelectControl(SettingRow r)
    {
        var v = (string)r.Value;
        var wrap = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var opt in r.Options)
        {
            bool on = v == opt;
            var btn = new Border { CornerRadius = new CornerRadius(6), Padding = new Thickness(11, 5, 11, 5), Margin = new Thickness(4, 0, 0, 0), Cursor = Cursors.Hand, Background = on ? Tint((Brush)FindResource("Brush.Status.Verifying"), 0x24) : Brushes.Transparent, BorderBrush = on ? Tint((Brush)FindResource("Brush.Status.Verifying"), 0x80) : (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1), Child = new TextBlock { Text = opt, FontSize = 10.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = on ? (Brush)FindResource("Brush.Status.Verifying") : (Brush)FindResource("Brush.Text.Dim") } };
            var capturedOpt = opt;
            btn.MouseLeftButtonDown += (s, e) => { SettingsStore.Set(r.Id, capturedOpt); RenderSettings(); };
            wrap.Children.Add(btn);
        }
        return wrap;
    }

    // ── Small shared builders ────────────────────────────────────────────────────────────────────
    private TextBlock SectionTitle(string text) => new()
    {
        Text = text, Margin = new Thickness(0, 0, 0, 4), FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.15"),
        FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading"),
    };

    private TextBlock SectionDesc(string text) => new()
    {
        Text = text, Margin = new Thickness(0, 0, 0, 12), TextWrapping = TextWrapping.Wrap,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"), Foreground = (Brush)FindResource("Brush.Text.Muted"),
    };

    private Border MakeGhostButton(string label, Action onClick)
    {
        var btn = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 5, 10, 5), Margin = new Thickness(0, 0, 5, 5), Cursor = Cursors.Hand,
            BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1),
            Child = new TextBlock { Text = label, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"), FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Primary") },
        };
        btn.MouseLeftButtonDown += (s, e) => onClick();
        return btn;
    }

    private static void SetPlaceholder(TextBox box, string placeholder)
    {
        // No native WPF placeholder support — a minimal watermark via a Tag-driven overlay would
        // need a template; a plain ToolTip is the honest, low-risk substitute used elsewhere in
        // this file (see BuildEnvVarRow's "used in N manifests" tooltip) rather than a new style.
        box.ToolTip = placeholder;
    }
}
