using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #2149 — embedded interactive Claude Code terminal panel.
    ///
    /// Hosts a real Windows pseudo-console (<see cref="Services.PtySession"/>)
    /// running PowerShell in the repo root, and renders its VT stream with
    /// xterm.js inside a WebView2. Because the child runs under a genuine
    /// pseudo-terminal, `claude`'s full interactive TUI (colour, cursor
    /// addressing, live redraw, the alternate screen buffer) works exactly as it
    /// does in Windows Terminal — unlike the line-based redirected-stdio
    /// <see cref="TerminalView"/>, which cannot host it at all.
    ///
    /// Copy/paste is routed back through C# so it uses Windows' native WPF
    /// clipboard (<see cref="System.Windows.Clipboard"/>) — select + Ctrl+C /
    /// Ctrl+V behave like any other Windows app, which is the whole point of the
    /// issue (claude.exe's own console host has genuinely bad copy/paste).
    ///
    /// The session is persistent (one long-lived shell, not one process per
    /// command) and is created lazily the first time the panel becomes visible,
    /// so opening BuildConsole does not spawn a claude session on its own.
    /// </summary>
    public partial class ClaudeTerminalView : UserControl
    {
        private const string VirtualHost = "buildconsole.terminal";

        private Services.PtySession? _pty;
        private bool _webViewInitStarted;
        private bool _webViewReady;
        private bool _sessionStarted;
        private bool _autoLaunchClaudePending;
        private short _cols = 80;
        private short _rows = 24;
        private string _cwd = string.Empty;

        public ClaudeTerminalView()
        {
            InitializeComponent();
            _cwd = Services.BuildTrackerConfig.FindRepoRoot() ?? AppContext.BaseDirectory;
            CwdBox.Text = _cwd;
            // Lazy: only stand up WebView2 + the pty when the tab is first shown.
            IsVisibleChanged += OnIsVisibleChanged;
            Unloaded += (_, _) => StopSession();
        }

        private async void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (!IsVisible || _webViewInitStarted) return;
            _webViewInitStarted = true;
            _autoLaunchClaudePending = true; // first time the panel opens, land straight in claude
            await InitializeWebViewAsync();
        }

        private async System.Threading.Tasks.Task InitializeWebViewAsync()
        {
            try
            {
                StatusText.Text = "loading terminal…";
                bool ok = await MainWindow.EnsureWebViewInitializedAsync(TerminalWebView);
                var core = TerminalWebView.CoreWebView2;
                if (!ok || core == null)
                {
                    StatusText.Text = "WebView2 unavailable";
                    return;
                }

                // Our JS handles right-click paste; suppress WebView2's own menu.
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;

                string assetDir = Path.Combine(AppContext.BaseDirectory, "Assets", "xterm");
                core.SetVirtualHostNameToFolderMapping(
                    VirtualHost, assetDir,
                    Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

                core.WebMessageReceived -= OnWebMessage;
                core.WebMessageReceived += OnWebMessage;

                TerminalWebView.Source = new Uri($"https://{VirtualHost}/terminal.html");
            }
            catch (Exception ex)
            {
                StatusText.Text = "init failed";
                Services.ActivityLog.Log("system.core", $"ClaudeTerminalView init failed: {ex.Message}");
            }
        }

        private void OnWebMessage(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { return; }
            if (string.IsNullOrEmpty(raw)) return;

            string type;
            JsonElement root;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                root = doc.RootElement.Clone();
                type = root.GetProperty("type").GetString() ?? string.Empty;
            }
            catch { return; }

            switch (type)
            {
                case "ready":
                    _webViewReady = true;
                    StartSession();
                    break;

                case "input":
                    if (root.TryGetProperty("data", out var dEl))
                        _pty?.Write(dEl.GetString() ?? string.Empty);
                    break;

                case "resize":
                    if (root.TryGetProperty("cols", out var cEl) && root.TryGetProperty("rows", out var rEl))
                    {
                        _cols = (short)Math.Clamp(cEl.GetInt32(), 1, 1000);
                        _rows = (short)Math.Clamp(rEl.GetInt32(), 1, 1000);
                        _pty?.Resize(_cols, _rows);
                    }
                    break;

                case "copy":
                    if (root.TryGetProperty("data", out var copyEl))
                    {
                        string sel = copyEl.GetString() ?? string.Empty;
                        if (sel.Length > 0)
                        {
                            try { Clipboard.SetText(sel); } catch { /* clipboard busy */ }
                        }
                    }
                    break;

                case "paste":
                    try
                    {
                        if (Clipboard.ContainsText())
                        {
                            string text = Clipboard.GetText();
                            if (!string.IsNullOrEmpty(text)) _pty?.Write(text);
                        }
                    }
                    catch { /* clipboard busy */ }
                    break;
            }
        }

        private void StartSession()
        {
            if (_sessionStarted) return;
            _sessionStarted = true;
            try
            {
                _pty = new Services.PtySession();
                _pty.OutputReceived += OnPtyOutput;
                _pty.Exited += OnPtyExited;
                // Host PowerShell so `claude` resolves off PATH on any machine
                // (no hardcoded per-machine claude path) and Shane keeps a real
                // shell if he exits claude.
                _pty.Start("powershell.exe -NoLogo -NoProfile", _cwd, _cols, _rows);

                Dispatcher.Invoke(() => StatusText.Text = "running");

                if (_autoLaunchClaudePending)
                {
                    _autoLaunchClaudePending = false;
                    // Give PowerShell a moment to reach its first prompt, then
                    // drop straight into an interactive claude session.
                    _ = System.Threading.Tasks.Task.Run(async () =>
                    {
                        await System.Threading.Tasks.Task.Delay(700);
                        _pty?.Write("claude\r");
                    });
                }
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() => StatusText.Text = "failed to start");
                Services.ActivityLog.Log("system.core", $"ClaudeTerminalView pty start failed: {ex.Message}");
            }
        }

        private void OnPtyOutput(byte[] data)
        {
            if (data.Length == 0) return;
            string b64 = Convert.ToBase64String(data);
            string json = "{\"type\":\"output\",\"b64\":\"" + b64 + "\"}";
            Dispatcher.BeginInvoke(new Action(() =>
            {
                try { TerminalWebView.CoreWebView2?.PostWebMessageAsString(json); }
                catch { /* view torn down */ }
            }));
        }

        private void OnPtyExited()
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                StatusText.Text = "shell exited";
            }));
        }

        private void StopSession()
        {
            try { _pty?.Dispose(); } catch { }
            _pty = null;
            _sessionStarted = false;
        }

        // ── Toolbar ──

        private void LaunchClaude_Click(object sender, RoutedEventArgs e)
        {
            if (_pty == null || !_pty.IsRunning)
            {
                _autoLaunchClaudePending = true;
                StartSession();
                return;
            }
            _pty.Write("claude\r");
            TerminalWebView.Focus();
        }

        private void Restart_Click(object sender, RoutedEventArgs e)
        {
            StopSession();
            try { TerminalWebView.CoreWebView2?.PostWebMessageAsString("{\"type\":\"clear\"}"); } catch { }
            _autoLaunchClaudePending = false; // a manual restart just gives a clean shell
            if (_webViewReady) StartSession();
            TerminalWebView.Focus();
        }
    }
}
