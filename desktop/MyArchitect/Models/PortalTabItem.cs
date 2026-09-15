using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
using Wpf.Ui.Controls;

namespace MyArchitect.Models;

/// <summary>
/// Represents an open, stateful portal tab within the operator shell.
/// </summary>
public sealed class PortalTabItem : INotifyPropertyChanged
{
    private string _title = string.Empty;
    private string _url = string.Empty;
    private bool _isActive;
    private bool _isLoading;
    private bool _isDarkMode = true;

    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public Tenant? Tenant { get; init; }
    public required PortalType PortalType { get; init; }
    public required WebView2 WebView { get; init; }
    public SymbolRegular IconSymbol { get; init; }
    public bool IsGlobal => Tenant == null || PortalType == PortalType.ClaudeChat;

    public string DisplaySubtitle => IsGlobal ? "Global Session" : (Tenant?.Name ?? "General");
    public string DisplayBadge => IsGlobal ? "Global Session: Claude.ai" : $"Profile: {Tenant?.Name}";

    public string Title
    {
        get => _title;
        set
        {
            if (_title != value)
            {
                _title = value;
                OnPropertyChanged();
            }
        }
    }

    public string Url
    {
        get => _url;
        set
        {
            if (_url != value)
            {
                _url = value;
                OnPropertyChanged();
            }
        }
    }

    public bool IsActive
    {
        get => _isActive;
        set
        {
            if (_isActive != value)
            {
                _isActive = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(TabVisibility));
            }
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        set
        {
            if (_isLoading != value)
            {
                _isLoading = value;
                OnPropertyChanged();
            }
        }
    }

    /// <summary>Per-tab dark-mode state (#4274) — seeded on tab open from the persisted
    /// preference (<see cref="Services.IDarkModePreferenceService"/>), then flips independently
    /// per tab as the operator toggles it. Default on.</summary>
    public bool IsDarkMode
    {
        get => _isDarkMode;
        set
        {
            if (_isDarkMode != value)
            {
                _isDarkMode = value;
                OnPropertyChanged();
            }
        }
    }

    /// <summary>The id returned by <c>AddScriptToExecuteOnDocumentCreatedAsync</c> for this tab's
    /// currently-registered dark-mode injection script, so it can be removed when toggled off.
    /// Null when dark mode is off (no script registered).</summary>
    public string? DarkModeScriptId { get; set; }

    public Visibility TabVisibility => _isActive ? Visibility.Visible : Visibility.Collapsed;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
