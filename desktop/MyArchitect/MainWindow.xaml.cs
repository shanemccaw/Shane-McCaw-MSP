using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Wpf;
using Wpf.Ui.Controls;
using MyArchitect.Models;
using MyArchitect.Services;

namespace MyArchitect;

/// <summary>
/// Main window operator shell hosting tenant switcher, activity bar, bookmarks side panel, isolated WebView2 profile tabs, and tray management.
/// </summary>
public partial class MainWindow : FluentWindow
{
    private readonly ITenantService _tenantService;
    private readonly IWebViewProfileService _profileService;
    private readonly TrayIconManager _trayIconManager;
    private readonly ObservableCollection<PortalTabItem> _tabs = new();
    private PortalTabItem? _activeTab;

    // #3459 — hosted PowerShell console service layer. No Console UI panel is wired up here yet:
    // GEMINI.md's standing rule requires the UI Shell (#3493) to land first ("do not build
    // ad-hoc chrome ... stop and flag it instead"), and #3493 isn't built. These services are
    // real and functional on their own — the runspace hosts, auto-connects modules on tenant
    // switch, and records history — ready for a Console panel to consume once #3493 lands.
    private readonly IPowerShellConsoleService _consoleService;
    private readonly ITenantModuleConnectionService _tenantModuleConnectionService;
    private readonly IConsoleHistoryService _consoleHistoryService;
    private readonly IChangeRequestReplayService _changeRequestReplayService;

    public MainWindow()
    {
        InitializeComponent();

        _tenantService = new TenantService();
        _profileService = new WebViewProfileService();

        _consoleService = new PowerShellConsoleService();
        _consoleHistoryService = new ConsoleHistoryService();
        _changeRequestReplayService = new ChangeRequestReplayService();
        _tenantModuleConnectionService = new TenantModuleConnectionService(_tenantService, _consoleService);
        _consoleService.CommandExecuted += (s, record) => _consoleHistoryService.Add(record);

        ShellTenantSwitcher.Initialize(_tenantService);
        _trayIconManager = new TrayIconManager(this, _tenantService);

        TabsItemsControl.ItemsSource = _tabs;

        _tenantService.CurrentTenantChanged += OnCurrentTenantChanged;

        EvidenceGalleryPanel.CloseRequested += (s, e) => CloseEvidencePanel();
        EvidenceGalleryPanel.CaptureRequested += (s, e) => TriggerScreenCapture();
        DesktopScreenClipService.CaptureCompleted += (s, item) => Dispatcher.Invoke(() => ShowEvidencePanel());

        SowAssessmentDashboardView.Initialize(_tenantService);
        TelemetryDashboardView.Initialize(_tenantService);

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
        {
            BookmarksTenantSubtext.Text = $"Active: {_tenantService.CurrentTenant.Name}";
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
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
        HideAssessmentView();
        HideTelemetryView();

        if (_activeTab != null)
        {
            _activeTab.IsActive = false;
            _activeTab.WebView.Visibility = Visibility.Collapsed;
        }

        _activeTab = tab;
        tab.IsActive = true;
        tab.WebView.Visibility = Visibility.Visible;

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
        EmptyTabsOverlay.Visibility = _tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
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

        BookmarksTenantSubtext.Text = $"Active: {tenant.Name}";
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

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if ((Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control && e.Key == Key.B)
        {
            ToggleBookmarksPanel();
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
            ToggleAssessmentView();
            e.Handled = true;
        }
        else if ((Keyboard.Modifiers & (ModifierKeys.Control | ModifierKeys.Shift)) == (ModifierKeys.Control | ModifierKeys.Shift) && e.Key == Key.T)
        {
            ToggleTelemetryView();
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

    private void ToggleBookmarksPanel()
    {
        if (BookmarksSidePanel.Visibility == Visibility.Visible)
        {
            BookmarksSidePanel.Visibility = Visibility.Collapsed;
            ActivityBookmarksRadio.IsChecked = false;
        }
        else
        {
            CloseEvidencePanel();
            BookmarksSidePanel.Visibility = Visibility.Visible;
            ActivityBookmarksRadio.IsChecked = true;
            PortalSearchTextBox.Focus();
        }
    }

    private void ToggleEvidencePanel()
    {
        if (ScreenshotEvidenceSidePanel.Visibility == Visibility.Visible)
        {
            CloseEvidencePanel();
        }
        else
        {
            ShowEvidencePanel();
        }
    }

    private void ShowEvidencePanel()
    {
        BookmarksSidePanel.Visibility = Visibility.Collapsed;
        ActivityBookmarksRadio.IsChecked = false;
        ScreenshotEvidenceSidePanel.Visibility = Visibility.Visible;
        ActivityScreenshotsRadio.IsChecked = true;
    }

    private void CloseEvidencePanel()
    {
        ScreenshotEvidenceSidePanel.Visibility = Visibility.Collapsed;
        ActivityScreenshotsRadio.IsChecked = false;
    }

    private void ActivityScreenshotsRadio_Click(object sender, RoutedEventArgs e)
    {
        if (ScreenshotEvidenceSidePanel.Visibility == Visibility.Visible && ActivityScreenshotsRadio.IsChecked == false)
        {
            CloseEvidencePanel();
        }
        else
        {
            ShowEvidencePanel();
        }
    }

    public void ToggleAssessmentView()
    {
        if (SowAssessmentDashboardView.Visibility == Visibility.Visible)
        {
            HideAssessmentView();
        }
        else
        {
            ShowAssessmentView();
        }
    }

    public void ShowAssessmentView()
    {
        HideTelemetryView();
        CloseEvidencePanel();
        WebViewsContainer.Visibility = Visibility.Collapsed;
        EmptyTabsOverlay.Visibility = Visibility.Collapsed;
        SowAssessmentDashboardView.Visibility = Visibility.Visible;
        ActivityExplorerRadio.IsChecked = true;

        IsolatedProfileBadgeTextBlock.Text = "Mode: SOW Assessment Dashboard";
        StatusProfileTextBlock.Text = $"Active Tenant Assessment: {_tenantService.CurrentTenant?.Name}";

        if (_tenantService.CurrentTenant != null)
        {
            _ = SowAssessmentDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    public void HideAssessmentView()
    {
        SowAssessmentDashboardView.Visibility = Visibility.Collapsed;
        WebViewsContainer.Visibility = Visibility.Visible;
        ActivityExplorerRadio.IsChecked = false;
        UpdateTabsState();
    }

    private void ActivityExplorerRadio_Click(object sender, RoutedEventArgs e)
    {
        ToggleAssessmentView();
    }

    private void BookmarkAssessment_Click(object sender, RoutedEventArgs e)
    {
        ShowAssessmentView();
    }

    public void ToggleTelemetryView()
    {
        if (TelemetryDashboardView.Visibility == Visibility.Visible)
        {
            HideTelemetryView();
        }
        else
        {
            ShowTelemetryView();
        }
    }

    public void ShowTelemetryView()
    {
        HideAssessmentView();
        CloseEvidencePanel();
        BookmarksSidePanel.Visibility = Visibility.Collapsed;
        ActivityBookmarksRadio.IsChecked = false;

        WebViewsContainer.Visibility = Visibility.Collapsed;
        EmptyTabsOverlay.Visibility = Visibility.Collapsed;
        TelemetryDashboardView.Visibility = Visibility.Visible;
        ActivityTelemetryRadio.IsChecked = true;

        IsolatedProfileBadgeTextBlock.Text = "Mode: Live Telemetry Console";
        StatusProfileTextBlock.Text = $"Active Tenant Telemetry: {_tenantService.CurrentTenant?.Name}";

        if (_tenantService.CurrentTenant != null)
        {
            _ = TelemetryDashboardView.LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    public void HideTelemetryView()
    {
        TelemetryDashboardView.Visibility = Visibility.Collapsed;
        WebViewsContainer.Visibility = Visibility.Visible;
        ActivityTelemetryRadio.IsChecked = false;
        UpdateTabsState();
    }

    private void ActivityTelemetryRadio_Click(object sender, RoutedEventArgs e)
    {
        ToggleTelemetryView();
    }

    private void BookmarkTelemetry_Click(object sender, RoutedEventArgs e)
    {
        ShowTelemetryView();
    }

    private void ActivityBookmarksRadio_Click(object sender, RoutedEventArgs e)
    {
        if (BookmarksSidePanel.Visibility == Visibility.Visible && ActivityBookmarksRadio.IsChecked == false)
        {
            BookmarksSidePanel.Visibility = Visibility.Collapsed;
        }
        else
        {
            BookmarksSidePanel.Visibility = Visibility.Visible;
            ActivityBookmarksRadio.IsChecked = true;
            PortalSearchTextBox.Focus();
        }
    }

    private void CollapseBookmarksButton_Click(object sender, RoutedEventArgs e)
    {
        BookmarksSidePanel.Visibility = Visibility.Collapsed;
        ActivityBookmarksRadio.IsChecked = false;
    }

    private void NewTabButton_Click(object sender, RoutedEventArgs e)
    {
        BookmarksSidePanel.Visibility = Visibility.Visible;
        ActivityBookmarksRadio.IsChecked = true;
        PortalSearchTextBox.Focus();
        PortalSearchTextBox.SelectAll();
    }

    private void PortalSearchTextBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        var filter = PortalSearchTextBox.Text?.Trim() ?? string.Empty;
        foreach (var child in BookmarksItemsStackPanel.Children)
        {
            if (child is System.Windows.Controls.Button btn)
            {
                if (string.IsNullOrWhiteSpace(filter))
                {
                    btn.Visibility = Visibility.Visible;
                }
                else
                {
                    var tag = btn.Tag?.ToString() ?? string.Empty;
                    btn.Visibility = tag.Contains(filter, StringComparison.OrdinalIgnoreCase)
                        ? Visibility.Visible
                        : Visibility.Collapsed;
                }
            }
        }
    }

    private async void BookmarkM365_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
    }

    private async void BookmarkEntra_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.EntraAdmin);
    }

    private async void BookmarkAzure_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.AzurePortal);
    }

    private async void BookmarkIntune_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.IntuneAdmin);
    }

    private async void BookmarkExchange_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.ExchangeAdmin);
    }

    private async void BookmarkSecurity_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.SecurityAdmin);
    }

    private async void BookmarkCompliance_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.ComplianceAdmin);
    }

    private async void BookmarkTeams_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.TeamsAdmin);
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
