using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole
{
    public partial class ApiHelperWindow : Window
    {
        private WebView2? _targetWebView;
        private string _activeBaseUrl = "";
        private string _activePagePath = "";

        private readonly List<VisualTestTrackerApiClient.TenantItem> _tenants = new();
        private readonly List<RecentAccountItem> _recentAccounts = new();

        public sealed class RecentAccountItem
        {
            public string Email { get; set; } = "";
            public string Password { get; set; } = "";
            public string Role { get; set; } = "";
            public string TenantName { get; set; } = "";
            public DateTime CreatedAt { get; set; } = DateTime.Now;
        }

        private static string RecentAccountsFilePath =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "BuildConsole", "visual-test-tracker", "recent-accounts.json");

        public ApiHelperWindow(WebView2? webView, string baseUrl, string pagePath)
        {
            InitializeComponent();
            _targetWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;

            UpdateActivePageDisplay();
            InitRoles();
            _ = LoadTenantsAsync();
            LoadRecentAccounts();
            GenerateRandomEmail();
        }

        public void UpdateActivePage(WebView2? webView, string baseUrl, string pagePath)
        {
            _targetWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;
            UpdateActivePageDisplay();
        }

        private void UpdateActivePageDisplay()
        {
            if (!string.IsNullOrWhiteSpace(_activeBaseUrl))
                ActivePageText.Text = $"{_activeBaseUrl}{_activePagePath}";
            else
                ActivePageText.Text = "No active page connected — navigate a watched tab.";
        }

        private void InitRoles()
        {
            CmbRole.Items.Clear();
            string[] roles = { "Customer", "PlatformAdmin", "MSPAdmin", "MSPOperator", "ServiceAccount", "Free" };
            foreach (var r in roles) CmbRole.Items.Add(r);
            CmbRole.SelectedIndex = 0; // Default to Customer
        }

        private async Task LoadTenantsAsync()
        {
            try
            {
                var list = await VisualTestTrackerApiClient.GetTenantsAsync();
                _tenants.Clear();
                _tenants.AddRange(list);

                CmbTenant.Items.Clear();
                foreach (var t in _tenants)
                {
                    CmbTenant.Items.Add(t);
                }

                if (CmbTenant.Items.Count > 0)
                    CmbTenant.SelectedIndex = 0;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("visual-test-tracker", $"LoadTenants error: {ex.Message}");
            }
        }

        private void GenerateRandomEmail()
        {
            var role = (CmbRole.SelectedItem as string)?.ToLowerInvariant() ?? "customer";
            var stamp = DateTime.Now.ToString("MMdd-HHmm");
            TxtEmail.Text = $"test.{role}.{stamp}@example.com";
        }

        private void BtnRandomEmail_Click(object sender, RoutedEventArgs e) => GenerateRandomEmail();

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void ShowStatus(string message, bool isError)
        {
            StatusBanner.Visibility = Visibility.Visible;
            StatusMessageText.Text = message;
            StatusMessageText.Foreground = (Brush)FindResource(isError ? "StatusErrorBrush" : "StatusSuccessBrush");
        }

        private async void BtnCreateAccount_Click(object sender, RoutedEventArgs e)
        {
            var email = TxtEmail.Text.Trim();
            var pass = TxtPassword.Text.Trim();
            var name = TxtName.Text.Trim();
            var role = CmbRole.SelectedItem as string ?? "Customer";
            var selectedTenant = CmbTenant.SelectedItem as VisualTestTrackerApiClient.TenantItem;

            if (string.IsNullOrWhiteSpace(email))
            {
                ShowStatus("Email address cannot be empty.", isError: true);
                return;
            }

            BtnCreateAccount.IsEnabled = false;
            ShowStatus("Creating test account via API...", isError: false);

            try
            {
                var req = new VisualTestTrackerApiClient.CreateAccountRequest
                {
                    Email = email,
                    Password = pass,
                    Name = name,
                    Role = role,
                    TenantId = selectedTenant?.Id,
                    MspId = selectedTenant?.MspId
                };

                var res = await VisualTestTrackerApiClient.CreateTestAccountAsync(req);
                if (!res.Success)
                {
                    ShowStatus($"Account creation failed: {res.Error}", isError: true);
                    return;
                }

                ShowStatus($"✅ Created test account {res.Email} (ID #{res.UserId}, Role: {res.Role}). Ready for page actions!", isError: false);

                // Save to recents
                var recent = new RecentAccountItem
                {
                    Email = res.Email,
                    Password = res.Password,
                    Role = res.Role,
                    TenantName = selectedTenant?.Name ?? $"Tenant #{res.TenantId}",
                    CreatedAt = DateTime.Now
                };
                _recentAccounts.Insert(0, recent);
                if (_recentAccounts.Count > 10) _recentAccounts.RemoveAt(10);
                PersistRecentAccounts();
                RenderRecentAccounts();
            }
            catch (Exception ex)
            {
                ShowStatus($"Error: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCreateAccount.IsEnabled = true;
            }
        }

        private async void BtnFillLoginForm_Click(object sender, RoutedEventArgs e)
        {
            if (_targetWebView == null || _targetWebView.CoreWebView2 == null)
            {
                ShowStatus("No active browser page connected to fill.", isError: true);
                return;
            }

            var email = TxtEmail.Text.Trim();
            var pass = TxtPassword.Text.Trim();
            bool filled = await InjectCredentialsAsync(email, pass, submit: false);
            if (filled)
                ShowStatus("Injected credentials into login inputs.", isError: false);
            else
                ShowStatus("Could not find login input fields on this page.", isError: true);
        }

        private async void BtnFillAndSubmit_Click(object sender, RoutedEventArgs e)
        {
            if (_targetWebView == null || _targetWebView.CoreWebView2 == null)
            {
                ShowStatus("No active browser page connected to submit.", isError: true);
                return;
            }

            var email = TxtEmail.Text.Trim();
            var pass = TxtPassword.Text.Trim();
            bool filled = await InjectCredentialsAsync(email, pass, submit: true);
            if (filled)
                ShowStatus("Injected credentials and submitted login form.", isError: false);
            else
                ShowStatus("Could not find login inputs or submit button on this page.", isError: true);
        }

        private async Task<bool> InjectCredentialsAsync(string email, string password, bool submit)
        {
            if (_targetWebView == null || _targetWebView.CoreWebView2 == null) return false;

            var encEmail = System.Text.Json.JsonSerializer.Serialize(email);
            var encPass = System.Text.Json.JsonSerializer.Serialize(password);
            var encSubmit = submit ? "true" : "false";

            string script = @"
(function(email, password, shouldSubmit) {
    try {
        var userEl = document.querySelector('input[type=""email""], input[name*=""email"" i], input[name*=""user"" i], input[id*=""email"" i]');
        var passEl = document.querySelector('input[type=""password""], input[name*=""password"" i]');

        if (!userEl || !passEl) {
            var inputs = Array.from(document.querySelectorAll('input'));
            for (var i = 0; i < inputs.length; i++) {
                if (inputs[i].type === 'password' && i > 0) {
                    passEl = inputs[i];
                    userEl = inputs[i - 1];
                    break;
                }
            }
        }

        if (!userEl || !passEl) return false;

        var setVal = function(el, val) {
            var proto = window.HTMLInputElement.prototype;
            var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            if (descriptor && descriptor.set) {
                descriptor.set.call(el, val);
            } else {
                el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setVal(userEl, email);
        setVal(passEl, password);

        if (shouldSubmit) {
            setTimeout(function() {
                var btn = document.querySelector('button[type=""submit""], button[data-testid*=""login"" i], button[data-testid*=""submit"" i]');
                if (!btn) {
                    var allBtns = Array.from(document.querySelectorAll('button'));
                    btn = allBtns.find(function(b) {
                        var t = (b.textContent || '').toLowerCase();
                        return t.includes('sign in') || t.includes('log in') || t.includes('submit');
                    });
                }
                if (btn) btn.click();
                else {
                    var form = userEl.closest('form');
                    if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                }
            }, 50);
        }

        return true;
    } catch(ex) {
        return false;
    }
})(" + encEmail + ", " + encPass + ", " + encSubmit + ");";

            try
            {
                var result = await _targetWebView.ExecuteScriptAsync(script);
                return string.Equals(result, "true", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private async void BtnDirectLogin_Click(object sender, RoutedEventArgs e)
        {
            if (_targetWebView == null || _targetWebView.CoreWebView2 == null)
            {
                ShowStatus("No active browser page connected.", isError: true);
                return;
            }

            var email = TxtEmail.Text.Trim();
            var pass = TxtPassword.Text.Trim();

            BtnDirectLogin.IsEnabled = false;
            ShowStatus("Authenticating directly via API...", isError: false);

            try
            {
                var loginRes = await VisualTestTrackerApiClient.LoginAsync(email, pass);
                if (!loginRes.Success)
                {
                    ShowStatus($"Direct login API refused: {loginRes.Error}", isError: true);
                    return;
                }

                // If on localhost:5175 or watched URL, set cookies or navigate
                string domain = "localhost";
                try
                {
                    if (_targetWebView.Source != null) domain = _targetWebView.Source.Host;
                }
                catch { }

                if (!string.IsNullOrEmpty(loginRes.RefreshToken))
                {
                    var cookieMgr = _targetWebView.CoreWebView2.CookieManager;
                    var cookie = cookieMgr.CreateCookie("refreshToken", loginRes.RefreshToken, domain, "/api/auth");
                    cookie.IsHttpOnly = true;
                    cookie.SameSite = Microsoft.Web.WebView2.Core.CoreWebView2CookieSameSiteKind.Lax;
                    cookieMgr.AddOrUpdateCookie(cookie);
                }

                // Navigate directly to portal or current page
                if (_targetWebView.Source != null)
                {
                    var uri = _targetWebView.Source.ToString();
                    if (uri.Contains("/login"))
                    {
                        // Navigate to portal
                        var selectedTenant = CmbTenant.SelectedItem as VisualTestTrackerApiClient.TenantItem;
                        var slug = !string.IsNullOrWhiteSpace(selectedTenant?.Domain) ? selectedTenant.Domain : "shane-mccaw-consulting";
                        var portalUrl = $"{_targetWebView.Source.Scheme}://{_targetWebView.Source.Authority}/portal/{slug}/portal-v2";
                        _targetWebView.CoreWebView2.Navigate(portalUrl);
                    }
                    else
                    {
                        _targetWebView.CoreWebView2.Reload();
                    }
                }

                ShowStatus("✅ Direct login session established! Page reloaded.", isError: false);
            }
            catch (Exception ex)
            {
                ShowStatus($"Direct login error: {ex.Message}", isError: true);
            }
            finally
            {
                BtnDirectLogin.IsEnabled = true;
            }
        }

        private void BtnNavigatePortal_Click(object sender, RoutedEventArgs e)
        {
            if (_targetWebView == null || _targetWebView.CoreWebView2 == null)
            {
                ShowStatus("No active browser page connected.", isError: true);
                return;
            }

            try
            {
                var authority = _targetWebView.Source?.Authority ?? "localhost:5175";
                var scheme = _targetWebView.Source?.Scheme ?? "http";
                var selectedTenant = CmbTenant.SelectedItem as VisualTestTrackerApiClient.TenantItem;
                var slug = !string.IsNullOrWhiteSpace(selectedTenant?.Domain) ? selectedTenant.Domain : "shane-mccaw-consulting";
                var portalUrl = $"{scheme}://{authority}/portal/{slug}/portal-v2";
                _targetWebView.CoreWebView2.Navigate(portalUrl);
                ShowStatus($"Navigating to {portalUrl}...", isError: false);
            }
            catch (Exception ex)
            {
                ShowStatus($"Navigation failed: {ex.Message}", isError: true);
            }
        }

        private void BtnCopyCredentials_Click(object sender, RoutedEventArgs e)
        {
            var email = TxtEmail.Text.Trim();
            var pass = TxtPassword.Text.Trim();
            Clipboard.SetText($"{email} / {pass}");
            ShowStatus("Credentials copied to clipboard.", isError: false);
        }

        private void LoadRecentAccounts()
        {
            try
            {
                var file = RecentAccountsFilePath;
                if (!File.Exists(file)) return;
                var json = File.ReadAllText(file);
                var items = JsonSerializer.Deserialize<List<RecentAccountItem>>(json);
                if (items != null)
                {
                    _recentAccounts.Clear();
                    _recentAccounts.AddRange(items);
                    RenderRecentAccounts();
                }
            }
            catch { }
        }

        private void PersistRecentAccounts()
        {
            try
            {
                var file = RecentAccountsFilePath;
                var dir = Path.GetDirectoryName(file)!;
                Directory.CreateDirectory(dir);
                var json = JsonSerializer.Serialize(_recentAccounts, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(file, json);
            }
            catch { }
        }

        private void RenderRecentAccounts()
        {
            RecentAccountsPanel.Children.Clear();
            NoRecentsText.Visibility = _recentAccounts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var acc in _recentAccounts)
            {
                var row = new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    CornerRadius = new CornerRadius(4),
                    Margin = new Thickness(0, 0, 0, 4),
                    Padding = new Thickness(6, 4, 6, 4)
                };

                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var info = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                info.Children.Add(new TextBlock
                {
                    Text = acc.Email,
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("TextBrush")
                });
                info.Children.Add(new TextBlock
                {
                    Text = $"{acc.Role} · {acc.TenantName} · {acc.CreatedAt:HH:mm}",
                    FontSize = 9,
                    Foreground = (Brush)FindResource("Subtext1Brush")
                });
                Grid.SetColumn(info, 0);

                var useBtn = new Button
                {
                    Content = "Use",
                    Style = (Style)FindResource("IconButton"),
                    FontSize = 10,
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(4, 0, 4, 0),
                    Tag = acc
                };
                useBtn.Click += (s, e) =>
                {
                    TxtEmail.Text = acc.Email;
                    TxtPassword.Text = acc.Password;
                    for (int i = 0; i < CmbRole.Items.Count; i++)
                    {
                        if (string.Equals(CmbRole.Items[i] as string, acc.Role, StringComparison.OrdinalIgnoreCase))
                        {
                            CmbRole.SelectedIndex = i;
                            break;
                        }
                    }
                    ShowStatus($"Loaded {acc.Email}", isError: false);
                };
                Grid.SetColumn(useBtn, 1);

                var fillBtn = new Button
                {
                    Content = "Fill",
                    Style = (Style)FindResource("IconButton"),
                    FontSize = 10,
                    Padding = new Thickness(6, 2, 6, 2),
                    Tag = acc
                };
                fillBtn.Click += async (s, e) =>
                {
                    TxtEmail.Text = acc.Email;
                    TxtPassword.Text = acc.Password;
                    await InjectCredentialsAsync(acc.Email, acc.Password, submit: false);
                };
                Grid.SetColumn(fillBtn, 2);

                grid.Children.Add(info);
                grid.Children.Add(useBtn);
                grid.Children.Add(fillBtn);
                row.Child = grid;

                RecentAccountsPanel.Children.Add(row);
            }
        }

        private void BtnClearRecents_Click(object sender, RoutedEventArgs e)
        {
            _recentAccounts.Clear();
            PersistRecentAccounts();
            RenderRecentAccounts();
        }
    }
}
