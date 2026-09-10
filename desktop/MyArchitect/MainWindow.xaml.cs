using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Wpf;
using Wpf.Ui.Controls;
using MyArchitect.Models;
using MyArchitect.Services;
using MyArchitect.Shell;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace MyArchitect;

/// <summary>
/// Main window operator shell — UI Shell Redesign (#3493): a Fluent.Ribbon fixed/contextual tab
/// bar, a left reference panel, a right full-panel record workspace, a command palette, and the
/// title-bar QAT, all assembled from <see cref="ShellRegistry"/> per UI_RULES.md. Portal tab
/// management (WebView2 hosting, per-tenant isolation) is unchanged from the pre-shell version.
/// </summary>
public partial class MainWindow : FluentWindow
{
    private readonly ITenantService _tenantService;
    private readonly IWebViewProfileService _profileService;
    private readonly TrayIconManager _trayIconManager;
    private readonly ObservableCollection<PortalTabItem> _tabs = new();
    private PortalTabItem? _activeTab;

    private readonly IPowerShellConsoleService _consoleService;
    private readonly ITenantModuleConnectionService _tenantModuleConnectionService;
    private readonly IConsoleHistoryService _consoleHistoryService;
    private readonly IChangeRequestReplayService _changeRequestReplayService;
    private readonly IChangeControlService _changeControlService;
    private readonly ILaunchControlActionsService _launchControlActionsService;

    private readonly ShellRegistry _shellRegistry = new();
    private FixedRibbonRenderer? _ribbonRenderer;
    private readonly DispatcherTimer _clockTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    // Document views live in the center area; only one is visible at a time (WebView tabs are
    // themselves a "document" too, handled via WebViewsContainer/EmptyTabsOverlay below).
    private FrameworkElement[] DocumentOverlays => new FrameworkElement[]
    {
        SowAssessmentDashboardView, TelemetryDashboardView, ConsolePanel, ScreenshotEvidenceDocument,
    };

    public MainWindow()
    {
        InitializeComponent();

        _tenantService = new TenantService();
        _profileService = new WebViewProfileService();

        _consoleService = new PowerShellConsoleService();
        _consoleHistoryService = new ConsoleHistoryService();
        _changeRequestReplayService = new ChangeRequestReplayService();
        _tenantModuleConnectionService = new TenantModuleConnectionService(_tenantService, _consoleService);
        _changeControlService = new ChangeControlService();
        _launchControlActionsService = new LaunchControlActionsService();
        _consoleService.CommandExecuted += (s, record) => _consoleHistoryService.Add(record);

        ShellTenantSwitcher.Initialize(_tenantService);
        _trayIconManager = new TrayIconManager(this, _tenantService);

        TabsItemsControl.ItemsSource = _tabs;

        _tenantService.CurrentTenantChanged += OnCurrentTenantChanged;

        EvidenceGalleryPanel.CloseRequested += (s, e) => HideDocument(ScreenshotEvidenceDocument);
        EvidenceGalleryPanel.CaptureRequested += (s, e) => TriggerScreenCapture();
        DesktopScreenClipService.CaptureCompleted += (s, item) => Dispatcher.Invoke(() => ShowDocument(ScreenshotEvidenceDocument));

        SowAssessmentDashboardView.Initialize(_tenantService);
        TelemetryDashboardView.Initialize(_tenantService);
        ConsolePanel.Initialize(_consoleService, _tenantModuleConnectionService, _tenantService);

        LeftReferencePanelControl.BookmarkSelected += async portalType =>
        {
            if (_tenantService.CurrentTenant != null)
            {
                await OpenPortalTabAsync(_tenantService.CurrentTenant, portalType);
            }
        };

        InitializeShell();
        InitializeStatusBar();

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    // ---- Status bar (UI_RULES.md §1: current time, app version from the assembly) ----------

    private void InitializeStatusBar()
    {
        // App version — from the assembly, never hardcoded (UI_RULES.md §1). Falls back to the
        // informational version string if the file version isn't set.
        var asm = Assembly.GetExecutingAssembly();
        var version = asm.GetName().Version;
        StatusVersionTextBlock.Text = version != null ? $"MyArchitect v{version.Major}.{version.Minor}.{version.Build}" : "MyArchitect";

        _clockTimer.Tick += (_, _) => StatusClockTextBlock.Text = DateTime.Now.ToString("h:mm tt");
        StatusClockTextBlock.Text = DateTime.Now.ToString("h:mm tt");
        _clockTimer.Start();
    }

    // ---- Shell wiring (#3493) --------------------------------------------------------------

    private void InitializeShell()
    {
        _ribbonRenderer = new FixedRibbonRenderer(AppRibbon, _shellRegistry);
        PaletteOverlay.Initialize(_shellRegistry);

        _shellRegistry.RecordOpened += spec =>
        {
            RecordWorkspaceControl.Render(spec);
            RightPanelColumn.Width = new GridLength(spec == null ? 0 : 320);
        };

        RegisterHomeTab();
        RegisterConsoleTab();
        // Watch / Documents / Admin are intentionally left unregistered here — their real
        // content is #3483/#3487/#3490 (Watch), #3486 (Documents) and #3461/#3489/#3480/#3485
        // (Admin), all separate Features blocked on this shell landing. FixedRibbonRenderer
        // renders a stated empty state for each until those land (SHELL.md §6) — never a
        // fabricated placeholder group.

        _shellRegistry.RegisterPaletteProvider(BuildPaletteCommands);
    }

    private void RegisterHomeTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Tenant",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open All Portals",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Open every bookmarked Microsoft portal for the active tenant",
                    OnSelect = () => _ = OpenAllPortalsAsync(),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Views",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "SOW & Assessment",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowAssessmentView(),
                },
                new RibbonCommandSpec
                {
                    Label = "Live Telemetry",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowTelemetryView(),
                },
                new RibbonCommandSpec
                {
                    Label = "Screenshot Evidence",
                    Intent = RibbonIntent.Open,
                    OnSelect = () => ShowDocument(ScreenshotEvidenceDocument),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Home, new RibbonGroupSpec
        {
            Label = "Change Requests",
            Order = 30,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Real GET /api/msp/change-requests, filtered to the active tenant",
                    Gallery = new GallerySpec
                    {
                        Title = "Change Requests",
                        Searchable = true,
                        GetRows = BuildChangeRequestRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    private void RegisterConsoleTab()
    {
        _shellRegistry.RegisterFixedTabGroup(FixedTab.Console, new RibbonGroupSpec
        {
            Label = "Console",
            Order = 10,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Open Console",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Hosted PowerShell runspace (#3459) — real stdout/stderr, no shelled-out process",
                    OnSelect = () => ShowDocument(ConsolePanel),
                },
            },
        });

        _shellRegistry.RegisterFixedTabGroup(FixedTab.Console, new RibbonGroupSpec
        {
            Label = "Script Library",
            Order = 20,
            Large =
            {
                new RibbonCommandSpec
                {
                    Label = "Browse",
                    Intent = RibbonIntent.Open,
                    ToolTip = "Entitlement-resolved write_action_catalog (#3460)",
                    Gallery = new GallerySpec
                    {
                        Title = "Script Library",
                        Searchable = true,
                        GetRows = BuildScriptLibraryRows,
                    },
                    OnSelect = () => { },
                },
            },
        });
    }

    /// <summary>Real rows from GET /api/msp/change-requests, filtered client-side to the active
    /// tenant. Selecting a row opens the contextual tab + right-panel workspace with a real,
    /// confirm-armed action calling <see cref="IChangeControlService.RecordHumanActionAsync"/> —
    /// the end-to-end proof of the shell's gallery → contextual tab → workspace contract.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildChangeRequestRows()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return Array.Empty<GalleryRowSpec>();

        System.Collections.Generic.IReadOnlyList<ChangeRequest> requests;
        try
        {
            requests = _changeControlService.GetChangeRequestsAsync(tenant.TenantGuid).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Real, honest failure — most likely #3501 (no auth/session mechanism yet), not a
            // bug in this client. Surfaced as a single disabled row rather than a fake row.
            return new[]
            {
                new GalleryRowSpec { Id = "error", Name = $"Could not load: {ex.Message}", OnSelect = () => { } },
            };
        }

        return requests.Select(cr => new GalleryRowSpec
        {
            Id = cr.Id,
            Tile = cr.RiskLevel.Length >= 2 ? cr.RiskLevel[..2].ToUpperInvariant() : cr.RiskLevel.ToUpperInvariant(),
            Name = cr.Title,
            Sub = $"{cr.Status} · {cr.Category}",
            OnSelect = () => OpenChangeRequestRecord(cr),
        }).ToList();
    }

    private void OpenChangeRequestRecord(ChangeRequest cr)
    {
        var spec = new RecordWorkspaceSpec
        {
            Kind = "change-request",
            Id = cr.Id,
            Eyebrow = "Change Request",
            Title = cr.Title,
            Sub = $"{cr.TenantName} · {cr.PrimaryDomain}",
            Facts =
            {
                new WorkspaceFact { Label = "Status", Value = cr.Status },
                new WorkspaceFact { Label = "Risk", Value = cr.RiskLevel },
                new WorkspaceFact { Label = "Class", Value = cr.ChangeClass },
                new WorkspaceFact { Label = "Impacted users", Value = cr.ImpactedUsersCount.ToString() },
            },
            Body = ("Description", string.IsNullOrEmpty(cr.Description) ? "(none)" : cr.Description),
            Actions =
            {
                new WorkspaceAction
                {
                    Label = "Record human action",
                    Confirm = true,
                    OnSelect = () =>
                    {
                        var numericId = cr.NumericId;
                        if (numericId == null) return;
                        _ = _changeControlService.RecordHumanActionAsync(numericId.Value);
                    },
                },
            },
        };

        _shellRegistry.OpenContextual(
            new TrailEntry("change-request", cr.Id, cr.Title, () => OpenChangeRequestRecord(cr)),
            new ContextualTabSpec
            {
                Id = "change-request",
                Label = "Change Request",
                Groups =
                {
                    new RibbonGroupSpec
                    {
                        Label = "Actions",
                        Large = { new RibbonCommandSpec
                        {
                            Label = "Record human action",
                            Intent = RibbonIntent.Record,
                            OnSelect = () => { },
                        } },
                    },
                },
            },
            onSearchEverything: () => PaletteOverlay.Open());

        _shellRegistry.OpenRecord(spec);
    }

    /// <summary>Real catalog rows when a real MSP+customer id pair is resolvable. Today it never
    /// is — MyArchitect has no auth/session mechanism to source one from (#3501, also noted on
    /// <see cref="ILaunchControlActionsService"/> itself) — so this states that honestly instead
    /// of guessing an id, which would be inventing data.</summary>
    private System.Collections.Generic.IReadOnlyList<GalleryRowSpec> BuildScriptLibraryRows()
    {
        return new[]
        {
            new GalleryRowSpec
            {
                Id = "blocked",
                Name = "Script Library needs MSP/customer identity — not yet resolvable (#3501)",
                OnSelect = () => { },
            },
        };
    }

    private System.Collections.Generic.IReadOnlyList<PaletteCommand> BuildPaletteCommands()
    {
        var commands = new System.Collections.Generic.List<PaletteCommand>
        {
            new() { Id = "dest:home", Type = PaletteType.Destination, Name = "Home", Run = () => AppRibbon.SelectedTabIndex = 0 },
            new() { Id = "dest:console", Type = PaletteType.Destination, Name = "Console", Run = () => ShowDocument(ConsolePanel) },
            new() { Id = "dest:sow", Type = PaletteType.Destination, Name = "SOW & Assessment", Sub = "Gate, SOW, Drift & Snapshot", Run = () => ShowAssessmentView() },
            new() { Id = "dest:telemetry", Type = PaletteType.Destination, Name = "Live Telemetry Console", Sub = "Engines, Drift, SOW & Feed", Run = () => ShowTelemetryView() },
            new() { Id = "act:open-all", Type = PaletteType.Action, Name = "Open all portals", Run = () => _ = OpenAllPortalsAsync() },
            new() { Id = "ans:open-tabs", Type = PaletteType.Answer, Name = "Open portal tabs", Live = _tabs.Count.ToString(), Run = () => { } },
        };

        foreach (var tenant in _tenantService.Tenants)
        {
            commands.Add(new PaletteCommand
            {
                Id = $"rec:tenant:{tenant.Id}",
                Type = PaletteType.Record,
                Name = tenant.Name,
                Sub = tenant.TenantGuid,
                Run = () => _tenantService.SelectTenant(tenant.Id),
            });
        }

        return commands;
    }

    private async Task OpenAllPortalsAsync()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return;

        foreach (PortalType portalType in Enum.GetValues<PortalType>())
        {
            if (portalType == PortalType.ClaudeChat) continue;
            if (_tabs.Any(t => t.Tenant == tenant && t.PortalType == portalType)) continue;
            await OpenPortalTabAsync(tenant, portalType);
        }
    }

    private void PaletteTriggerButton_Click(object sender, RoutedEventArgs e) => PaletteOverlay.Open();

    private void UndoButton_Click(object sender, RoutedEventArgs e)
    {
        // UI_RULES.md §7 — thin trigger over real backend rollback only, no client-side undo
        // stack. IChangeControlService has no rollback client method today (only
        // human-action/attest); the button stays disabled until that real endpoint is wired,
        // rather than faking an undo. See build-journal/3493.md for the filed follow-up.
    }

    // ---- Document toggling (SOW / Telemetry / Console / Screenshot Evidence) ---------------

    private void ShowDocument(FrameworkElement document)
    {
        WebViewsContainer.Visibility = Visibility.Collapsed;
        EmptyTabsOverlay.Visibility = Visibility.Collapsed;
        foreach (var d in DocumentOverlays) d.Visibility = d == document ? Visibility.Visible : Visibility.Collapsed;

        if (document == SowAssessmentDashboardView && _tenantService.CurrentTenant != null)
        {
            _ = SowAssessmentDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
        else if (document == TelemetryDashboardView && _tenantService.CurrentTenant != null)
        {
            _ = TelemetryDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    private void HideDocument(FrameworkElement document)
    {
        document.Visibility = Visibility.Collapsed;
        if (DocumentOverlays.All(d => d.Visibility != Visibility.Visible))
        {
            UpdateTabsState();
        }
    }

    public void ShowAssessmentView() => ShowDocument(SowAssessmentDashboardView);
    public void ShowTelemetryView() => ShowDocument(TelemetryDashboardView);

    // ---- Portal tab management (unchanged from pre-shell version) --------------------------

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
        {
            LeftReferencePanelControl.SetTenantName(_tenantService.CurrentTenant.Name);
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        _clockTimer.Stop();
        _trayIconManager.Dispose();
        foreach (var tab in _tabs)
        {
            tab.WebView.Dispose();
        }
        _tenantModuleConnectionService.Dispose();
        _consoleService.Dispose();
    }

    public async Task<PortalTabItem> OpenPortalTabAsync(Tenant tenant, PortalType portalType, string? customUrl = null)
    {
        var (title, icon) = GetPortalMetadata(portalType);
        var url = customUrl ?? tenant.PortalUrls.GetUrl(portalType);

        var webView = new WebView2
        {
            HorizontalAlignment = System.Windows.HorizontalAlignment.Stretch,
            VerticalAlignment = System.Windows.VerticalAlignment.Stretch,
            Visibility = Visibility.Collapsed
        };

        WebViewsContainer.Children.Add(webView);

        var tab = new PortalTabItem
        {
            Tenant = tenant,
            PortalType = portalType,
            Title = title,
            IconSymbol = icon,
            Url = url,
            WebView = webView,
            IsLoading = true
        };

        webView.NavigationStarting += (s, e) =>
        {
            tab.IsLoading = true;
            if (tab == _activeTab)
            {
                UrlTextBox.Text = e.Uri;
            }
        };

        webView.NavigationCompleted += (s, e) =>
        {
            tab.IsLoading = false;
            if (webView.Source != null)
            {
                tab.Url = webView.Source.ToString();
                if (tab == _activeTab)
                {
                    UrlTextBox.Text = tab.Url;
                    UpdateNavigationButtonsState();
                }
            }
        };

        webView.SourceChanged += (s, e) =>
        {
            if (webView.Source != null)
            {
                tab.Url = webView.Source.ToString();
                if (tab == _activeTab)
                {
                    UrlTextBox.Text = tab.Url;
                    UpdateNavigationButtonsState();
                }
            }
        };

        _tabs.Add(tab);
        ActivateTab(tab);

        try
        {
            var env = await _profileService.GetEnvironmentForTenantAsync(tenant);
            await webView.EnsureCoreWebView2Async(env);

            if (!string.IsNullOrWhiteSpace(url))
            {
                webView.CoreWebView2.Navigate(url);
            }
        }
        catch (Exception ex)
        {
            tab.IsLoading = false;
            tab.Title = $"{title} (Offline)";
            if (tab == _activeTab)
            {
                UrlTextBox.Text = $"Notice: {ex.Message}";
            }
        }

        return tab;
    }

    public void ActivateTab(PortalTabItem tab)
    {
        foreach (var d in DocumentOverlays) d.Visibility = Visibility.Collapsed;

        if (_activeTab != null)
        {
            _activeTab.IsActive = false;
            _activeTab.WebView.Visibility = Visibility.Collapsed;
        }

        _activeTab = tab;
        tab.IsActive = true;
        tab.WebView.Visibility = Visibility.Visible;
        WebViewsContainer.Visibility = Visibility.Visible;

        UrlTextBox.Text = tab.Url;
        IsolatedProfileBadgeTextBlock.Text = tab.DisplayBadge;
        StatusProfileTextBlock.Text = tab.IsGlobal ? "Session: Global Claude Profile [claude.ai]" : $"Session Isolation: {tab.Tenant?.Name} [{tab.Tenant?.TenantGuid}]";

        UpdateTabsState();
        UpdateNavigationButtonsState();
    }

    public void CloseTab(PortalTabItem tab)
    {
        var wasActive = tab == _activeTab;
        WebViewsContainer.Children.Remove(tab.WebView);
        tab.WebView.Dispose();
        _tabs.Remove(tab);

        if (wasActive)
        {
            var nextTab = _tabs.LastOrDefault();
            if (nextTab != null)
            {
                ActivateTab(nextTab);
            }
            else
            {
                _activeTab = null;
                UrlTextBox.Text = string.Empty;
                IsolatedProfileBadgeTextBlock.Text = "No Active Tab";
                StatusProfileTextBlock.Text = "Session Isolation: Standby";
            }
        }

        UpdateTabsState();
    }

    private void UpdateTabsState()
    {
        var anyDocumentVisible = DocumentOverlays.Any(d => d.Visibility == Visibility.Visible);
        EmptyTabsOverlay.Visibility = (_tabs.Count == 0 && !anyDocumentVisible) ? Visibility.Visible : Visibility.Collapsed;
        StatusTabCountTextBlock.Text = $"{_tabs.Count} Open Tab{(_tabs.Count == 1 ? "" : "s")}";
    }

    private void UpdateNavigationButtonsState()
    {
        if (_activeTab?.WebView?.CoreWebView2 != null)
        {
            BackButton.IsEnabled = _activeTab.WebView.CanGoBack;
            ForwardButton.IsEnabled = _activeTab.WebView.CanGoForward;
        }
        else
        {
            BackButton.IsEnabled = false;
            ForwardButton.IsEnabled = false;
        }
    }

    private async void OnCurrentTenantChanged(object? sender, Tenant? tenant)
    {
        if (tenant == null) return;

        LeftReferencePanelControl.SetTenantName(tenant.Name);
        _trayIconManager.UpdateTenant(tenant);

        var existingTab = _tabs.FirstOrDefault(t => t.Tenant != null && t.Tenant.Id.Equals(tenant.Id, StringComparison.OrdinalIgnoreCase));
        if (existingTab != null)
        {
            ActivateTab(existingTab);
        }
        else
        {
            await OpenPortalTabAsync(tenant, PortalType.M365Admin);
        }
    }

    private static (string Title, SymbolRegular Icon) GetPortalMetadata(PortalType portalType) => portalType switch
    {
        PortalType.M365Admin => ("M365 Admin", SymbolRegular.Globe24),
        PortalType.AzurePortal => ("Azure Portal", SymbolRegular.Cloud24),
        PortalType.EntraAdmin => ("Entra ID", SymbolRegular.Shield24),
        PortalType.IntuneAdmin => ("Intune", SymbolRegular.Globe24),
        PortalType.ExchangeAdmin => ("Exchange", SymbolRegular.Mail24),
        PortalType.SecurityAdmin => ("Defender", SymbolRegular.Shield24),
        PortalType.ComplianceAdmin => ("Purview", SymbolRegular.Shield24),
        PortalType.TeamsAdmin => ("Teams Admin", SymbolRegular.Globe24),
        _ => ("Portal", SymbolRegular.Globe24)
    };

    private void TabItem_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is PortalTabItem tab)
        {
            ActivateTab(tab);
        }
    }

    private void CloseTabButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is PortalTabItem tab)
        {
            CloseTab(tab);
        }
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if ((Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control && e.Key == Key.K)
        {
            PaletteOverlay.Open();
            e.Handled = true;
        }
        else if (e.Key == Key.PrintScreen ||
                 ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.S))
        {
            TriggerScreenCapture();
            e.Handled = true;
        }
        else if ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.A)
        {
            ShowAssessmentView();
            e.Handled = true;
        }
        else if ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.T)
        {
            ShowTelemetryView();
            e.Handled = true;
        }
    }

    public void TriggerScreenCapture()
    {
        DesktopScreenClipService.Capture(_tenantService.CurrentTenant, _activeTab?.Url, _activeTab?.Title);
    }

    private void ScreenClipButton_Click(object sender, RoutedEventArgs e)
    {
        TriggerScreenCapture();
    }

    private void NewTabButton_Click(object sender, RoutedEventArgs e)
    {
        // Bookmarks live permanently in the left panel now (UI_RULES.md §8) — nothing to pop
        // open here anymore; this button is a no-op placeholder kept for the tab-strip's own
        // "+" affordance until a blank-document picker exists.
    }

    private void BackButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null && _activeTab.WebView.CanGoBack)
        {
            _activeTab.WebView.GoBack();
        }
    }

    private void ForwardButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null && _activeTab.WebView.CanGoForward)
        {
            _activeTab.WebView.GoForward();
        }
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTab?.WebView?.CoreWebView2 != null)
        {
            try
            {
                _activeTab.WebView.Reload();
            }
            catch
            {
                if (!string.IsNullOrEmpty(_activeTab.Url))
                {
                    _activeTab.WebView.CoreWebView2.Navigate(_activeTab.Url);
                }
            }
        }
    }

    private void UpdateAvailableButton_Click(object sender, RoutedEventArgs e)
    {
        // Version-update mechanism (UI_RULES.md §6 — port of BuildConsole's VersionInfo.cs +
        // MainWindow.VersionUpdate.cs) is not built this session; button stays hidden
        // (Visibility="Collapsed" in XAML) until it lands. See build-journal/3493.md.
    }

    private void LaunchExternalButton_Click(object sender, RoutedEventArgs e)
    {
        var targetUrl = _activeTab?.Url;
        if (!string.IsNullOrWhiteSpace(targetUrl))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetUrl,
                    UseShellExecute = true
                });
            }
            catch
            {
                // Ignore failure to launch external process
            }
        }
    }
}
