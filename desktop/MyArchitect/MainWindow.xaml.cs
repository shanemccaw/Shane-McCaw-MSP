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
/// Main window operator shell hosting tenant switcher, activity bar, isolated WebView2 profile tabs, and tray management.
/// </summary>
public partial class MainWindow : FluentWindow
{
    private readonly ITenantService _tenantService;
    private readonly IWebViewProfileService _profileService;
    private readonly TrayIconManager _trayIconManager;
    private readonly ObservableCollection<PortalTabItem> _tabs = new();
    private PortalTabItem? _activeTab;

    public MainWindow()
    {
        InitializeComponent();

        _tenantService = new TenantService();
        _profileService = new WebViewProfileService();

        ShellTenantSwitcher.Initialize(_tenantService);
        _trayIconManager = new TrayIconManager(this, _tenantService);

        TabsItemsControl.ItemsSource = _tabs;

        _tenantService.CurrentTenantChanged += OnCurrentTenantChanged;

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_tenantService.CurrentTenant != null)
        {
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
        if (_activeTab != null)
        {
            _activeTab.IsActive = false;
            _activeTab.WebView.Visibility = Visibility.Collapsed;
        }

        _activeTab = tab;
        tab.IsActive = true;
        tab.WebView.Visibility = Visibility.Visible;

        UrlTextBox.Text = tab.Url;
        IsolatedProfileBadgeTextBlock.Text = $"Isolated: {tab.Tenant.Name}";
        StatusProfileTextBlock.Text = $"Session Isolation: {tab.Tenant.Name} [{tab.Tenant.TenantGuid}]";

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

        _trayIconManager.UpdateTenant(tenant);

        var existingTab = _tabs.FirstOrDefault(t => t.Tenant.Id.Equals(tenant.Id, StringComparison.OrdinalIgnoreCase));
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

    private void NewTabButton_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = !NewTabPopup.IsOpen;
    }

    private async void OpenM365Tab_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = false;
        if (_tenantService.CurrentTenant != null)
        {
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.M365Admin);
        }
    }

    private async void OpenAzureTab_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = false;
        if (_tenantService.CurrentTenant != null)
        {
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.AzurePortal);
        }
    }

    private async void OpenEntraTab_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = false;
        if (_tenantService.CurrentTenant != null)
        {
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.EntraAdmin);
        }
    }

    private async void OpenIntuneTab_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = false;
        if (_tenantService.CurrentTenant != null)
        {
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.IntuneAdmin);
        }
    }

    private async void OpenExchangeTab_Click(object sender, RoutedEventArgs e)
    {
        NewTabPopup.IsOpen = false;
        if (_tenantService.CurrentTenant != null)
        {
            await OpenPortalTabAsync(_tenantService.CurrentTenant, PortalType.ExchangeAdmin);
        }
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
