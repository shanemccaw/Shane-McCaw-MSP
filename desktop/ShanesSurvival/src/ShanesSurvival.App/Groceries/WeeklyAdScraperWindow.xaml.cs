using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using ShanesSurvival.Core.Groceries;

namespace ShanesSurvival.App.Groceries;

/// <summary>
/// Real WPF WebView2 window for Git #3288 — navigates to Publix's real weekly-ad page, lets Shane
/// browse/confirm his store the same way he would in any real browser (no attempt to automate the
/// geo/store-picker itself — the same reasoning that kept <c>PlaidLinkWindow</c> a real interactive
/// window rather than a scripted bank login), then on "Extract &amp; Push Deals" reads the real
/// rendered DOM and pushes what it finds through shanes-life's own existing MCP pipeline
/// (push_deals/push_coupons, Git #3110) — no second, parallel storage path.
///
/// Real, honest maintenance note (from #3288's own issue body): Publix's ad-page layout can
/// change. <see cref="ExtractionScript"/>'s selectors were read directly off the real, live page
/// on 2026-09-08 (weekly-ad-card-grids / card-grid / savings-badge — see
/// desktop/ShanesSurvival/README.md's Weekly Ad section for how they were found); a layout
/// change means updating that script, not a bug in this window.
/// </summary>
public partial class WeeklyAdScraperWindow : Window
{
    private const string Store = "Publix";
    private const string WeeklyAdUrl = "https://www.publix.com/savings/weekly-ad/view-all";

    // Same reasoning as PlaidLinkWindow's own startup timeout — EnsureCoreWebView2Async gives no
    // cancellation, so this is a "stop waiting and tell Shane" backstop, not a real cancel.
    private static readonly TimeSpan WebViewStartupTimeout = TimeSpan.FromSeconds(20);

    // Bounded poll for the real ad grid to actually be populated after Extract is clicked — the
    // grid can still be mid-render even after Shane judges the page "loaded" by eye. Bounded per
    // CLAUDE.md's wait discipline: a few real attempts, then report honestly rather than hang.
    private static readonly TimeSpan ExtractionPollTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan ExtractionPollInterval = TimeSpan.FromSeconds(1);

    private readonly ShanesLifeMcpClient _mcpClient = new();
    private readonly WeeklyAdCredentials _credentials;

    public WeeklyAdScraperWindow(WeeklyAdCredentials credentials)
    {
        InitializeComponent();
        _credentials = credentials;
        StoreNameText.Text = Store;
        Loaded += async (_, _) => await InitializeWebViewAsync();
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
                _ = startupTask.ContinueWith(t => _ = t.Exception, TaskScheduler.Default);
                SetStatus(
                    $"The browser control didn't start within {WebViewStartupTimeout.TotalSeconds:0}s. " +
                    "This usually means the Microsoft Edge WebView2 Runtime isn't installed " +
                    "(https://developer.microsoft.com/microsoft-edge/webview2/).",
                    isError: true);
                return;
            }

            await startupTask;
        }
        catch (Exception ex)
        {
            SetStatus($"Could not start the browser control: {ex.Message}", isError: true);
        }
    }

    private async Task StartWebViewAsync()
    {
        // Deliberately persistent (unlike PlaidLinkWindow's ephemeral per-session temp folder) —
        // the whole point is that Shane's real store selection on publix.com sticks across runs
        // instead of re-prompting every single time.
        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ShanesSurvival", "WebView2WeeklyAd");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await AdWebView.EnsureCoreWebView2Async(environment);

        AdWebView.CoreWebView2.NavigationCompleted += (_, e) =>
        {
            SetStatus(e.IsSuccess
                ? "Page loaded. Confirm your store if asked, wait for the ad to render, then click Extract."
                : $"Navigation did not complete cleanly (error {e.WebErrorStatus}). You can still try Reload.");
        };

        AdWebView.CoreWebView2.Navigate(WeeklyAdUrl);
    }

    private async void ExtractButton_Click(object sender, RoutedEventArgs e)
    {
        await ExtractAndPushAsync();
    }

    private void ReloadButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            AdWebView.CoreWebView2?.Navigate(WeeklyAdUrl);
            SetStatus("Reloading…");
        }
        catch (Exception ex)
        {
            SetStatus($"Could not reload: {ex.Message}", isError: true);
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private async Task ExtractAndPushAsync()
    {
        if (AdWebView.CoreWebView2 is null)
        {
            SetStatus("The browser hasn't finished starting yet.", isError: true);
            return;
        }
        if (!_credentials.IsConfigured)
        {
            SetStatus("No Shane's Life API URL / MCP token configured. Open Settings to add them.", isError: true);
            return;
        }

        ExtractButton.IsEnabled = false;
        SetStatus("Reading the real rendered page…");

        try
        {
            var cards = await PollForCardsAsync();
            if (cards is null)
            {
                SetStatus(
                    $"No ad content found after waiting {ExtractionPollTimeout.TotalSeconds:0}s — the page may " +
                    "still be loading, may need a store confirmed first, or its layout may have changed. " +
                    "Try again once the ad visibly shows real items.",
                    isError: true);
                return;
            }
            if (cards.Count == 0)
            {
                SetStatus("The ad grid was found but had no items in it.", isError: true);
                return;
            }

            var (deals, coupons, skipped) = PublixAdParser.Parse(
                cards, Store, DateOnly.FromDateTime(DateTime.Today));

            var dealsPushed = await _mcpClient.PushDealsAsync(_credentials, Store, deals);
            var couponsPushed = await _mcpClient.PushCouponsAsync(_credentials, Store, coupons);

            var summary =
                $"Read {cards.Count} card(s). Pushed {dealsPushed} deal(s) and {couponsPushed} coupon(s) to Shopping.";
            if (skipped.Count > 0)
            {
                var preview = string.Join("; ", skipped.Take(5));
                summary += $" Skipped {skipped.Count} card(s) that didn't parse: {preview}" +
                    (skipped.Count > 5 ? "; …" : string.Empty);
            }
            SetStatus(summary, isError: false);
        }
        catch (ShanesLifeMcpException ex)
        {
            SetStatus($"Pushed nothing — {ex.Message}", isError: true);
        }
        catch (Exception ex)
        {
            // Never let an escaped exception from an async void event handler crash the process —
            // same rule every other window in this app follows.
            SetStatus($"Unexpected error extracting/pushing deals: {ex.Message}", isError: true);
        }
        finally
        {
            ExtractButton.IsEnabled = true;
        }
    }

    /// <summary>
    /// Bounded poll (real attempts + a real timeout, not an indefinite wait — CLAUDE.md's wait
    /// discipline) for the ad grid to actually contain cards. Returns null if it never did.
    /// </summary>
    private async Task<List<RawAdCard>?> PollForCardsAsync()
    {
        var deadline = DateTime.UtcNow + ExtractionPollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            var result = await RunExtractionScriptAsync();
            if (result is { Ready: true, Cards.Count: > 0 })
            {
                return result.Cards;
            }
            await Task.Delay(ExtractionPollInterval);
        }
        return null;
    }

    private async Task<ExtractionResult?> RunExtractionScriptAsync()
    {
        var raw = await AdWebView.CoreWebView2.ExecuteScriptAsync(ExtractionScript);
        // ExecuteScriptAsync's own return value is itself a JSON-encoded string of whatever the
        // script expression evaluated to — the script returns JSON.stringify(...) already, so
        // this is JSON-encoded-JSON and needs one extra unwrap before the real payload parses.
        if (string.IsNullOrWhiteSpace(raw) || raw == "null") return null;
        var jsonText = JsonSerializer.Deserialize<string>(raw);
        if (string.IsNullOrWhiteSpace(jsonText)) return null;
        return JsonSerializer.Deserialize<ExtractionResult>(jsonText, JsonOptions);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private void SetStatus(string message, bool isError = false)
    {
        StatusText.Text = message;
        StatusText.Foreground = isError ? Brushes.DarkRed : (Brush)FindResource("SecondaryTextBrush");
    }

    // Real selectors read directly off publix.com/savings/weekly-ad/view-all's own rendered DOM,
    // 2026-09-08 (see README's Weekly Ad section). Falls back from the specific container to the
    // bare .card-grid class if Publix ever drops the outer wrapper without renaming the grid
    // itself. Deliberately returns raw per-card text rather than trying to parse price/title in
    // JS — PublixAdParser (C#, unit-testable) owns all of that so a parsing fix never needs a
    // WebView2 session to test.
    private const string ExtractionScript = """
        (function () {
          var container = document.querySelector('.weekly-ad-card-grids .card-grid')
            || document.querySelector('.card-grid');
          if (!container) { return JSON.stringify({ ready: false, cards: [] }); }
          var cards = Array.prototype.slice.call(container.children);
          var results = cards.map(function (el) {
            var badgeEl = el.querySelector('.savings-badge');
            var badgeText = badgeEl ? badgeEl.innerText.trim() : null;
            var imgEl = el.querySelector('img[alt]');
            var title = imgEl ? imgEl.getAttribute('alt') : null;
            // Real product thumbnail (Git #3310) -- the same <img> element the title already
            // comes from. `src` over `currentSrc`/srcset: the plain attribute is what a lazy-load
            // placeholder swaps into once the real image has actually loaded, which is the same
            // moment this card's real text content is present too.
            var imageUrl = imgEl ? imgEl.getAttribute('src') : null;
            if (!title) {
              var heading = el.querySelector('h1,h2,h3,h4,h5,h6,[class*="title" i],[class*="name" i]');
              title = heading ? heading.innerText.trim() : null;
            }
            var fullText = el.innerText || '';
            if (!title) {
              var lines = fullText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
              title = lines.length ? lines[0] : null;
            }
            return { title: title, priceText: fullText, badgeText: badgeText, imageUrl: imageUrl };
          });
          return JSON.stringify({ ready: true, cards: results });
        })()
        """;

    private sealed class ExtractionResult
    {
        [JsonPropertyName("ready")]
        public bool Ready { get; set; }

        [JsonPropertyName("cards")]
        public List<RawAdCard> Cards { get; set; } = [];
    }
}
