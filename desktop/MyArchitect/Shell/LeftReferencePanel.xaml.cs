using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using MyArchitect.Models;
using UserControl = System.Windows.Controls.UserControl;
using Button = System.Windows.Controls.Button;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Cursors = System.Windows.Input.Cursors;
using HorizontalAlignment = System.Windows.HorizontalAlignment;

namespace MyArchitect.Shell;

/// <summary>
/// The left panel — reference, read-only (UI_RULES.md §1's "shell owns header/collapse/splitter/
/// persisted size; a Feature supplies only the body"). Portal Bookmarks is real, existing content
/// folded in from the old activity-bar popout (UI_RULES.md §8). Consent Status (#3485) is real,
/// driven by <see cref="SetConsentStatus"/> — the active tenant's real precondition flag across
/// all three grant keys. VIP lookup / document browse are stated-empty until their own Features
/// (#3484/#3486) land — never a fabricated box standing in for a feature that doesn't exist yet.
/// </summary>
public partial class LeftReferencePanel : UserControl
{
    public event Action<PortalType>? BookmarkSelected;

    /// <summary>Raised when the operator submits a UPN to check — #3484. The host resolves
    /// the real customer scope and reports back via <see cref="ShowVipLookupResult"/>.</summary>
    public event Action<string>? VipLookupRequested;

    private readonly List<Button> _bookmarkButtons = new();

    private static readonly (PortalType Type, string Name, string SubUrl, string Color)[] Bookmarks =
    {
        (PortalType.M365Admin, "M365 Admin Center", "admin.microsoft.com", "#0078D4"),
        (PortalType.EntraAdmin, "Entra ID Admin Center", "entra.microsoft.com", "#005A9E"),
        (PortalType.AzurePortal, "Azure Portal", "portal.azure.com", "#0089D6"),
        (PortalType.IntuneAdmin, "Intune Endpoint Manager", "intune.microsoft.com", "#008272"),
        (PortalType.ExchangeAdmin, "Exchange Admin Center", "admin.exchange.microsoft.com", "#0078D4"),
        (PortalType.SecurityAdmin, "Defender Security Center", "security.microsoft.com", "#D83B01"),
        (PortalType.ComplianceAdmin, "Purview Compliance", "compliance.microsoft.com", "#5C2D91"),
        (PortalType.TeamsAdmin, "Teams Admin Center", "admin.teams.microsoft.com", "#464EB8"),
    };

    public LeftReferencePanel()
    {
        InitializeComponent();
        BuildBookmarks();
    }

    public void SetTenantName(string? name)
    {
        TenantSubtext.Text = string.IsNullOrEmpty(name) ? "No tenant selected" : $"Active: {name}";
    }

    /// <summary>Renders the real, live consent status (#3485) for whichever tenant
    /// <see cref="MainWindow.RefreshConsentStatusAsync"/> resolved — one row per grant key
    /// (Read/Write-back/SharePoint), a colored status dot, and the real status text. <c>null</c>
    /// covers every honest "nothing to show" case (not signed in, no tenant selected, the call
    /// failed, or this MSP's book has no consent record at all for the active tenant) — never a
    /// fabricated status.</summary>
    public void SetConsentStatus(CustomerConsentSummary? summary)
    {
        ConsentStatusList.Children.Clear();

        if (summary == null)
        {
            ConsentStatusEmptyText.Visibility = Visibility.Visible;
            ConsentStatusList.Visibility = Visibility.Collapsed;
            return;
        }

        ConsentStatusEmptyText.Visibility = Visibility.Collapsed;
        ConsentStatusList.Visibility = Visibility.Visible;

        AddConsentStatusRow("Read (Graph)", summary.Graph);
        AddConsentStatusRow("Write-back", summary.WriteBack);
        AddConsentStatusRow("SharePoint", summary.Sharepoint);
    }

    private void AddConsentStatusRow(string label, ConsentGrant? grant)
    {
        var status = grant?.ConsentStatus ?? "not requested";

        var dot = new Border
        {
            Width = 8,
            Height = 8,
            CornerRadius = new CornerRadius(4),
            Background = ConsentStatusColor(status),
            Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var text = new TextBlock
        {
            Text = $"{label}: {status}",
            Foreground = Brushes.Gainsboro,
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var row = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, Margin = new Thickness(4, 2, 4, 2) };
        row.Children.Add(dot);
        row.Children.Add(text);
        ConsentStatusList.Children.Add(row);
    }

    /// <summary>Real <c>TenantConsentRecord.status</c> values only ("pending" | "granted" |
    /// "declined" | "revoked", <c>lib/db/src/schema/msp.ts</c>) plus the client-only "not
    /// requested" for a key with no record at all — never an invented status.</summary>
    private static Brush ConsentStatusColor(string status) => status switch
    {
        "granted" => new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x3F, 0xB9, 0x50)),
        "pending" => new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xD2, 0x99, 0x22)),
        "revoked" => new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xF8, 0x51, 0x49)),
        "declined" => new SolidColorBrush(System.Windows.Media.Color.FromRgb(0xF8, 0x51, 0x49)),
        _ => new SolidColorBrush(System.Windows.Media.Color.FromRgb(0x5A, 0x5A, 0x5A)),
    };

    private void BuildBookmarks()
    {
        BookmarksList.Children.Clear();
        _bookmarkButtons.Clear();

        foreach (var b in Bookmarks)
        {
            var swatch = new Border
            {
                Width = 28,
                Height = 28,
                CornerRadius = new CornerRadius(5),
                Background = (SolidColorBrush)new BrushConverter().ConvertFromString(b.Color)!,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
            };

            var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            text.Children.Add(new TextBlock { Text = b.Name, Foreground = System.Windows.Media.Brushes.White, FontSize = 12, FontWeight = FontWeights.SemiBold });
            text.Children.Add(new TextBlock { Text = b.SubUrl, Foreground = System.Windows.Media.Brushes.Gray, FontSize = 10, TextTrimming = TextTrimming.CharacterEllipsis });

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(swatch, 0);
            Grid.SetColumn(text, 1);
            grid.Children.Add(swatch);
            grid.Children.Add(text);

            var btn = new Button
            {
                Content = grid,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(8, 7, 8, 7),
                Margin = new Thickness(0, 2, 0, 0),
                Cursor = System.Windows.Input.Cursors.Hand,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Tag = b.Name + " " + b.SubUrl,
            };
            var portalType = b.Type;
            btn.Click += (_, _) => BookmarkSelected?.Invoke(portalType);
            _bookmarkButtons.Add(btn);
            BookmarksList.Children.Add(btn);
        }
    }

    private void BookmarkSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        var filter = BookmarkSearchBox.Text?.Trim() ?? string.Empty;
        foreach (var btn in _bookmarkButtons)
        {
            var tag = btn.Tag?.ToString() ?? string.Empty;
            btn.Visibility = string.IsNullOrWhiteSpace(filter) || tag.Contains(filter, StringComparison.OrdinalIgnoreCase)
                ? Visibility.Visible
                : Visibility.Collapsed;
        }
    }

    // ---- VIP lookup (#3484) — real check against msp-vip-classifications, surfaced before
    // acting on a user in Console/Remediation execution flows. This box is the same "before I
    // touch this account" safety check, addressable directly. ----------------------------------

    private void VipCheckButton_Click(object sender, RoutedEventArgs e) => SubmitVipLookup();

    private void VipUpnBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            SubmitVipLookup();
        }
    }

    private void SubmitVipLookup()
    {
        var upn = VipUpnBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(upn))
        {
            return;
        }

        VipResultText.Text = "Checking…";
        VipResultText.Foreground = Brushes.Gray;
        VipLookupRequested?.Invoke(upn);
    }

    /// <summary>Host reports the real result back — never guessed client-side. <paramref name="isVip"/>
    /// is null when the principal has no classification row at all (neither told nor discovered).</summary>
    public void ShowVipLookupResult(string upn, bool? isVip, string? detail)
    {
        if (!string.Equals(VipUpnBox.Text?.Trim(), upn, StringComparison.OrdinalIgnoreCase))
        {
            return; // operator already typed something else — don't overwrite with a stale result
        }

        VipResultText.Text = isVip switch
        {
            true => $"VIP — {detail}",
            false => $"Not VIP — {detail}",
            null => detail ?? "No classification on record.",
        };
        VipResultText.Foreground = isVip == true
            ? (Brush)new BrushConverter().ConvertFromString("#F2A900")!
            : Brushes.Gray;
    }
}
