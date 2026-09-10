using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using MyArchitect.Models;
using MyArchitect.Services;
using UserControl = System.Windows.Controls.UserControl;
using MessageBox = System.Windows.MessageBox;
using SaveFileDialog = Microsoft.Win32.SaveFileDialog;
using OpenFileDialog = Microsoft.Win32.OpenFileDialog;

namespace MyArchitect.Controls;

public partial class SowAssessmentView : UserControl
{
    private ITenantService? _tenantService;
    private IAssessmentService _assessmentService;
    private TenantAssessmentSnapshot? _currentSnapshot;

    public SowAssessmentView()
    {
        InitializeComponent();
        _assessmentService = new AssessmentService();
    }

    public void Initialize(ITenantService tenantService, IAssessmentService? assessmentService = null)
    {
        _tenantService = tenantService;
        if (assessmentService != null)
        {
            _assessmentService = assessmentService;
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

    /// <summary>Push the current session's bearer token (#3501) into the assessment service and
    /// re-load, so a view that first rendered "Authentication required" refreshes with real data
    /// the moment the operator signs in (or a token refresh lands).</summary>
    public void SetAuthToken(string? token)
    {
        _assessmentService.AuthToken = token;
        if (_tenantService?.CurrentTenant != null)
        {
            _ = LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    public async Task LoadForTenantAsync(Tenant tenant)
    {
        try
        {
            TenantTitleTextBlock.Text = $"Tenant: {tenant.Name}";
            SourceBadgeTextBlock.Text = "Querying Live Backend...";
            SourceBadgeBorder.Background = new SolidColorBrush(System.Windows.Media.Color.FromRgb(26, 58, 90));

            var snapshot = await _assessmentService.FetchLiveAssessmentAsync(tenant);
            RenderSnapshot(snapshot);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[MyArchitect] Failed loading assessment: {ex.Message}");
        }
    }

    public void RenderSnapshot(TenantAssessmentSnapshot snapshot)
    {
        _currentSnapshot = snapshot;

        TenantTitleTextBlock.Text = $"Tenant: {snapshot.TenantName}";
        TimestampTextBlock.Text = $"Snapshot: {snapshot.FormattedTimestamp} ({snapshot.Source})";
        SourceBadgeTextBlock.Text = snapshot.Source;

        bool isLive = snapshot.Source.StartsWith("Live", StringComparison.OrdinalIgnoreCase);
        SourceBadgeBorder.Background = isLive
            ? new SolidColorBrush(System.Windows.Media.Color.FromRgb(26, 58, 90))
            : new SolidColorBrush(System.Windows.Media.Color.FromRgb(80, 50, 10));
        SourceBadgeTextBlock.Foreground = isLive
            ? new SolidColorBrush(System.Windows.Media.Color.FromRgb(56, 155, 255))
            : new SolidColorBrush(System.Windows.Media.Color.FromRgb(255, 167, 38));

        // Copilot Gate
        CopilotScoreTextBlock.Text = snapshot.CopilotScore.ToString();
        if (snapshot.IsGatePassed)
        {
            GateVerdictTextBlock.Text = "GATE PASSED";
            GateVerdictTextBlock.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(76, 175, 80));
            GateVerdictBorder.Background = new SolidColorBrush(System.Windows.Media.Color.FromRgb(27, 77, 46));
        }
        else
        {
            GateVerdictTextBlock.Text = "GATE BLOCKED";
            GateVerdictTextBlock.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(255, 167, 38));
            GateVerdictBorder.Background = new SolidColorBrush(System.Windows.Media.Color.FromRgb(77, 46, 20));
        }

        // Remediation
        RemediationPercentTextBlock.Text = $"{snapshot.RemediationPercentage}%";
        RemediationProgressBar.Value = Math.Min(100, Math.Max(0, snapshot.RemediationPercentage));
        RemediationStepsCountTextBlock.Text = $"{snapshot.CompletedRemediationSteps} / {snapshot.TotalRemediationSteps} steps";

        // Drift & Signals
        DriftCountTextBlock.Text = snapshot.ActiveDriftCount.ToString();
        OversharingCountTextBlock.Text = snapshot.TotalOversharedSites.ToString();
        DlpIncidentCountTextBlock.Text = snapshot.DlpIncidentCount.ToString();
        UnapprovedDriftSubtext.Text = $"{snapshot.UnapprovedDriftCount} Unapproved changes detected";

        // Grids
        SowPhasesDataGrid.ItemsSource = snapshot.SowPhases;
        RemediationDataGrid.ItemsSource = snapshot.RemediationChecklist;
        DriftDataGrid.ItemsSource = snapshot.DriftEvents;
        OversharingDataGrid.ItemsSource = snapshot.OversharedSites;
        PillarsDataGrid.ItemsSource = snapshot.PillarScores;
    }

    private async void RefreshLiveButton_Click(object sender, RoutedEventArgs e)
    {
        if (_tenantService?.CurrentTenant != null)
        {
            await LoadForTenantAsync(_tenantService.CurrentTenant);
        }
    }

    private async void SaveSnapshotButton_Click(object sender, RoutedEventArgs e)
    {
        if (_currentSnapshot == null)
        {
            MessageBox.Show("No snapshot data available to save.", "Save Snapshot", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var sfd = new SaveFileDialog
        {
            Filter = "JSON Assessment Snapshot (*.json)|*.json",
            FileName = $"{_currentSnapshot.TenantName.Replace(" ", "_")}_Assessment_{DateTime.UtcNow:yyyyMMdd_HHmmss}.json",
            Title = "Save Local Assessment Snapshot"
        };

        if (sfd.ShowDialog() == true)
        {
            try
            {
                await _assessmentService.SaveSnapshotAsync(_currentSnapshot, sfd.FileName);
                MessageBox.Show($"Assessment snapshot successfully saved to:\n{sfd.FileName}", "Snapshot Saved", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed saving snapshot: {ex.Message}", "Save Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }

    private async void LoadSnapshotButton_Click(object sender, RoutedEventArgs e)
    {
        var ofd = new OpenFileDialog
        {
            Filter = "JSON Assessment Snapshot (*.json)|*.json",
            Title = "Load Offline Assessment Snapshot"
        };

        if (ofd.ShowDialog() == true)
        {
            try
            {
                var snapshot = await _assessmentService.LoadSnapshotAsync(ofd.FileName);
                RenderSnapshot(snapshot);
                MessageBox.Show($"Successfully loaded offline snapshot from {Path.GetFileName(ofd.FileName)}.", "Snapshot Loaded", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed loading snapshot: {ex.Message}", "Load Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}
