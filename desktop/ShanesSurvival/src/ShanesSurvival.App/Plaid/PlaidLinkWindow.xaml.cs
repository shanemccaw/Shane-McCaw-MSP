using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace ShanesSurvival.App.Plaid;

/// <summary>Real outcome of a Plaid Link session — either a real public_token, or why there isn't one.</summary>
public sealed record PlaidLinkOutcome(bool Success, string? PublicToken, string? InstitutionName, string? ErrorMessage);

/// <summary>
/// Hosts Plaid's real hosted Link flow (link-initialize.js from Plaid's CDN) inside a WebView2
/// control — the standard way to run Plaid Link in a desktop app, since Plaid has no native
/// WPF/desktop SDK. The page posts a JSON message back to C# via
/// <c>window.chrome.webview.postMessage</c> on Link's onSuccess/onExit callbacks; nothing about
/// the real public_token or institution ever needs to leave the app's own process.
/// </summary>
public partial class PlaidLinkWindow : Window
{
    // How long to wait for the WebView2 control itself to spin up (CoreWebView2Environment +
    // EnsureCoreWebView2Async) before giving up and showing an error. Neither of those calls
    // takes a CancellationToken in the WebView2 SDK version this app targets, so a hang here
    // can't actually be cancelled — but we can stop waiting on it and tell Shane, instead of
    // leaving the dialog blank forever with no way to know what's wrong.
    private static readonly TimeSpan WebViewStartupTimeout = TimeSpan.FromSeconds(20);

    // Virtual host used via SetVirtualHostNameToFolderMapping so the Link page gets a real
    // (virtual) origin instead of the opaque "null" origin NavigateToString produces — see
    // StartWebViewAsync for why that opaque origin breaks Plaid's own postMessage calls.
    private const string VirtualHostName = "shanessurvival.local";

    private readonly string _linkToken;
    private bool _handled;
    private string? _linkHtmlFolder;

    /// <summary>Set once the dialog closes. Null only if the window was closed before WebView2
    /// finished initializing (e.g. the owner force-closed it).</summary>
    public PlaidLinkOutcome? Outcome { get; private set; }

    public PlaidLinkWindow(string linkToken)
    {
        InitializeComponent();
        _linkToken = linkToken;
        Loaded += async (_, _) => await InitializeWebViewAsync();
        Closed += (_, _) => CleanUpLinkHtmlFolder();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var startupTask = StartWebViewAsync();
            var timeoutTask = Task.Delay(WebViewStartupTimeout);
            var finished = await Task.WhenAny(startupTask, timeoutTask);

            if (finished == timeoutTask)
            {
                // The WebView2 SDK gives us no way to cancel startupTask, so let it keep
                // running in the background; observe (and swallow) whatever it eventually
                // does so it never surfaces as an unobserved-exception crash later.
                _ = startupTask.ContinueWith(t => _ = t.Exception, TaskScheduler.Default);

                ShowError(
                    $"The bank-connect browser didn't start within {WebViewStartupTimeout.TotalSeconds:0}s.\n\n" +
                    "This usually means the Microsoft Edge WebView2 Runtime isn't installed or " +
                    "can't start (https://developer.microsoft.com/microsoft-edge/webview2/).");
                Outcome = new PlaidLinkOutcome(false, null, null, "Timed out starting the WebView2 browser control.");
                return;
            }

            await startupTask; // propagate any real startup exception to the catch below
        }
        catch (Exception ex)
        {
            // EnsureCoreWebView2Async throws for real if the Edge WebView2 Runtime isn't
            // installed, or on any other real environment failure — never let that crash the
            // app; show a clear message and let Shane close the dialog (Cancel path).
            ShowError(
                $"Could not start the bank-connect browser: {ex.Message}\n\n" +
                "This requires the Microsoft Edge WebView2 Runtime " +
                "(https://developer.microsoft.com/microsoft-edge/webview2/).");
            Outcome = new PlaidLinkOutcome(false, null, null, ex.Message);
        }
    }

    private async Task StartWebViewAsync()
    {
        // Explicit user-data folder under %AppData% — never write into the app's install
        // location, same rule settings.json already follows, and avoids failures if the
        // app is ever installed somewhere the process can't write (e.g. Program Files).
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ShanesSurvival", "WebView2");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);

        await LinkWebView.EnsureCoreWebView2Async(environment);
        LinkWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

        // NavigateToString gives the resulting document an opaque origin of the literal string
        // "null" (same as about:blank / a data: URI). Plaid's own Link bundle (flink.js, loaded
        // by link-initialize.js below) internally calls window.postMessage(msg, targetOrigin) for
        // its own real internal iframe communication, and Chromium throws
        // "SyntaxError: Invalid target origin 'null'" because Plaid's code assumes a real origin.
        // That throw happens inside Plaid's own bundle, uncaught, so it never reaches this app's
        // own onerror/watchdog handling — the fix is to give the page a real (virtual) origin via
        // SetVirtualHostNameToFolderMapping instead of navigating to a literal string.
        _linkHtmlFolder = Path.Combine(Path.GetTempPath(), "ShanesSurvival-PlaidLink-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_linkHtmlFolder);
        var linkHtmlPath = Path.Combine(_linkHtmlFolder, "link.html");
        await File.WriteAllTextAsync(linkHtmlPath, BuildHtml(_linkToken));

        LinkWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            VirtualHostName, _linkHtmlFolder, CoreWebView2HostResourceAccessKind.Allow);
        LinkWebView.CoreWebView2.Navigate($"https://{VirtualHostName}/link.html");
    }

    private void CleanUpLinkHtmlFolder()
    {
        if (_linkHtmlFolder is null)
        {
            return;
        }

        try
        {
            LinkWebView.CoreWebView2?.ClearVirtualHostNameToFolderMapping(VirtualHostName);
        }
        catch
        {
            // CoreWebView2 may already be gone if the window closed before WebView2 finished
            // initializing — the folder delete below still needs to run either way.
        }

        try
        {
            Directory.Delete(_linkHtmlFolder, recursive: true);
        }
        catch
        {
            // Best-effort cleanup of a temp file; never let this block the dialog from closing.
        }

        _linkHtmlFolder = null;
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_handled)
        {
            // A late watchdog/error message arriving after we already closed on a real
            // success/exit — ignore it instead of calling Close() twice.
            return;
        }

        try
        {
            var message = JsonSerializer.Deserialize<LinkBridgeMessage>(
                e.WebMessageAsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            switch (message?.Type)
            {
                case "success":
                    Outcome = new PlaidLinkOutcome(true, message.PublicToken, message.InstitutionName, null);
                    DialogResult = true;
                    break;
                case "exit":
                    Outcome = new PlaidLinkOutcome(false, null, null, message.Error ?? "Cancelled.");
                    DialogResult = false;
                    break;
                default:
                    return;
            }
            _handled = true;
            Close();
        }
        catch (Exception ex)
        {
            // A malformed/unexpected bridge message must never crash the app either.
            Outcome = new PlaidLinkOutcome(false, null, null, $"Unexpected error from Link: {ex.Message}");
            DialogResult = false;
            _handled = true;
            Close();
        }
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }

    private static string BuildHtml(string linkToken)
    {
        // JsonSerializer.Serialize of a string produces a valid, properly-escaped JS string
        // literal (JSON string syntax is a subset of JS string syntax) — safer than
        // hand-rolled string concatenation for embedding the token into the script.
        var tokenJson = JsonSerializer.Serialize(linkToken);

        return $$"""
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Segoe UI, sans-serif; display: flex; align-items: center; justify-content: center;
            height: 100vh; margin: 0; color: #333; text-align: center; padding: 24px; box-sizing: border-box;
          }
        </style>
        </head>
        <body>
        <div id="msg">Loading…</div>
        <script>
          var linkSettled = false;
          function post(obj) {
            if (linkSettled) return;
            linkSettled = true;
            try { window.chrome.webview.postMessage(obj); } catch (e) {}
          }
          // cdn.plaid.com's script tag below has no built-in load timeout — a network stall
          // (blocked host, dead proxy, etc.) leaves it pending forever with no error event, so
          // "Loading…" would otherwise sit on screen indefinitely with nothing to tell Shane
          // why. This watchdog is what actually surfaces that as a visible error.
          var linkLoadWatchdog = setTimeout(function () {
            post({
              type: "exit",
              error: "Timed out waiting for Plaid Link to load (20s). Check your internet " +
                "connection — cdn.plaid.com may be unreachable or blocked."
            });
          }, 20000);
          // Fires if the script tag itself fails outright (DNS failure, 404, etc.) — belt and
          // suspenders alongside the watchdog above, and reports the real cause when it is this.
          function onLinkScriptError() {
            clearTimeout(linkLoadWatchdog);
            post({ type: "exit", error: "Could not load Plaid Link from cdn.plaid.com — check your internet connection." });
          }
        </script>
        <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" onerror="onLinkScriptError()"></script>
        <script>
          try {
            var handler = Plaid.create({
              token: {{tokenJson}},
              onSuccess: function (public_token, metadata) {
                clearTimeout(linkLoadWatchdog);
                post({
                  type: "success",
                  publicToken: public_token,
                  institutionName: (metadata.institution && metadata.institution.name) || "Bank"
                });
              },
              onExit: function (err) {
                clearTimeout(linkLoadWatchdog);
                post({
                  type: "exit",
                  error: err ? (err.display_message || err.error_message || err.error_code) : null
                });
              },
              onLoad: function () {
                clearTimeout(linkLoadWatchdog);
                document.getElementById("msg").textContent = "Select your bank to connect.";
                handler.open();
              },
              onEvent: function () {}
            });
          } catch (e) {
            clearTimeout(linkLoadWatchdog);
            post({ type: "exit", error: "Failed to initialize Plaid Link: " + e.message });
          }
        </script>
        </body>
        </html>
        """;
    }

    private sealed class LinkBridgeMessage
    {
        public string? Type { get; set; }
        public string? PublicToken { get; set; }
        public string? InstitutionName { get; set; }
        public string? Error { get; set; }
    }
}
