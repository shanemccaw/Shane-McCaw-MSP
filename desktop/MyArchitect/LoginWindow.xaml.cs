using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using MyArchitect.Models;
using MyArchitect.Services;
using Wpf.Ui.Controls;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace MyArchitect;

/// <summary>
/// Native MyArchitect sign-in window (#3501). Drives the real api-server MSP-staff auth
/// contract via <see cref="IAuthService"/> — email+password, then a headless MFA code step
/// if the account has an enrolled method. No browser redirect is involved; the same
/// email/password/JWT flow the Portal and Admin Panel use works headlessly here.
/// <see cref="Window.DialogResult"/> is <c>true</c> once a live session exists.
/// </summary>
public partial class LoginWindow : FluentWindow
{
    private readonly IAuthService _authService;
    private string? _mfaToken;
    private string _mfaMethod = "totp";

    public LoginWindow(IAuthService authService)
    {
        _authService = authService;
        InitializeComponent();

        EndpointNote.Text = $"Connecting to {ResolveBaseUrlLabel()}";
        Loaded += (_, _) => EmailBox.Focus();

        EmailBox.KeyDown += OnCredentialsKeyDown;
        PasswordBox.KeyDown += OnCredentialsKeyDown;
        MfaCodeBox.KeyDown += OnMfaKeyDown;
    }

    private static string ResolveBaseUrlLabel() =>
        Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080";

    private void OnCredentialsKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) _ = DoSignInAsync();
    }

    private void OnMfaKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) _ = DoVerifyMfaAsync();
    }

    private void SignInButton_Click(object sender, RoutedEventArgs e) => _ = DoSignInAsync();

    private void VerifyButton_Click(object sender, RoutedEventArgs e) => _ = DoVerifyMfaAsync();

    private void BackToCredentials_Click(object sender, RoutedEventArgs e)
    {
        _mfaToken = null;
        MfaError.Visibility = Visibility.Collapsed;
        MfaCodeBox.Clear();
        MfaPanel.Visibility = Visibility.Collapsed;
        CredentialsPanel.Visibility = Visibility.Visible;
        EmailBox.Focus();
    }

    private async Task DoSignInAsync()
    {
        var email = EmailBox.Text.Trim();
        var password = PasswordBox.Password;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
        {
            ShowCredentialsError("Enter your email and password.");
            return;
        }

        SetCredentialsBusy(true);
        try
        {
            var result = await _authService.LoginAsync(email, password);
            switch (result.Outcome)
            {
                case LoginOutcome.Success:
                    DialogResult = true;
                    Close();
                    break;

                case LoginOutcome.MfaRequired:
                    _mfaToken = result.MfaToken;
                    _mfaMethod = PickMethod(result.Methods);
                    MfaSubtitle.Text = _mfaMethod == "sms"
                        ? "Enter the code sent to your phone."
                        : "Enter the code from your authenticator app.";
                    CredentialsError.Visibility = Visibility.Collapsed;
                    CredentialsPanel.Visibility = Visibility.Collapsed;
                    MfaPanel.Visibility = Visibility.Visible;
                    MfaCodeBox.Focus();
                    break;

                default:
                    ShowCredentialsError(result.ErrorMessage ?? "Sign-in failed.");
                    break;
            }
        }
        finally
        {
            SetCredentialsBusy(false);
        }
    }

    private async Task DoVerifyMfaAsync()
    {
        var code = MfaCodeBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            ShowMfaError("Enter your authentication code.");
            return;
        }
        if (string.IsNullOrEmpty(_mfaToken))
        {
            BackToCredentials_Click(this, new RoutedEventArgs());
            return;
        }

        SetMfaBusy(true);
        try
        {
            var result = await _authService.VerifyMfaAsync(_mfaToken, _mfaMethod, code);
            if (result.Outcome == LoginOutcome.Success)
            {
                DialogResult = true;
                Close();
            }
            else
            {
                ShowMfaError(result.ErrorMessage ?? "Verification failed.");
            }
        }
        finally
        {
            SetMfaBusy(false);
        }
    }

    private static string PickMethod(string[]? methods)
    {
        if (methods == null || methods.Length == 0) return "totp";
        if (methods.Contains("totp", StringComparer.OrdinalIgnoreCase)) return "totp";
        if (methods.Contains("sms", StringComparer.OrdinalIgnoreCase)) return "sms";
        return methods[0];
    }

    private void ShowCredentialsError(string message)
    {
        CredentialsError.Text = message;
        CredentialsError.Visibility = Visibility.Visible;
    }

    private void ShowMfaError(string message)
    {
        MfaError.Text = message;
        MfaError.Visibility = Visibility.Visible;
    }

    private void SetCredentialsBusy(bool busy)
    {
        SignInButton.IsEnabled = !busy;
        EmailBox.IsEnabled = !busy;
        PasswordBox.IsEnabled = !busy;
        SignInButton.Content = busy ? "Signing in…" : "Sign in";
    }

    private void SetMfaBusy(bool busy)
    {
        VerifyButton.IsEnabled = !busy;
        MfaCodeBox.IsEnabled = !busy;
        VerifyButton.Content = busy ? "Verifying…" : "Verify";
    }
}
