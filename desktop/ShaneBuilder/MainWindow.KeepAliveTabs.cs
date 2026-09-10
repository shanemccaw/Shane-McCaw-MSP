using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WpfWebView2 = Microsoft.Web.WebView2.Wpf.WebView2;

namespace ShaneBuilder;

/// <summary>
/// Git #2470 (phase 1 of Feature #2469 — Multi-Tab Lifecycle) — per-tab WebView2 instancing.
///
/// ShaneBuilder used to host ONE shared <c>ClaudeWebView</c> reused across every chat tab, so
/// opening a second chat tab (<see cref="OpenNewChatFlow"/>, #2323) only renavigated that single
/// view — switching tabs showed the SAME page in both (#2465). This gives every keep-alive tab its
/// own persistent <see cref="WpfWebView2"/> instead, parked off-screen (never torn down) when its
/// tab isn't active and reparented into <c>ChatWebViewHost</c> when it is.
///
/// This is a DIRECT PORT of the #972/#982 keep-alive mechanism proven in
/// <c>desktop/BuildConsole/MainWindow.ShelvedTabs.cs</c>, NOT a new mechanism:
/// <list type="bullet">
/// <item>Each view's real content lives in its own host <see cref="Border"/>, parked in
/// <c>KeepAliveHostCanvas</c> via <see cref="ParkOffscreen"/> — shrunk to 1×1 at
/// (-20000,-20000), never fully removed and never zero-sized.</item>
/// <item>The 1×1-not-zero detail is load-bearing: a WebView2 is an HwndHost whose surface only
/// reliably leaves view on a real SIZE change (z-order/visibility alone won't stop it painting),
/// and a true zero size can tear down <c>CoreWebView2</c> — so parking at 1×1 keeps the session
/// (login state, in-flight conversation) genuinely warm.</item>
/// <item>Restoring reparents the SAME live element back into the tab's mount point — reflow only,
/// never a reload/renavigate.</item>
/// </list>
///
/// Isolated in its own partial-class file (same pattern the BuildConsole feature uses) to stay out
/// of the way of the concurrently-edited <c>MainWindow.xaml.cs</c>.
/// </summary>
public partial class MainWindow
{
    /// <summary>Git #2470 — tab-type taxonomy. A <b>keep-alive</b> tab owns a persistent WebView2
    /// parked off-screen (never torn down) when inactive: claude.ai chats today, and — as the
    /// contract's taxonomy anticipates — Gemini/Google AI Studio, product websites, and Azure/M365
    /// Admin later. A <b>reloadable</b> tab (Git documents, filesystem documents, and every internal
    /// WPF dock: Home, Git Doctor, Repo Health, Log Viewer, Git Map, Settings, Markdown/Git-item
    /// viewers) gets no dedicated parked WebView2 and stays on the lightweight approach.</summary>
    private enum TabKeepAliveClass { Reloadable, KeepAlive }

    /// <summary>Git #2472 — the four real keep-alive families named in Feature #2469's taxonomy.
    /// Claude.ai is the only one with a real tab-opening entry point in ShaneBuilder today
    /// (OpenNewChatFlow, #2318/#2323); the other three have no in-app entry point yet (no menu,
    /// button or dialog opens any of them — confirmed by repo search, filed as a finding under
    /// #2469). <see cref="OpenKeepAliveBrowserTab"/> exists so whichever feature builds that real
    /// entry point (Web Shelf #2158, or a dedicated Azure/M365 Admin or product-site action) gets
    /// correct keep-alive classification and per-tab WebView2 instancing for free, instead of
    /// re-deriving it.</summary>
    internal enum BrowserTabCategory { ClaudeAi, GeminiAiStudio, ProductWebsite, AzureM365Admin }

    /// <summary>One keep-alive tab's own live WebView2, parked in <c>KeepAliveHostCanvas</c> when its
    /// tab isn't active and mounted into its real dock (<c>ChatWebViewHost</c> for a chat,
    /// <c>GenericBrowserWebViewHost</c> for the other three keep-alive categories — Git #2472) when
    /// it is.</summary>
    private sealed class KeepAliveView
    {
        public string TabId = "";
        public WpfWebView2 WebView = null!;
        public Border HostBorder = null!;      // parked 1×1 off-screen in KeepAliveHostCanvas
        public bool Mounted;                    // true when reparented into its real dock
        public string CurrentUrl = "https://claude.ai/";
        // Git #2472 — which real dock this view mounts into when shown. Set once at creation from
        // TabDef.IsChat; a tab's chat-vs-generic-browser nature never changes after it's opened.
        public bool IsChatTab;
    }

    // Every keep-alive tab's live view, keyed by TabDef.Id. Created lazily the first time the tab is
    // shown; disposed when the tab closes (DisposeKeepAliveView, from CloseTab).
    private readonly Dictionary<string, KeepAliveView> _keepAliveViews = new();

    // A keep-alive tab's initial URL, set by whoever opens it BEFORE SelectTab runs (OpenNewChatFlow
    // → claude.ai/new). Absent → the claude.ai root. Consumed once, at view creation.
    private readonly Dictionary<string, string> _keepAliveInitialUrl = new();

    /// <summary>The active keep-alive tab's live WebView2 — the single accessor every chat-context
    /// operation (send, DOM reads, activity poll, visibility toggles, navigation) now goes through,
    /// replacing the old shared <c>ClaudeWebView</c> field. Null when no keep-alive tab is active or
    /// its view hasn't finished creating yet.</summary>
    private WpfWebView2? ActiveChatWebView =>
        _activeChatTab != null && _keepAliveViews.TryGetValue(_activeChatTab.Id, out var v) ? v.WebView : null;

    /// <summary>#972/#982 keep-alive park, ported verbatim: shrink to 1×1 and move far off-screen so
    /// the HwndHost surface leaves view on a real SIZE change, while staying NONZERO so CoreWebView2
    /// is never torn down.</summary>
    private static void ParkOffscreen(FrameworkElement el)
    {
        el.Width = 1;
        el.Height = 1;
        el.HorizontalAlignment = HorizontalAlignment.Left;
        el.VerticalAlignment = VerticalAlignment.Top;
        Canvas.SetLeft(el, -20000);
        Canvas.SetTop(el, -20000);
        Canvas.SetZIndex(el, 0);
    }

    /// <summary>Resolve (and consume) the initial URL a keep-alive tab should load first.</summary>
    private string KeepAliveInitialUrl(TabDef tab)
    {
        if (_keepAliveInitialUrl.TryGetValue(tab.Id, out var url) && !string.IsNullOrWhiteSpace(url))
        {
            _keepAliveInitialUrl.Remove(tab.Id);
            return url;
        }
        // Git #2472 — no explicit initial URL was set before this tab's first show. Only the
        // original chat seed tab ("epic-1202", implicitly Claude.ai) relies on this fallback; every
        // OTHER keep-alive category MUST set _keepAliveInitialUrl itself (OpenKeepAliveBrowserTab
        // does) — silently defaulting a Gemini/product-site/Azure-Admin tab to claude.ai would show
        // the wrong site with no sign anything went wrong.
        if (tab.BrowserCategory is null or BrowserTabCategory.ClaudeAi) return "https://claude.ai/";
        Services.ConsoleOutputSink.Log(Services.LogLevel.Warn,
            $"[chat.keepalive] {tab.BrowserCategory} tab {tab.Id} has no initial URL set — falling back to about:blank");
        return "about:blank";
    }

    /// <summary>Git #2472 — the one generic entry point for opening ANY of the four real keep-alive
    /// categories as its own tab, with correct <see cref="TabKeepAliveClass.KeepAlive"/>
    /// classification and per-tab WebView2 instancing (the same mechanism #2470 gave Claude.ai
    /// chats) applied automatically. Whichever feature eventually opens a Gemini/AI Studio, product
    /// website, or Azure/M365 Admin tab (Web Shelf #2158, or a dedicated action) should call this
    /// rather than constructing a keep-alive <see cref="TabDef"/> by hand.</summary>
    private TabDef OpenKeepAliveBrowserTab(string idPrefix, string title, string url, BrowserTabCategory category, Brush? dot = null)
    {
        var tab = new TabDef(
            $"{idPrefix}-" + Guid.NewGuid().ToString("N"),
            title,
            dot: dot,
            keepAliveClass: TabKeepAliveClass.KeepAlive,
            browserCategory: category);
        _tabs.Add(tab);
        // Set BEFORE SelectTab, same rule OpenNewChatFlow follows — EnsureKeepAliveView must see
        // the real initial URL the first time it creates this tab's view, never a renavigation.
        _keepAliveInitialUrl[tab.Id] = url;
        SelectTab(tab.Id);
        Services.ConsoleOutputSink.Log(Services.LogLevel.Info, $"[chat.keepalive] opened {category} tab {tab.Id} -> {url}");
        return tab;
    }

    /// <summary>Ensure a keep-alive tab has its own live WebView2, created + wired + navigated to its
    /// initial URL exactly once. Idempotent — returns the existing view on every later call.</summary>
    private KeepAliveView EnsureKeepAliveView(TabDef tab)
    {
        if (_keepAliveViews.TryGetValue(tab.Id, out var existing)) return existing;

        string initialUrl = KeepAliveInitialUrl(tab);
        var wv = new WpfWebView2();
        var host = new Border { Child = wv };
        KeepAliveHostCanvas.Children.Add(host);
        ParkOffscreen(host);

        var kav = new KeepAliveView { TabId = tab.Id, WebView = wv, HostBorder = host, CurrentUrl = initialUrl, IsChatTab = tab.IsChat };
        _keepAliveViews[tab.Id] = kav;
        _ = WireKeepAliveViewAsync(kav, initialUrl);
        return kav;
    }

    /// <summary>Bring a keep-alive view's CoreWebView2 up, wire the per-tab bridges (URL tracking +
    /// the #2325 context-meter script and message pump, keyed to THIS tab so a parked tab's stats
    /// can never land under the active tab), then navigate it to its initial URL. Navigating after
    /// AddScriptToExecuteOnDocumentCreatedAsync guarantees the meter script runs on the very first
    /// document.</summary>
    private async Task WireKeepAliveViewAsync(KeepAliveView kav, string initialUrl)
    {
        try
        {
            await kav.WebView.EnsureCoreWebView2Async();
            var core = kav.WebView.CoreWebView2;
            if (core == null) return;

            string tabId = kav.TabId;
            kav.CurrentUrl = core.Source ?? kav.CurrentUrl;
            core.SourceChanged += (s, e) =>
            {
                kav.CurrentUrl = core.Source ?? kav.CurrentUrl;
                // Only the active tab's live URL drives the shared chrome (Share/Floaty/Detected).
                if (_activeChatTab?.Id == tabId) _currentConversationUrl = kav.CurrentUrl;
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(Services.ChatContextMeterScript.Script);
            core.WebMessageReceived += (s, e) => OnKeepAliveChatStats(tabId, e);

            try { kav.WebView.Source = new Uri(initialUrl); }
            catch (Exception navEx) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.keepalive] initial nav failed for {tabId}: {navEx.Message}"); }
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.keepalive] init failed for {kav.TabId}: {ex.Message}");
        }
    }

    /// <summary>Make <paramref name="tab"/>'s live view the one mounted in the chat dock and park
    /// every other keep-alive view 1×1 off-screen. This is what makes two open chat tabs show their
    /// OWN distinct live pages (the #2465 fix) — a plain reflow, never a reload. Called from
    /// SelectTab for any keep-alive tab.</summary>
    private void ShowKeepAliveTab(TabDef tab)
    {
        var kav = EnsureKeepAliveView(tab);

        foreach (var other in _keepAliveViews.Values)
            if (other.TabId != tab.Id) ParkKeepAliveView(other);

        MountKeepAliveView(kav);

        // The shared chrome keys on the active conversation's URL — sync it on the switch so
        // Share/Floaty/Detected reflect THIS tab immediately, not the previously-active one.
        _currentConversationUrl = kav.CurrentUrl;
    }

    /// <summary>Reparent a view into its real visible mount at full size — ChatWebViewHost for a
    /// chat tab, GenericBrowserWebViewHost (Git #2472) for the other three keep-alive categories.</summary>
    private void MountKeepAliveView(KeepAliveView kav)
    {
        Panel targetHost = kav.IsChatTab ? ChatWebViewHost : GenericBrowserWebViewHost;
        if (kav.Mounted && targetHost.Children.Contains(kav.HostBorder)) return;

        DetachHostBorder(kav.HostBorder);
        kav.HostBorder.Width = double.NaN;
        kav.HostBorder.Height = double.NaN;
        kav.HostBorder.HorizontalAlignment = HorizontalAlignment.Stretch;
        kav.HostBorder.VerticalAlignment = VerticalAlignment.Stretch;
        kav.HostBorder.Visibility = Visibility.Visible;
        targetHost.Children.Add(kav.HostBorder);
        kav.Mounted = true;
    }

    /// <summary>Park a view 1×1 off-screen in the keep-alive canvas — alive, out of view.</summary>
    private void ParkKeepAliveView(KeepAliveView kav)
    {
        if (!kav.Mounted && KeepAliveHostCanvas.Children.Contains(kav.HostBorder))
        {
            ParkOffscreen(kav.HostBorder);
            return;
        }
        DetachHostBorder(kav.HostBorder);
        kav.HostBorder.Visibility = Visibility.Visible; // parked, not hidden — the 1×1 size is what removes it from view
        KeepAliveHostCanvas.Children.Add(kav.HostBorder);
        ParkOffscreen(kav.HostBorder);
        kav.Mounted = false;
    }

    private static void DetachHostBorder(Border host)
    {
        switch (host.Parent)
        {
            case Panel p: p.Children.Remove(host); break;
            case Decorator d when ReferenceEquals(d.Child, host): d.Child = null; break;
        }
    }

    /// <summary>Navigate the ACTIVE keep-alive tab's own view (used by Start-new-chat, Archive, and
    /// Reopen — each renavigates the currently-active chat's live view, never a different tab's).
    /// A no-op with an honest log line when no keep-alive view is active.</summary>
    private void NavigateActiveChat(string url)
    {
        var v = ActiveChatWebView;
        if (v == null)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.keepalive] navigate skipped, no active chat view: {url}");
            return;
        }
        try { v.Source = new Uri(url); }
        catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.keepalive] navigate failed ({url}): {ex.Message}"); }
    }

    /// <summary>Toggle the active mounted chat view's own visibility — the airspace fix for the
    /// overlays (Command Palette / Filter Studio / Inspector) that must hide the live WebView2 while
    /// they're up, since an HwndHost always paints over WPF siblings regardless of Z-order. Parked
    /// views need no toggle: they're already 1×1 off-screen.</summary>
    private void SetActiveChatWebViewVisible(bool visible)
    {
        var v = ActiveChatWebView;
        if (v != null) v.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Tear down a keep-alive tab's live view when its tab actually closes — the session
    /// only stays warm while the tab lives (same lifecycle rule as the per-tab terminal sessions in
    /// CloseTab). Parking keeps it alive; closing disposes it for real.</summary>
    private void DisposeKeepAliveView(string tabId)
    {
        if (!_keepAliveViews.TryGetValue(tabId, out var kav)) return;
        try
        {
            DetachHostBorder(kav.HostBorder);
            kav.HostBorder.Child = null;
            kav.WebView.Dispose();
        }
        catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.keepalive] dispose failed for {tabId}: {ex.Message}"); }
        _keepAliveViews.Remove(tabId);
        _keepAliveInitialUrl.Remove(tabId);
    }
}
