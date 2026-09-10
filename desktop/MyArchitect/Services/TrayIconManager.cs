using System;
using System.Drawing;
using System.Windows;
using Forms = System.Windows.Forms;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Manages system tray notification icon and tray behavior for MyArchitect shell.
/// </summary>
public sealed class TrayIconManager : IDisposable
{
    private readonly Window _mainWindow;
    private readonly Forms.NotifyIcon _notifyIcon;
    private readonly Forms.ToolStripMenuItem _tenantMenuItem;
    private bool _isDisposed;

    public TrayIconManager(Window mainWindow, ITenantService tenantService)
    {
        _mainWindow = mainWindow ?? throw new ArgumentNullException(nameof(mainWindow));

        var contextMenu = new Forms.ContextMenuStrip();

        var openMenuItem = new Forms.ToolStripMenuItem("Open MyArchitect", null, (s, e) => RestoreWindow());
        openMenuItem.Font = new Font(openMenuItem.Font, System.Drawing.FontStyle.Bold);

        _tenantMenuItem = new Forms.ToolStripMenuItem($"Active Tenant: {tenantService.CurrentTenant?.Name ?? "None"}")
        {
            Enabled = false
        };

        var exitMenuItem = new Forms.ToolStripMenuItem("Exit", null, (s, e) =>
        {
            Dispose();
            System.Windows.Application.Current.Shutdown();
        });

        contextMenu.Items.Add(openMenuItem);
        contextMenu.Items.Add(_tenantMenuItem);
        contextMenu.Items.Add(new Forms.ToolStripSeparator());
        contextMenu.Items.Add(exitMenuItem);

        _notifyIcon = new Forms.NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "MyArchitect - Operator Cockpit",
            Visible = true,
            ContextMenuStrip = contextMenu
        };

        _notifyIcon.DoubleClick += (s, e) => RestoreWindow();
        _notifyIcon.Click += (s, e) =>
        {
            if (e is Forms.MouseEventArgs mouseEvent && mouseEvent.Button == Forms.MouseButtons.Left)
            {
                RestoreWindow();
            }
        };

        tenantService.CurrentTenantChanged += (s, tenant) => UpdateTenant(tenant);
    }

    public void UpdateTenant(Tenant? tenant)
    {
        if (_isDisposed) return;
        var name = tenant?.Name ?? "None";
        _tenantMenuItem.Text = $"Active Tenant: {name}";
        var tooltip = $"MyArchitect [{name}]";
        _notifyIcon.Text = tooltip.Length > 63 ? tooltip.Substring(0, 63) : tooltip;
    }

    public void RestoreWindow()
    {
        if (_mainWindow.WindowState == WindowState.Minimized)
        {
            _mainWindow.WindowState = WindowState.Maximized;
        }

        _mainWindow.Show();
        _mainWindow.Activate();
        _mainWindow.Focus();
    }

    public void MinimizeToTray()
    {
        _mainWindow.Hide();
    }

    public void Dispose()
    {
        if (_isDisposed) return;
        _isDisposed = true;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
