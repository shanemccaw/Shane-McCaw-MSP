using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using MyArchitect.Models;
using MyArchitect.Services;

namespace MyArchitect.Controls;

public sealed class TenantDisplayItem
{
    public required Tenant Tenant { get; init; }
    public Visibility CheckmarkVisibility { get; init; }
}

public partial class TenantSwitcher : System.Windows.Controls.UserControl
{
    private static readonly SolidColorBrush DefaultBackground = new(System.Windows.Media.Color.FromRgb(0x25, 0x25, 0x26));
    private static readonly SolidColorBrush HoverBackground = new(System.Windows.Media.Color.FromRgb(0x2D, 0x2D, 0x30));
    private static readonly SolidColorBrush ActiveBorder = new(System.Windows.Media.Color.FromRgb(0x38, 0x9B, 0xFF));
    private static readonly SolidColorBrush DefaultBorder = new(System.Windows.Media.Color.FromRgb(0x3E, 0x3E, 0x42));

    private ITenantService? _tenantService;
    private string _currentSearch = string.Empty;

    public TenantSwitcher()
    {
        InitializeComponent();
    }

    public void Initialize(ITenantService tenantService)
    {
        _tenantService = tenantService ?? throw new ArgumentNullException(nameof(tenantService));
        _tenantService.CurrentTenantChanged += (s, tenant) => UpdateCurrentTenantView(tenant);
        // Real customer list (#3540) loads async after sign-in — refresh the popup's list each
        // time it changes rather than reading it once at construction (when it's still empty).
        _tenantService.TenantsChanged += (s, e) => RefreshList();
        UpdateCurrentTenantView(_tenantService.CurrentTenant);
        RefreshList();
    }

    private void UpdateCurrentTenantView(Tenant? tenant)
    {
        TenantNameTextBlock.Text = tenant != null ? tenant.Name : "Select Tenant";
        RefreshList();
    }

    private void RefreshList()
    {
        if (_tenantService == null) return;

        var currentGuid = _tenantService.CurrentTenant?.TenantGuid ?? string.Empty;
        var query = _currentSearch.Trim();

        var filtered = _tenantService.Tenants
            .Where(t => string.IsNullOrWhiteSpace(query) ||
                        t.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                        t.TenantGuid.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Select(t => new TenantDisplayItem
            {
                Tenant = t,
                CheckmarkVisibility = t.TenantGuid.Equals(currentGuid, StringComparison.OrdinalIgnoreCase)
                    ? Visibility.Visible
                    : Visibility.Collapsed
            })
            .ToList();

        TenantsItemsControl.ItemsSource = filtered;
        CountTextBlock.Text = $"{filtered.Count} of {_tenantService.Tenants.Count}";
    }

    private void SwitcherPill_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        TenantPopup.IsOpen = !TenantPopup.IsOpen;
        if (TenantPopup.IsOpen)
        {
            SwitcherPillBorder.BorderBrush = ActiveBorder;
            SearchFilterTextBox.Focus();
        }
        else
        {
            SwitcherPillBorder.BorderBrush = DefaultBorder;
        }
    }

    private void SwitcherPill_MouseEnter(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!TenantPopup.IsOpen)
        {
            SwitcherPillBorder.Background = HoverBackground;
            SwitcherPillBorder.BorderBrush = ActiveBorder;
        }
    }

    private void SwitcherPill_MouseLeave(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!TenantPopup.IsOpen)
        {
            SwitcherPillBorder.Background = DefaultBackground;
            SwitcherPillBorder.BorderBrush = DefaultBorder;
        }
    }

    private void TenantPopup_Closed(object sender, EventArgs e)
    {
        SwitcherPillBorder.Background = DefaultBackground;
        SwitcherPillBorder.BorderBrush = DefaultBorder;
    }

    private void SearchFilterTextBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        _currentSearch = SearchFilterTextBox.Text;
        RefreshList();
    }

    private void TenantItem_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement element && element.DataContext is TenantDisplayItem item)
        {
            _tenantService?.SelectTenant(item.Tenant.Id);
            TenantPopup.IsOpen = false;
        }
    }
}
