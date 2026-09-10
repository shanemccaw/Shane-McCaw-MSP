using System;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using Wpf.Ui.Controls;
using MyArchitect.Models;
using MyArchitect.Services;

namespace MyArchitect;

/// <summary>
/// Main window operator shell hosting tenant switcher, activity bar, and WebView2 portal shell.
/// </summary>
public partial class MainWindow : FluentWindow
{
    private readonly ITenantService _tenantService;
    private readonly TrayIconManager _trayIconManager;
    private bool _isWebViewInitialized;
    private string _currentPortalUrl = string.Empty;

    public MainWindow()
    {
        InitializeComponent();

        _tenantService = new TenantService();
        ShellTenantSwitcher.Initialize(_tenantService);

        _trayIconManager = new TrayIconManager(this, _tenantService);

        _tenantService.CurrentTenantChanged += OnCurrentTenantChanged;

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;

        UpdateTenantScopeDisplay(_tenantService.CurrentTenant);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await InitializeWebViewAsync();
        NavigateCurrentPortal();
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        _trayIconManager.Dispose();
    }

    private async System.Threading.Tasks.Task InitializeWebViewAsync()
    {
        try
        {
            WebViewStatusOverlay.Visibility = Visibility.Visible;
            OverlayTitleTextBlock.Text = "Initializing WebView2 Operator Shell...";
            OverlaySubtitleTextBlock.Text = "Loading Chromium runtime environment.";

            await MainWebView.EnsureCoreWebView2Async();
            _isWebViewInitialized = true;

            WebViewStatusOverlay.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            WebViewStatusOverlay.Visibility = Visibility.Visible;
            OverlayTitleTextBlock.Text = "WebView2 Runtime Notice";
            OverlaySubtitleTextBlock.Text = $"WebView2 host container ready. ({ex.Message})";
        }
    }

    private void OnCurrentTenantChanged(object? sender, Tenant? tenant)
    {
        UpdateTenantScopeDisplay(tenant);
        NavigateCurrentPortal();
    }

    private void UpdateTenantScopeDisplay(Tenant? tenant)
    {
        var tenantName = tenant?.Name ?? "No Tenant Selected";
        var tenantGuid = tenant?.TenantGuid ?? string.Empty;

        ActiveTenantBadgeTextBlock.Text = $"Tenant: {tenantName}";
        StatusTenantTextBlock.Text = string.IsNullOrEmpty(tenantGuid)
            ? $"Tenant: {tenantName}"
            : $"Tenant: {tenantName} [{tenantGuid}]";

        _trayIconManager.UpdateTenant(tenant);
    }

    private void NavigateCurrentPortal()
    {
        var tenant = _tenantService.CurrentTenant;
        if (tenant == null) return;

        if (M365Tab.IsChecked == true)
        {
            _currentPortalUrl = tenant.PortalUrls.M365AdminUrl;
        }
        else if (AzureTab.IsChecked == true)
        {
            _currentPortalUrl = tenant.PortalUrls.AzurePortalUrl;
        }
        else if (EntraTab.IsChecked == true)
        {
            _currentPortalUrl = tenant.PortalUrls.EntraAdminUrl;
        }
        else if (IntuneTab.IsChecked == true)
        {
            _currentPortalUrl = tenant.PortalUrls.IntuneAdminUrl;
        }
        else if (ExchangeTab.IsChecked == true)
        {
            _currentPortalUrl = tenant.PortalUrls.ExchangeAdminUrl;
        }

        UrlTextBox.Text = _currentPortalUrl;

        if (_isWebViewInitialized && !string.IsNullOrWhiteSpace(_currentPortalUrl))
        {
            try
            {
                MainWebView.CoreWebView2.Navigate(_currentPortalUrl);
            }
            catch
            {
                // Graceful handling if network or runtime is unavailable
            }
        }
    }

    private void PortalTab_Click(object sender, RoutedEventArgs e)
    {
        NavigateCurrentPortal();
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isWebViewInitialized)
        {
            try
            {
                MainWebView.CoreWebView2.Reload();
            }
            catch
            {
                NavigateCurrentPortal();
            }
        }
        else
        {
            NavigateCurrentPortal();
        }
    }

    private void LaunchExternalButton_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_currentPortalUrl))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = _currentPortalUrl,
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
