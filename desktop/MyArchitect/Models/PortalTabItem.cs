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

    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public required Tenant Tenant { get; init; }
    public required PortalType PortalType { get; init; }
    public required WebView2 WebView { get; init; }
    public SymbolRegular IconSymbol { get; init; }

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

    public Visibility TabVisibility => _isActive ? Visibility.Visible : Visibility.Collapsed;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
