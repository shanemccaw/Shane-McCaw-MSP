using System;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using MyArchitect.Models;
using MyArchitect.Services;
using UserControl = System.Windows.Controls.UserControl;

namespace MyArchitect.Controls;

public partial class TelemetryConsoleView : UserControl
{
    private ITenantService? _tenantService;
    private ITelemetryService _telemetryService;
    private TenantTelemetryDashboard? _currentDashboard;

    public TelemetryConsoleView()
    {
        InitializeComponent();
        _telemetryService = new TelemetryService();
    }

    public void Initialize(ITenantService tenantService, ITelemetryService? telemetryService = null)
    {
        _tenantService = tenantService;
        if (telemetryService != null)
        {
            _telemetryService = telemetryService;
        }

        _tenantService.CurrentTenantChanged += async (s, tenant) =>
        {
            if (tenant != null)
            {
                await LoadForTenantAsync(tenant);
            }
        };

        if (_tenantService.CurrentTenant != null)
        {
            _ = LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    public async Task LoadForTenantAsync(Tenant tenant)
    {
        try
        {
            TenantTitleTextBlock.Text = $"Tenant: {tenant.Name}";
            SourceStatusTextBlock.Text = "Polled from backend...";
            bool sinceYesterday = SinceYesterdayCheckBox.IsChecked == true;

            var dashboard = await _telemetryService.FetchTelemetryAsync(tenant, sinceYesterday);
            RenderDashboard(dashboard);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[MyArchitect] Failed loading telemetry: {ex.Message}");
        }
    }

    public void RenderDashboard(TenantTelemetryDashboard dashboard)
    {
        _currentDashboard = dashboard;

        TenantTitleTextBlock.Text = $"Tenant: {dashboard.TenantName}";
        TimestampTextBlock.Text = $"Polled: {dashboard.FormattedTime} UTC ({dashboard.SourceStatus})";
        SourceStatusTextBlock.Text = dashboard.SourceStatus;

        bool isLive = dashboard.SourceStatus.StartsWith("Live", StringComparison.OrdinalIgnoreCase);
        SourceStatusBorder.Background = isLive
            ? new SolidColorBrush(System.Windows.Media.Color.FromRgb(26, 58, 90))
            : new SolidColorBrush(System.Windows.Media.Color.FromRgb(80, 50, 10));
        SourceStatusTextBlock.Foreground = isLive
            ? new SolidColorBrush(System.Windows.Media.Color.FromRgb(56, 155, 255))
            : new SolidColorBrush(System.Windows.Media.Color.FromRgb(255, 167, 38));

        // Engine Cards
        var sec = dashboard.Engines.FirstOrDefault(e => e.Key.Equals("security", StringComparison.OrdinalIgnoreCase));
        if (sec != null)
        {
            SecurityScoreTextBlock.Text = sec.Score.ToString();
            SecurityStatusTextBlock.Text = $"Status: {sec.Status}";
        }

        var comp = dashboard.Engines.FirstOrDefault(e => e.Key.Equals("compliance", StringComparison.OrdinalIgnoreCase));
        if (comp != null)
        {
            ComplianceScoreTextBlock.Text = comp.Score.ToString();
            ComplianceStatusTextBlock.Text = $"Status: {comp.Status}";
        }

        var ident = dashboard.Engines.FirstOrDefault(e => e.Key.Equals("identity", StringComparison.OrdinalIgnoreCase));
        if (ident != null)
        {
            IdentityScoreTextBlock.Text = ident.Score.ToString();
            IdentityStatusTextBlock.Text = $"Status: {ident.Status}";
        }

        var cop = dashboard.Engines.FirstOrDefault(e => e.Key.Equals("copilot", StringComparison.OrdinalIgnoreCase));
        if (cop != null)
        {
            CopilotScoreTextBlock.Text = cop.Score.ToString();
            CopilotStatusTextBlock.Text = $"Status: {cop.Status}";
        }
        else if (dashboard.CopilotDeltas.Count > 0)
        {
            var latest = dashboard.CopilotDeltas.Last();
            CopilotScoreTextBlock.Text = latest.Score.ToString();
            CopilotStatusTextBlock.Text = $"Delta: {latest.DisplayDelta} ({latest.Verdict})";
        }

        // SOW Progress
        SowPercentageTextBlock.Text = $"{dashboard.SowProgress.CompletionPercentage}%";
        SowProgressBar.Value = Math.Min(100, Math.Max(0, dashboard.SowProgress.CompletionPercentage));
        SowStepsCountTextBlock.Text = $"{dashboard.SowProgress.CompletedSteps}/{dashboard.SowProgress.TotalSteps} Steps";

        // Grids & Feeds
        DriftDataGrid.ItemsSource = dashboard.DriftEvents;
        CopilotDeltasDataGrid.ItemsSource = dashboard.CopilotDeltas;

        TimelineItemsControl.ItemsSource = dashboard.TimelineFeed;
        TimelineCountTextBlock.Text = $"{dashboard.TimelineFeed.Count} event{(dashboard.TimelineFeed.Count == 1 ? "" : "s")}";
    }

    private async void RefreshTelemetryButton_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService?.CurrentTenant != null)
        {
            await LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    private async void SinceYesterdayCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        if (_tenantService?.CurrentTenant != null)
        {
            await LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }
}
