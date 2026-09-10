using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using MyArchitect.Models;
using MyArchitect.Services;
// UseWindowsForms brings System.Windows.Forms (and System.Drawing) in as implicit global usings,
// so these WPF types collide with their WinForms/GDI namesakes. Alias to the WPF ones, matching
// the pattern in ConsolePanelView.xaml.cs.
using UserControl = System.Windows.Controls.UserControl;
using Button = System.Windows.Controls.Button;
using Orientation = System.Windows.Controls.Orientation;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using Cursors = System.Windows.Input.Cursors;
using Clipboard = System.Windows.Clipboard;
using Color = System.Windows.Media.Color;
using Brushes = System.Windows.Media.Brushes;
using FontFamily = System.Windows.Media.FontFamily;

namespace MyArchitect.Shell;

/// <summary>
/// The Credential Vault surface (#3461), hosted as an Admin-tab center document (UI_RULES.md §2
/// lists "Admin | Vault (#3461)…"). It renders one of three states from
/// <see cref="IVaultService"/>: create-master-password (first run), unlock (locked), and the
/// unlocked per-tenant entry list with add/edit/reveal/copy/delete.
///
/// Plaintext passwords are read from <see cref="IVaultService.RevealSecret"/> only on an explicit
/// user action (reveal or copy) and are held nowhere but this control's own transient UI — they
/// are deliberately never routed through the shared record-workspace shell contract, honoring the
/// Feature's hard isolation boundary ("never exposed to Claude Chat or any other module").
/// </summary>
public partial class VaultPanelView : UserControl
{
    private IVaultService? _vault;
    private ITenantService? _tenants;

    // When set, the Add/Edit form is editing this existing entry rather than adding a new one.
    private string? _editingEntryId;

    public VaultPanelView()
    {
        InitializeComponent();
    }

    public void Initialize(IVaultService vault, ITenantService tenants)
    {
        _vault = vault;
        _tenants = tenants;
        _vault.StateChanged += () => Dispatcher.Invoke(RefreshView);
        _tenants.CurrentTenantChanged += (_, _) => Dispatcher.Invoke(RefreshView);
        RefreshView();
    }

    /// <summary>Called whenever the Vault document becomes visible so the correct state shows
    /// immediately (e.g. it may have been locked while hidden).</summary>
    public void OnShown()
    {
        RefreshView();
        if (UnlockPanel.Visibility == Visibility.Visible)
        {
            UnlockPasswordBox.Clear();
            UnlockPasswordBox.Focus();
        }
        else if (CreatePanel.Visibility == Visibility.Visible)
        {
            NewPasswordBox.Focus();
        }
    }

    // ---- view state -----------------------------------------------------------------------

    private void RefreshView()
    {
        if (_vault == null) return;

        CreatePanel.Visibility = Visibility.Collapsed;
        UnlockPanel.Visibility = Visibility.Collapsed;
        UnlockedPanel.Visibility = Visibility.Collapsed;

        if (!_vault.IsInitialized)
        {
            CreatePanel.Visibility = Visibility.Visible;
        }
        else if (!_vault.IsUnlocked)
        {
            UnlockPanel.Visibility = Visibility.Visible;
        }
        else
        {
            UnlockedPanel.Visibility = Visibility.Visible;
            ResetForm();
            RenderEntries();
        }
    }

    // ---- create -----------------------------------------------------------------------------

    private void CreateButton_Click(object sender, RoutedEventArgs e)
    {
        CreateErrorText.Visibility = Visibility.Collapsed;
        var pw = NewPasswordBox.Password;
        var confirm = ConfirmPasswordBox.Password;

        if (string.IsNullOrEmpty(pw))
        {
            ShowCreateError("Enter a master password.");
            return;
        }
        if (pw.Length < 8)
        {
            ShowCreateError("Use at least 8 characters for the master password.");
            return;
        }
        if (pw != confirm)
        {
            ShowCreateError("The two passwords do not match.");
            return;
        }

        try
        {
            _vault!.CreateVault(pw);
            NewPasswordBox.Clear();
            ConfirmPasswordBox.Clear();
        }
        catch (Exception ex)
        {
            ShowCreateError(ex.Message);
        }
    }

    private void ShowCreateError(string message)
    {
        CreateErrorText.Text = message;
        CreateErrorText.Visibility = Visibility.Visible;
    }

    // ---- unlock -----------------------------------------------------------------------------

    private void UnlockButton_Click(object sender, RoutedEventArgs e) => TryUnlock();

    private void UnlockPasswordBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) TryUnlock();
    }

    private void TryUnlock()
    {
        UnlockErrorText.Visibility = Visibility.Collapsed;
        try
        {
            if (_vault!.Unlock(UnlockPasswordBox.Password))
            {
                UnlockPasswordBox.Clear();
            }
            else
            {
                UnlockErrorText.Text = "Incorrect master password.";
                UnlockErrorText.Visibility = Visibility.Visible;
                UnlockPasswordBox.SelectAll();
            }
        }
        catch (Exception ex)
        {
            UnlockErrorText.Text = ex.Message;
            UnlockErrorText.Visibility = Visibility.Visible;
        }
    }

    private void LockButton_Click(object sender, RoutedEventArgs e) => _vault?.Lock();

    // ---- add / edit form --------------------------------------------------------------------

    private void ResetForm()
    {
        _editingEntryId = null;
        FormHeaderText.Text = "Add credential";
        FormPasswordLabel.Text = "Password";
        SaveButton.Content = "Add Credential";
        CancelEditButton.Visibility = Visibility.Collapsed;
        FormLabelBox.Clear();
        FormUsernameBox.Clear();
        FormPasswordBox.Clear();
        FormErrorText.Visibility = Visibility.Collapsed;

        var tenant = _tenants?.CurrentTenant;
        TenantHeaderText.Text = tenant != null ? $"· {tenant.Name}" : "· (no tenant selected)";
        SaveButton.IsEnabled = tenant != null;
    }

    private void BeginEdit(VaultEntry entry)
    {
        _editingEntryId = entry.Id;
        FormHeaderText.Text = "Edit credential";
        FormPasswordLabel.Text = "Password (leave blank to keep current)";
        SaveButton.Content = "Save Changes";
        CancelEditButton.Visibility = Visibility.Visible;
        FormLabelBox.Text = entry.Label;
        FormUsernameBox.Text = entry.Username;
        FormPasswordBox.Clear();
        FormErrorText.Visibility = Visibility.Collapsed;
        FormLabelBox.Focus();
    }

    private void CancelEditButton_Click(object sender, RoutedEventArgs e) => ResetForm();

    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        FormErrorText.Visibility = Visibility.Collapsed;
        var tenant = _tenants?.CurrentTenant;
        if (tenant == null)
        {
            ShowFormError("Select a tenant first.");
            return;
        }
        var label = FormLabelBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(label))
        {
            ShowFormError("A label is required.");
            return;
        }

        try
        {
            if (_editingEntryId == null)
            {
                _vault!.AddEntry(tenant.TenantGuid, label, FormUsernameBox.Text ?? string.Empty, FormPasswordBox.Password);
            }
            else
            {
                // Blank password box on edit means "keep the existing secret".
                var newPassword = string.IsNullOrEmpty(FormPasswordBox.Password) ? null : FormPasswordBox.Password;
                _vault!.UpdateEntry(_editingEntryId, label, FormUsernameBox.Text ?? string.Empty, newPassword);
            }
            ResetForm();
            RenderEntries();
        }
        catch (Exception ex)
        {
            ShowFormError(ex.Message);
        }
    }

    private void ShowFormError(string message)
    {
        FormErrorText.Text = message;
        FormErrorText.Visibility = Visibility.Visible;
    }

    // ---- entry list -------------------------------------------------------------------------

    private void RenderEntries()
    {
        EntriesHost.Children.Clear();
        var tenant = _tenants?.CurrentTenant;
        if (tenant == null)
        {
            EntriesHost.Children.Add(new TextBlock
            {
                Text = "Select a tenant to view and manage its stored credentials.",
                Foreground = new SolidColorBrush(Color.FromRgb(0x85, 0x85, 0x85)),
                FontSize = 12,
                Margin = new Thickness(0, 8, 0, 0),
            });
            return;
        }

        var entries = _vault!.GetEntries(tenant.TenantGuid);
        if (entries.Count == 0)
        {
            EntriesHost.Children.Add(new TextBlock
            {
                Text = $"No credentials stored for {tenant.Name} yet. Add one above.",
                Foreground = new SolidColorBrush(Color.FromRgb(0x85, 0x85, 0x85)),
                FontSize = 12,
                Margin = new Thickness(0, 8, 0, 0),
            });
            return;
        }

        foreach (var entry in entries)
        {
            EntriesHost.Children.Add(BuildEntryCard(entry));
        }
    }

    private Border BuildEntryCard(VaultEntry entry)
    {
        var card = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x25, 0x25, 0x26)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(0x2B, 0x2B, 0x2B)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(12, 10, 12, 10),
            Margin = new Thickness(0, 0, 0, 8),
        };

        var root = new StackPanel();

        root.Children.Add(new TextBlock
        {
            Text = entry.Label,
            Foreground = Brushes.White,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 6),
        });

        // Username row
        if (!string.IsNullOrEmpty(entry.Username))
        {
            var userRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            userRow.Children.Add(new TextBlock
            {
                Text = "User",
                Foreground = new SolidColorBrush(Color.FromRgb(0x85, 0x85, 0x85)),
                FontSize = 11,
                Width = 70,
                VerticalAlignment = VerticalAlignment.Center,
            });
            userRow.Children.Add(new TextBlock
            {
                Text = entry.Username,
                Foreground = new SolidColorBrush(Color.FromRgb(0xE0, 0xE0, 0xE0)),
                FontSize = 13,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 8, 0),
            });
            var copyUser = ChipButton("Copy");
            copyUser.Click += (_, _) => CopyToClipboard(entry.Username);
            userRow.Children.Add(copyUser);
            root.Children.Add(userRow);
        }

        // Password row (masked by default)
        var pwRow = new StackPanel { Orientation = Orientation.Horizontal };
        pwRow.Children.Add(new TextBlock
        {
            Text = "Password",
            Foreground = new SolidColorBrush(Color.FromRgb(0x85, 0x85, 0x85)),
            FontSize = 11,
            Width = 70,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var pwText = new TextBlock
        {
            Text = "••••••••••",
            Foreground = new SolidColorBrush(Color.FromRgb(0xE0, 0xE0, 0xE0)),
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            MinWidth = 110,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
        };
        pwRow.Children.Add(pwText);

        var revealBtn = ChipButton("Reveal");
        var revealed = false;
        revealBtn.Click += (_, _) =>
        {
            revealed = !revealed;
            if (revealed)
            {
                try
                {
                    pwText.Text = _vault!.RevealSecret(entry);
                    revealBtn.Content = "Hide";
                }
                catch (Exception ex)
                {
                    pwText.Text = $"(error: {ex.Message})";
                }
            }
            else
            {
                pwText.Text = "••••••••••";
                revealBtn.Content = "Reveal";
            }
        };
        pwRow.Children.Add(revealBtn);

        var copyPw = ChipButton("Copy");
        copyPw.Click += (_, _) =>
        {
            try { CopyToClipboard(_vault!.RevealSecret(entry)); }
            catch { /* nothing to copy on failure */ }
        };
        pwRow.Children.Add(copyPw);

        var editBtn = ChipButton("Edit");
        editBtn.Click += (_, _) => BeginEdit(entry);
        pwRow.Children.Add(editBtn);

        // Delete — confirm-armed in place (UI_RULES.md §3 confirm pattern), no dialog.
        var deleteBtn = ChipButton("Delete");
        deleteBtn.Foreground = new SolidColorBrush(Color.FromRgb(0xF4, 0x87, 0x71));
        var armed = false;
        deleteBtn.Click += (_, _) =>
        {
            if (!armed)
            {
                armed = true;
                deleteBtn.Content = "Delete — click again";
                return;
            }
            _vault!.DeleteEntry(entry.Id);
            RenderEntries();
        };
        pwRow.Children.Add(deleteBtn);

        root.Children.Add(pwRow);
        card.Child = root;
        return card;
    }

    private static Button ChipButton(string content) => new()
    {
        Content = content,
        Background = new SolidColorBrush(Color.FromRgb(0x2D, 0x2D, 0x30)),
        Foreground = new SolidColorBrush(Color.FromRgb(0xCC, 0xCC, 0xCC)),
        BorderBrush = new SolidColorBrush(Color.FromRgb(0x3C, 0x3C, 0x3C)),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(8, 3, 8, 3),
        FontSize = 11,
        Margin = new Thickness(0, 0, 6, 0),
        Cursor = Cursors.Hand,
    };

    private static void CopyToClipboard(string value)
    {
        try
        {
            Clipboard.SetText(string.IsNullOrEmpty(value) ? " " : value);
        }
        catch
        {
            // Clipboard can transiently fail if another process holds it; ignore.
        }
    }
}
