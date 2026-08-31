using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #1887 — background auto-reopen of tabs persisted in OpenChatTabs (#874,
    /// reliability fixed in #1886) at the PREVIOUS launch. Kicked off from
    /// RunDeferredStartupAsync (#1882) — i.e. during the loading overlay's own window —
    /// so real WebView2 navigation for each persisted tab happens CONCURRENTLY with the
    /// rest of startup instead of only starting the moment Shane clicks the tab later.
    ///
    /// Mechanism: WPF's TabControl only ever realizes the SELECTED tab's Content into the
    /// live visual tree (a single shared ContentPresenter bound to SelectedContent) — a
    /// background (non-selected) tab's WebView2 never fires Loaded and never navigates.
    /// So each reopened tab gets a normal placeholder tab (via OpenChatTab, unselected,
    /// inert) for its header/strip presence, AND a second, REAL WebView2 that's actually
    /// parked in <c>ChatReopenPreloadHost</c> (nonzero size, genuinely attached — the same
    /// keep-alive trick MainWindow.PinnedTabs.cs and ClaudeWebView already rely on) so it
    /// gets a real Loaded event and starts loading for real. The moment Shane selects that
    /// placeholder tab, EditorTabs_SelectionChanged (MainWindow.xaml.cs) calls
    /// <see cref="SwapInReopenPreload"/>, which swaps the already-loaded background
    /// WebView2 into the tab in place of the never-navigated placeholder — so the tab
    /// shows real, already-loaded content the instant it's opened rather than starting a
    /// fresh navigation right then.
    ///
    /// Isolated in its own partial-class file, same #972/#993 convention as
    /// MainWindow.PinnedTabs.cs / MainWindow.ShelvedTabs.cs, to stay out of the way of the
    /// concurrently-edited MainWindow.xaml.cs.
    /// </summary>
    public partial class MainWindow
    {
        private const string ChatReopenChannel = "home-screen";

        /// <summary>Conversation id -> the real, actually-loading/loaded WebView2 parked in ChatReopenPreloadHost.</summary>
        private readonly Dictionary<string, Microsoft.Web.WebView2.Wpf.WebView2> _reopenPreloadedWebViews = new();
        /// <summary>Conversation id -> that WebView2's context-meter wrapper (CreateChatContextWrapper's output) — the actual element parked/swapped, since the raw WebView2 is never a direct Grid child.</summary>
        private readonly Dictionary<string, FrameworkElement> _reopenPreloadedWrappers = new();
        /// <summary>Conversation id -> the 1x1 off-screen Border hosting it inside ChatReopenPreloadHost.</summary>
        private readonly Dictionary<string, Border> _reopenPreloadedHosts = new();
        /// <summary>Placeholder TabItem (created unselected by OpenChatTab) -> the conversation id whose background preload should be swapped in the moment this tab is actually selected.</summary>
        private readonly Dictionary<TabItem, string> _pendingReopenSwap = new();

        private const double ReopenParkOffscreenX = -20000d;
        private const double ReopenParkOffscreenY = -20000d;

        /// <summary>
        /// Git #2130 kill switch. Returns true only when the #1887 background preload is
        /// explicitly re-enabled — either the BUILDCONSOLE_ENABLE_CHAT_REOPEN_PRELOAD env
        /// var is truthy (a one-run override that doesn't touch settings.json), or the
        /// persisted <see cref="BuildConsole.Services.BuildConsoleSettings.EnableChatReopenPreload"/>
        /// toggle is on. Default (missing env var + default-false setting) is OFF.
        /// </summary>
        private static bool ChatReopenPreloadEnabled()
        {
            var env = Environment.GetEnvironmentVariable("BUILDCONSOLE_ENABLE_CHAT_REOPEN_PRELOAD");
            if (!string.IsNullOrWhiteSpace(env))
            {
                var v = env.Trim();
                if (v == "1" || v.Equals("true", StringComparison.OrdinalIgnoreCase) || v.Equals("yes", StringComparison.OrdinalIgnoreCase))
                    return true;
                if (v == "0" || v.Equals("false", StringComparison.OrdinalIgnoreCase) || v.Equals("no", StringComparison.OrdinalIgnoreCase))
                    return false;
            }
            try { return BuildConsole.Services.BuildConsoleSettings.Load().EnableChatReopenPreload; }
            catch { return false; }
        }

        /// <summary>
        /// Kicks off reopening every tab persisted in OpenChatTabs at the previous launch.
        /// Deliberately fire-and-forget from RunDeferredStartupAsync — NOT awaited, and NOT
        /// wired into _startupConnectivity/MarkShellReady(). The #1882 overlay must never
        /// block on real background work finishing (that's the exact failure #1882 fixed,
        /// and its own 20s GlobalCap backstop exists precisely so nothing can hold it
        /// hostage) — reopened tabs get the same treatment. They load CONCURRENTLY WITH the
        /// loading window, not gating it: on a normal connection they finish well within the
        /// overlay's own real init work and are ready the moment the app appears; on a slow
        /// one a tab simply keeps loading a little after — never worse than today, where it
        /// wouldn't have started loading at all until clicked.
        ///
        /// Capped concurrency (2 at a time via SemaphoreSlim), not full parallel: each
        /// reopened tab is a REAL browser page load (network + claude.ai's full JS boot),
        /// not a cheap operation, and #1883/#1884's queue-pickup readiness gating runs in
        /// this exact same startup window — piling every persisted tab's load onto the same
        /// few seconds would be real, avoidable resource contention on top of that.
        /// </summary>
        private async Task ReopenPersistedChatTabsInBackgroundAsync()
        {
            // Git #2130 — KILL SWITCH. This background preload path (real off-screen
            // WebView2 navigation for every persisted tab, kicked off inside the loading
            // window) was found to lock up Shane's machine and drain the build queue on a
            // real cold start. Default OFF: unless explicitly re-enabled, no-op here at the
            // single entry point so nothing is created, navigated, or parked in
            // ChatReopenPreloadHost. Manual tab-reopen-on-click (Home "Resume Chat") is a
            // separate path and is unaffected. Re-enable via the settings toggle or the
            // BUILDCONSOLE_ENABLE_CHAT_REOPEN_PRELOAD=1 env var once root-caused.
            if (!ChatReopenPreloadEnabled())
            {
                ActivityLog.Log(ChatReopenChannel,
                    "Git #2130: background chat-tab auto-reopen preload is DISABLED (kill switch) — skipping. Tabs still reopen on manual click.");
                return;
            }

            var toReopen = _chatTabsAtLaunch
                .Where(p => !string.IsNullOrWhiteSpace(p.ClaudeUrl) && !string.IsNullOrWhiteSpace(p.ConversationId))
                .ToList();
            if (toReopen.Count == 0) return;

            ActivityLog.Log(ChatReopenChannel, $"Git #1887: background-reopening {toReopen.Count} persisted chat tab(s)…");

            using var gate = new System.Threading.SemaphoreSlim(2);
            var tasks = toReopen.Select(p => ReopenOnePersistedTabInBackgroundAsync(p, gate));
            await Task.WhenAll(tasks);
        }

        private async Task ReopenOnePersistedTabInBackgroundAsync(PersistedChatTab p, System.Threading.SemaphoreSlim gate)
        {
            await gate.WaitAsync();
            try
            {
                // Already open (a manual click beat the background reopen to it) or already
                // mid-preload (a duplicate persisted entry) — nothing to do.
                if (_chatTabs.Keys.Any(t => t.Tag is BoardChat c && c.ConversationId == p.ConversationId)) return;
                if (_reopenPreloadedWebViews.ContainsKey(p.ConversationId)) return;

                var chat = new BoardChat
                {
                    ConversationId = p.ConversationId,
                    Title = p.Title,
                    ClaudeUrl = p.ClaudeUrl,
                    EpicId = p.EpicId,
                    IssueGithubNumber = p.IssueGithubNumber,
                };

                var wv = BuildChatWebView(chat);
                var wrapped = CreateChatContextWrapper(wv);
                var host = new Border { Child = wrapped };
                ChatReopenPreloadHost.Children.Add(host);
                // Nonzero size + genuinely in the live visual tree is what actually creates
                // (and keeps alive) CoreWebView2 — Hidden/Collapsed or a zero size never
                // creates it at all. Same rule ParkOffscreen (MainWindow.PinnedTabs.cs) and
                // ClaudeWebView's own 1x1 declaration already depend on.
                host.Width = 1;
                host.Height = 1;
                Canvas.SetLeft(host, ReopenParkOffscreenX);
                Canvas.SetTop(host, ReopenParkOffscreenY);

                _reopenPreloadedWebViews[p.ConversationId] = wv;
                _reopenPreloadedWrappers[p.ConversationId] = wrapped;
                _reopenPreloadedHosts[p.ConversationId] = host;

                // The tab shows up in the strip right away (a real reopened tab, per the
                // issue) — just not focused. Its own placeholder WebView2 stays inert
                // (Loaded never fires for a non-selected TabItem's Content) until Shane
                // actually clicks it, at which point EditorTabs_SelectionChanged swaps in
                // the already-loading background one above via SwapInReopenPreload.
                OpenChatTab(chat, p.IssueGithubNumber, selectTab: false);

                // Bound the wait so one slow/broken chat can't hold the concurrency gate
                // (and thus the rest of the queue) open indefinitely — it keeps loading in
                // the background regardless, this is only how long THIS method waits before
                // letting the next persisted tab start.
                var tcs = new TaskCompletionSource<bool>();
                void OnCompleted(object? s, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e) => tcs.TrySetResult(e.IsSuccess);
                wv.NavigationCompleted += OnCompleted;
                try
                {
                    var finished = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(15)));
                    bool ok = finished == tcs.Task && tcs.Task.Result;
                    ActivityLog.Log(ChatReopenChannel, ok
                        ? $"Git #1887: reopened '{p.Title}' — ready"
                        : $"Git #1887: reopened '{p.Title}' — still loading past the 15s wait (continues in the background)");
                }
                finally
                {
                    wv.NavigationCompleted -= OnCompleted;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ChatReopenChannel, $"Git #1887: background reopen of '{p.Title}' failed: {ex.Message}");
            }
            finally
            {
                gate.Release();
            }
        }

        /// <summary>Removes and returns a still-parked background preload for the given conversation, if one exists. Used both by OpenChatTab (a manual open racing ahead of the preload) and SwapInReopenPreload.</summary>
        private bool TryTakeReopenPreload(string? conversationId, out Microsoft.Web.WebView2.Wpf.WebView2 wv, out FrameworkElement wrapped)
        {
            wv = null!;
            wrapped = null!;
            if (string.IsNullOrEmpty(conversationId)) return false;
            if (!_reopenPreloadedWebViews.TryGetValue(conversationId, out var pwv)) return false;
            if (!_reopenPreloadedWrappers.TryGetValue(conversationId, out var pwrapped)) return false;

            if (_reopenPreloadedHosts.TryGetValue(conversationId, out var host))
            {
                host.Child = null;
                ChatReopenPreloadHost.Children.Remove(host);
                _reopenPreloadedHosts.Remove(conversationId);
            }
            _reopenPreloadedWebViews.Remove(conversationId);
            _reopenPreloadedWrappers.Remove(conversationId);

            wv = pwv;
            wrapped = pwrapped;
            return true;
        }

        /// <summary>
        /// Called from EditorTabs_SelectionChanged the moment a placeholder reopened tab
        /// becomes selected. Swaps its inert, never-navigated placeholder WebView2 for the
        /// real one that's been loading in the background since RunDeferredStartupAsync, so
        /// the tab shows already-loaded content instead of starting a fresh navigation now.
        /// </summary>
        private void SwapInReopenPreload(TabItem tab, string conversationId)
        {
            _pendingReopenSwap.Remove(tab);
            if (!TryTakeReopenPreload(conversationId, out var preloadedWv, out var preloadedWrapped)) return;
            if (!_chatTabs.TryGetValue(tab, out var state)) return;

            var oldWv = state.WebView;
            var oldWrapped = state.SplitGrid.Children
                .Cast<UIElement>()
                .FirstOrDefault(c => Grid.GetColumn(c) == 0);
            if (oldWrapped != null) state.SplitGrid.Children.Remove(oldWrapped);

            Grid.SetColumn(preloadedWrapped, 0);
            state.SplitGrid.Children.Add(preloadedWrapped);
            state.WebView = preloadedWv;

            if (oldWv != null)
            {
                _contextMeters.Remove(oldWv);
                try { oldWv.Dispose(); } catch { }
            }

            ActivityLog.Log(ChatReopenChannel, $"Git #1887: swapped in background-loaded tab on selection ({conversationId})");
        }

        /// <summary>Drops any still-pending background reopen bookkeeping for a tab that's being closed — called from CloseTab. Without this, closing a placeholder tab before ever selecting it would leave its background WebView2 loaded and running forever, unreferenced by anything.</summary>
        private void CleanupPendingReopenSwap(TabItem tab)
        {
            if (!_pendingReopenSwap.TryGetValue(tab, out var conversationId)) return;
            _pendingReopenSwap.Remove(tab);
            if (TryTakeReopenPreload(conversationId, out var abandonedWv, out _))
            {
                _contextMeters.Remove(abandonedWv);
                try { abandonedWv.Dispose(); } catch { }
            }
        }
    }
}
