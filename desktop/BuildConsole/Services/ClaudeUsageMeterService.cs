using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    public enum ClaudeUsageMeterState
    {
        /// <summary>Between polls with a good last reading — the number shown is real.</summary>
        Ok,
        /// <summary>Actively polling Anthropic OAuth usage API right now.</summary>
        Polling,
        /// <summary>Usage could not be read (not logged in, or token expired) — show a muted "Claude: --" rather than a stale/guessed number.</summary>
        Unavailable,
        /// <summary>Check threw or failed.</summary>
        Error,
    }

    /// <summary>A status snapshot pushed to whoever renders the indicator (the MainWindow status bar). DisplayText/ToolTip are fully computed here so the UI just renders them.</summary>
    public class ClaudeUsageStatus
    {
        public ClaudeUsageMeterState State { get; set; } = ClaudeUsageMeterState.Unavailable;
        /// <summary>Whole-number usage percentage (0–100), or null when it couldn't be read.</summary>
        public int? Percent { get; set; }
        /// <summary>The next reset moment as a LOCAL datetime, parsed from the API resets_at timestamp, or null when unavailable.</summary>
        public DateTime? ResetTarget { get; set; }
        /// <summary>Fully-formed status-bar text, e.g. "Claude: 87% used — resets in 1d 4h 12m", "Claude: 45% used", or "Claude: --".</summary>
        public string DisplayText { get; set; } = "Claude: --";
        public string ToolTip { get; set; } = string.Empty;

        // Weekly (All Models) status fields — Primary account
        public int? WeeklyPercent { get; set; }
        public DateTime? WeeklyResetTarget { get; set; }
        public string WeeklyDisplayText { get; set; } = "Claude Weekly (Primary): --";
        public string WeeklyToolTip { get; set; } = string.Empty;

        public DateTime? LastPoll { get; set; }

        // Weekly (All Models) status fields — Secondary account
        public bool SecondaryConfigured { get; set; }
        public ClaudeUsageMeterState SecondaryState { get; set; } = ClaudeUsageMeterState.Unavailable;
        public int? SecondaryWeeklyPercent { get; set; }
        public DateTime? SecondaryWeeklyResetTarget { get; set; }
        public string SecondaryWeeklyDisplayText { get; set; } = "Claude Weekly (Secondary): --";
        public string SecondaryWeeklyToolTip { get; set; } = string.Empty;
        public DateTime? SecondaryLastPoll { get; set; }
    }

    /// <summary>
    /// Background watcher that polls Anthropic's OAuth usage API endpoint directly using
    /// the bearer token from ~/.claude/.credentials.json (and SecondaryClaudeConfigDir/.credentials.json).
    ///
    /// Endpoint: GET https://api.anthropic.com/api/oauth/usage
    /// Headers: Authorization: Bearer &lt;accessToken&gt;, anthropic-beta: oauth-2025-04-20
    ///
    /// Logging channel: "usage-meter" via ActivityLog.Log.
    /// </summary>
    public class ClaudeUsageMeterService
    {
        public const string Channel = "usage-meter";
        public const string UsageApiEndpoint = "https://api.anthropic.com/api/oauth/usage";

        /// <summary>Poll cadence for automatic background usage checks.</summary>
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

        /// <summary>How often the visible countdown re-renders between polls. Only the text ticks; the percentage is untouched until the next real poll.</summary>
        private static readonly TimeSpan DisplayTickInterval = TimeSpan.FromSeconds(30);

        /// <summary>At/above this usage the countdown is shown alongside the percentage; below it, just the plain percentage.</summary>
        private const int CountdownThresholdPercent = 85;

        private static readonly HttpClient _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(15)
        };

        private static bool _primaryLoggedRawJson = false;
        private static bool _secondaryLoggedRawJson = false;

        private readonly DispatcherTimer _pollTimer;
        private readonly DispatcherTimer _displayTimer;

        private bool _busy;
        private int? _percent;
        private DateTime? _resetTarget;
        private DateTime? _lastPoll;
        private ClaudeUsageMeterState _lastState = ClaudeUsageMeterState.Unavailable;

        private int? _weeklyPercent;
        private DateTime? _weeklyResetTarget;
        private DateTime? _weeklyProjectedFullTarget;
        private double _weeklyProjectedRatePerHour;

        // ── projected "time until 100%" (real observed growth rate, current window only) ──
        private DateTime? _projectedFullTarget;
        private double _projectedRatePerHour;

        // ── Retry-After back-off (honor 429 rather than hammer the endpoint) ──
        // When the usage API returns 429 with a Retry-After, we defer the next poll for
        // that account until this moment instead of re-polling on the fixed cadence.
        private DateTime? _primaryBackoffUntil;
        private DateTime? _secondaryBackoffUntil;
        // Floor applied when a 429 carries no Retry-After header.
        private static readonly TimeSpan DefaultRateLimitBackoff = TimeSpan.FromMinutes(1);

        // Secondary account weekly status fields
        private bool _secondaryConfigured;
        private ClaudeUsageMeterState _secondaryLastState = ClaudeUsageMeterState.Unavailable;
        private string? _secondaryLastReason;
        private int? _secondaryWeeklyPercent;
        private DateTime? _secondaryWeeklyResetTarget;
        private DateTime? _secondaryWeeklyProjectedFullTarget;
        private double _secondaryWeeklyProjectedRatePerHour;
        private DateTime? _secondaryLastPoll;

        public event Action<ClaudeUsageStatus>? StatusChanged;

        /// <summary>
        /// Constructor parameters maintained for backwards compatibility with callers passing WebView2 probe hooks.
        /// </summary>
        public ClaudeUsageMeterService(WebView2? webView = null, Func<WebView2, Task<bool>>? ensureInitialized = null)
        {
            _pollTimer = new DispatcherTimer { Interval = PollInterval };
            _pollTimer.Tick += async (_, _) => await TickAsync();

            _displayTimer = new DispatcherTimer(DispatcherPriority.Background) { Interval = DisplayTickInterval };
            _displayTimer.Tick += (_, _) => OnDisplayTick();
        }

        /// <summary>Starts the poll + display timers and fires the first poll immediately.</summary>
        public void Start()
        {
            _pollTimer.Start();
            _displayTimer.Start();
            Emit(ClaudeUsageMeterState.Polling);
            ActivityLog.Log(Channel, $"Started — polling Claude OAuth usage API every {PollInterval.TotalMinutes:0} min; countdown shown at ≥{CountdownThresholdPercent}%.");
            _ = TickAsync();
        }

        public void Stop()
        {
            _pollTimer.Stop();
            _displayTimer.Stop();
        }

        /// <summary>Manual on-demand poll, e.g. the status bar's refresh icon.</summary>
        public async Task ManualRefreshAsync()
        {
            if (_busy)
            {
                ActivityLog.Log(Channel, "Manual refresh requested — ignored, a poll is already in flight.");
                return;
            }
            ActivityLog.Log(Channel, "Manual refresh requested (status bar refresh icon) — clearing any Retry-After back-off to force a fresh poll.");
            _primaryBackoffUntil = null;
            _secondaryBackoffUntil = null;
            await TickAsync();
        }

        /// <summary>One real poll: calls Anthropic OAuth usage API for both Primary and Secondary accounts.</summary>
        private async Task TickAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                Emit(ClaudeUsageMeterState.Polling);

                // Poll Secondary account independently
                await PollSecondaryAsync();

                // Poll Primary account — honor any active Retry-After back-off rather than hammering a throttled endpoint.
                if (_primaryBackoffUntil.HasValue && DateTime.Now < _primaryBackoffUntil.Value)
                {
                    ActivityLog.Log(Channel, $"Skipping primary poll — honoring Retry-After, backing off until {_primaryBackoffUntil.Value:HH:mm:ss}; keeping last reading.");
                    Emit((_percent.HasValue || _weeklyPercent.HasValue) ? ClaudeUsageMeterState.Ok : ClaudeUsageMeterState.Unavailable);
                    return;
                }

                string primaryDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");
                var res = await PollAccountViaApiAsync(primaryDir, isSecondary: false);

                if (res.success)
                {
                    _primaryBackoffUntil = null;
                    _percent = res.sessionPercent;
                    _resetTarget = res.sessionReset;
                    _weeklyPercent = res.weeklyPercent;
                    _weeklyResetTarget = res.weeklyReset;
                    _lastPoll = DateTime.Now;

                    ActivityLog.Log(Channel,
                        $"OK[api] — Session: {(_percent.HasValue ? _percent.Value + "%" : "--")} (reset target={(_resetTarget.HasValue ? _resetTarget.Value.ToString("ddd HH:mm") : "none")}), " +
                        $"Weekly: {(_weeklyPercent.HasValue ? _weeklyPercent.Value + "%" : "--")} (reset target={(_weeklyResetTarget.HasValue ? _weeklyResetTarget.Value.ToString("ddd HH:mm") : "none")}).");

                    if (_percent.HasValue)
                        UpdateProjection(_percent.Value, _resetTarget, _lastPoll.Value);
                    if (_weeklyPercent.HasValue)
                        UpdateWeeklyProjection(_weeklyPercent.Value, _weeklyResetTarget, _lastPoll.Value);

                    Emit(ClaudeUsageMeterState.Ok);
                }
                else if (res.rateLimited)
                {
                    // 429: set back-off and keep the last good reading on screen rather than clearing to an error.
                    _primaryBackoffUntil = DateTime.Now + (res.retryAfter ?? DefaultRateLimitBackoff);
                    ActivityLog.Log(Channel, $"Primary rate limited (429); backing off until {_primaryBackoffUntil.Value:HH:mm:ss}, keeping last reading.");
                    Emit((_percent.HasValue || _weeklyPercent.HasValue) ? ClaudeUsageMeterState.Ok : ClaudeUsageMeterState.Unavailable);
                }
                else
                {
                    var state = res.notSignedIn ? ClaudeUsageMeterState.Unavailable : ClaudeUsageMeterState.Error;
                    SetUnavailable(res.error ?? "poll failed", state);
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Poll threw: {ex.Message}");
                SetUnavailable(ex.Message, ClaudeUsageMeterState.Error);
            }
            finally
            {
                _busy = false;
            }
        }

        /// <summary>Fast between-poll tick: updates live countdown text without re-polling.</summary>
        private void OnDisplayTick()
        {
            bool primaryTickNeeded = _lastState == ClaudeUsageMeterState.Ok &&
                (((_percent.HasValue && _percent.Value >= CountdownThresholdPercent && _resetTarget.HasValue) ||
                  (_weeklyPercent.HasValue && _weeklyPercent.Value >= CountdownThresholdPercent && _weeklyResetTarget.HasValue)) ||
                 _projectedFullTarget.HasValue || _weeklyProjectedFullTarget.HasValue);

            bool secondaryTickNeeded = _secondaryLastState == ClaudeUsageMeterState.Ok &&
                ((_secondaryWeeklyPercent.HasValue && _secondaryWeeklyPercent.Value >= CountdownThresholdPercent && _secondaryWeeklyResetTarget.HasValue) ||
                 _secondaryWeeklyProjectedFullTarget.HasValue);

            if (primaryTickNeeded || secondaryTickNeeded)
                Emit(_lastState);
        }

        private void SetUnavailable(string reason, ClaudeUsageMeterState state = ClaudeUsageMeterState.Unavailable)
        {
            _percent = null;
            _resetTarget = null;
            _projectedFullTarget = null;
            _projectedRatePerHour = 0;
            _weeklyPercent = null;
            _weeklyResetTarget = null;
            _weeklyProjectedFullTarget = null;
            _weeklyProjectedRatePerHour = 0;
            Emit(state, reason);
        }

        // ── OAuth API Execution & Parsing ────────────────────────────────────

        /// <summary>Expand a leading `~` in a configured path to the user's profile directory.</summary>
        private static string ExpandUserPath(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return "";
            path = path.Trim();
            if (path == "~" || path.StartsWith("~/") || path.StartsWith("~\\"))
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string rest = path.Length <= 1 ? "" : path.Substring(2);
                return string.IsNullOrEmpty(rest) ? home : Path.Combine(home, rest);
            }
            return path;
        }

        internal static string? ReadAccessToken(string configDir)
        {
            try
            {
                string credentialsPath = Path.Combine(configDir, ".credentials.json");
                if (!File.Exists(credentialsPath)) return null;

                string json = File.ReadAllText(credentialsPath);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.TryGetProperty("claudeAiOauth", out var oauthEl) ||
                    root.TryGetProperty("claude_ai_oauth", out oauthEl))
                {
                    if (oauthEl.TryGetProperty("accessToken", out var tokenEl) ||
                        oauthEl.TryGetProperty("access_token", out tokenEl))
                    {
                        string? token = tokenEl.GetString();
                        if (!string.IsNullOrWhiteSpace(token)) return token.Trim();
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Failed to read credentials from {configDir}: {ex.Message}");
            }
            return null;
        }

        private struct ApiPollResult
        {
            public bool success;
            public bool notSignedIn;
            public bool rateLimited;
            public TimeSpan? retryAfter;
            public string? rawJson;
            public int? sessionPercent;
            public DateTime? sessionReset;
            public int? weeklyPercent;
            public DateTime? weeklyReset;
            public string? error;
        }

        private async Task<ApiPollResult> PollAccountViaApiAsync(string configDir, bool isSecondary)
        {
            string accountLabel = isSecondary ? "[secondary] " : "";
            string? token = ReadAccessToken(configDir);

            if (string.IsNullOrEmpty(token))
            {
                ActivityLog.Log(Channel, $"{accountLabel}Credentials file missing or lacks accessToken at {configDir}");
                return new ApiPollResult { success = false, notSignedIn = true, error = "not signed in" };
            }

            var (status, jsonText, error, retryAfter) = await ExecuteApiRequestAsync(token);

            // 401 / 403 handling: re-read credentials file once; if token changed, retry once.
            if (status == HttpStatusCode.Unauthorized || status == HttpStatusCode.Forbidden)
            {
                ActivityLog.Log(Channel, $"{accountLabel}Received {status} from usage API; checking if token was refreshed...");
                string? newToken = ReadAccessToken(configDir);
                if (!string.IsNullOrEmpty(newToken) && newToken != token)
                {
                    ActivityLog.Log(Channel, $"{accountLabel}Token changed on disk; retrying API call with refreshed token.");
                    (status, jsonText, error, retryAfter) = await ExecuteApiRequestAsync(newToken);
                }
            }

            if (status == HttpStatusCode.TooManyRequests)
            {
                ActivityLog.Log(Channel, $"{accountLabel}Usage API rate limited (429). Retry-After: {retryAfter?.ToString() ?? "unspecified"}.");
                return new ApiPollResult { success = false, notSignedIn = false, rateLimited = true, retryAfter = retryAfter, error = "rate limited (429)" };
            }

            if (status == HttpStatusCode.Unauthorized || status == HttpStatusCode.Forbidden)
            {
                ActivityLog.Log(Channel, $"{accountLabel}Usage API authentication failed ({status}).");
                return new ApiPollResult { success = false, notSignedIn = true, error = "session expired / sign in to Claude Code" };
            }

            if (status != HttpStatusCode.OK || string.IsNullOrWhiteSpace(jsonText))
            {
                ActivityLog.Log(Channel, $"{accountLabel}Usage API returned error: {error ?? status.ToString()}");
                return new ApiPollResult { success = false, notSignedIn = false, error = error ?? $"HTTP {(int)status}" };
            }

            // Log full raw JSON payload once on first successful poll
            if (!isSecondary && !_primaryLoggedRawJson)
            {
                _primaryLoggedRawJson = true;
                ActivityLog.Log(Channel, $"Primary raw JSON response: {jsonText}");
            }
            else if (isSecondary && !_secondaryLoggedRawJson)
            {
                _secondaryLoggedRawJson = true;
                ActivityLog.Log(Channel, $"[secondary] Secondary raw JSON response: {jsonText}");
            }

            var (sessionPercent, sessionReset, weeklyPercent, weeklyReset) = ParseOAuthUsageJson(jsonText);
            return new ApiPollResult
            {
                success = true,
                rawJson = jsonText,
                sessionPercent = sessionPercent,
                sessionReset = sessionReset,
                weeklyPercent = weeklyPercent,
                weeklyReset = weeklyReset
            };
        }

        private static async Task<(HttpStatusCode status, string? body, string? error, TimeSpan? retryAfter)> ExecuteApiRequestAsync(string accessToken)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, UsageApiEndpoint);
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                request.Headers.Add("anthropic-beta", "oauth-2025-04-20");
                request.Headers.UserAgent.ParseAdd("BuildConsole/1.0");

                using var response = await _httpClient.SendAsync(request);
                string body = await response.Content.ReadAsStringAsync();

                TimeSpan? retryAfter = null;
                if (response.Headers.RetryAfter != null)
                {
                    retryAfter = response.Headers.RetryAfter.Delta ?? (response.Headers.RetryAfter.Date.HasValue ? response.Headers.RetryAfter.Date.Value - DateTimeOffset.Now : null);
                }

                if (response.IsSuccessStatusCode)
                {
                    return (response.StatusCode, body, null, retryAfter);
                }
                return (response.StatusCode, null, $"HTTP {(int)response.StatusCode}: {Trim(body)}", retryAfter);
            }
            catch (Exception ex)
            {
                return (HttpStatusCode.InternalServerError, null, ex.Message, null);
            }
        }

        internal static (int? sessionPercent, DateTime? sessionReset, int? weeklyPercent, DateTime? weeklyReset) ParseOAuthUsageJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return (null, null, null, null);

            int? sessionPercent = null;
            DateTime? sessionReset = null;
            int? weeklyPercent = null;
            DateTime? weeklyReset = null;

            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                // 1. Top-level object keys: "five_hour" (Session) and "seven_day" (Weekly)
                if (root.TryGetProperty("five_hour", out var fiveHour) && fiveHour.ValueKind == JsonValueKind.Object)
                {
                    if (fiveHour.TryGetProperty("utilization", out var util) && util.ValueKind == JsonValueKind.Number)
                    {
                        sessionPercent = Clamp(util.GetDouble());
                    }
                    if (fiveHour.TryGetProperty("resets_at", out var resetsAt) && resetsAt.ValueKind == JsonValueKind.String)
                    {
                        sessionReset = ParseIsoTimestamp(resetsAt.GetString());
                    }
                }

                if (root.TryGetProperty("seven_day", out var sevenDay) && sevenDay.ValueKind == JsonValueKind.Object)
                {
                    if (sevenDay.TryGetProperty("utilization", out var util) && util.ValueKind == JsonValueKind.Number)
                    {
                        weeklyPercent = Clamp(util.GetDouble());
                    }
                    if (sevenDay.TryGetProperty("resets_at", out var resetsAt) && resetsAt.ValueKind == JsonValueKind.String)
                    {
                        weeklyReset = ParseIsoTimestamp(resetsAt.GetString());
                    }
                }

                // 2. Fallback / supplementary check via "limits" array if top-level fields were missing
                if (root.TryGetProperty("limits", out var limits) && limits.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in limits.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.Object) continue;

                        string kind = item.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? (k.GetString() ?? "") : "";
                        string group = item.TryGetProperty("group", out var g) && g.ValueKind == JsonValueKind.String ? (g.GetString() ?? "") : "";

                        int? pct = null;
                        if (item.TryGetProperty("percent", out var pVal) && pVal.ValueKind == JsonValueKind.Number)
                        {
                            pct = Clamp(pVal.GetDouble());
                        }
                        else if (item.TryGetProperty("utilization", out var uVal) && uVal.ValueKind == JsonValueKind.Number)
                        {
                            pct = Clamp(uVal.GetDouble());
                        }

                        DateTime? reset = null;
                        if (item.TryGetProperty("resets_at", out var rVal) && rVal.ValueKind == JsonValueKind.String)
                        {
                            reset = ParseIsoTimestamp(rVal.GetString());
                        }

                        if ((kind.Equals("session", StringComparison.OrdinalIgnoreCase) || group.Equals("session", StringComparison.OrdinalIgnoreCase)) && pct.HasValue)
                        {
                            sessionPercent ??= pct;
                            sessionReset ??= reset;
                        }
                        else if ((kind.Equals("weekly_all", StringComparison.OrdinalIgnoreCase) || group.Equals("weekly", StringComparison.OrdinalIgnoreCase)) && pct.HasValue)
                        {
                            weeklyPercent ??= pct;
                            weeklyReset ??= reset;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Failed to parse OAuth usage JSON: {ex.Message}");
            }

            return (sessionPercent, sessionReset, weeklyPercent, weeklyReset);
        }

        internal static DateTime? ParseIsoTimestamp(string? isoString)
        {
            if (string.IsNullOrWhiteSpace(isoString)) return null;
            if (DateTimeOffset.TryParse(isoString, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var dto))
            {
                return dto.LocalDateTime;
            }
            return null;
        }

        // ── time-until-100% projection ──────────────────────────────────────

        private void UpdateProjection(int percent, DateTime? resetTarget, DateTime pollMoment)
        {
            try
            {
                var sample = new UsageSample { At = pollMoment, Percent = percent, ResetTarget = resetTarget };
                bool stored = UsageHistoryStore.Append(sample);
                ActivityLog.Log(Channel,
                    $"data-point {(stored ? "stored" : "NOT stored")}: {percent}% at {pollMoment:yyyy-MM-dd HH:mm:ss}"
                    + (resetTarget.HasValue ? $" (reset target {resetTarget.Value:ddd HH:mm})" : " (reset target none)") + ".");

                var projection = UsageProjection.Compute(UsageHistoryStore.ReadAll(), pollMoment);
                if (projection.HasProjection && projection.TimeTo100.HasValue)
                {
                    _projectedFullTarget = pollMoment + projection.TimeTo100.Value;
                    _projectedRatePerHour = projection.RatePerHour;
                    ActivityLog.Log(Channel,
                        $"projection: ~{FormatCountdown(projection.TimeTo100.Value)} to 100% "
                        + $"(rate {projection.RatePerHour:0.00}%/hr over {projection.WindowSampleCount} current-window points; "
                        + $"projected 100% at {_projectedFullTarget.Value:ddd yyyy-MM-dd HH:mm}).");
                }
                else
                {
                    _projectedFullTarget = null;
                    _projectedRatePerHour = 0;
                    ActivityLog.Log(Channel, $"projection withheld: {projection.Reason}.");
                }
            }
            catch (Exception ex)
            {
                _projectedFullTarget = null;
                _projectedRatePerHour = 0;
                ActivityLog.Log(Channel, $"projection update failed: {ex.Message}");
            }
        }

        private void UpdateWeeklyProjection(int percent, DateTime? resetTarget, DateTime pollMoment)
        {
            try
            {
                var sample = new UsageSample { At = pollMoment, Percent = percent, ResetTarget = resetTarget };
                bool stored = WeeklyUsageHistoryStore.Append(sample);
                ActivityLog.Log(Channel,
                    $"weekly data-point {(stored ? "stored" : "NOT stored")}: {percent}% at {pollMoment:yyyy-MM-dd HH:mm:ss}"
                    + (resetTarget.HasValue ? $" (weekly reset target {resetTarget.Value:ddd HH:mm})" : " (weekly reset target none)") + ".");

                var projection = UsageProjection.Compute(WeeklyUsageHistoryStore.ReadAll(), pollMoment);
                if (projection.HasProjection && projection.TimeTo100.HasValue)
                {
                    _weeklyProjectedFullTarget = pollMoment + projection.TimeTo100.Value;
                    _weeklyProjectedRatePerHour = projection.RatePerHour;
                    ActivityLog.Log(Channel,
                        $"weekly projection: ~{FormatCountdown(projection.TimeTo100.Value)} to 100% "
                        + $"(weekly rate {projection.RatePerHour:0.00}%/hr over {projection.WindowSampleCount} current-window points; "
                        + $"weekly projected 100% at {_weeklyProjectedFullTarget.Value:ddd yyyy-MM-dd HH:mm}).");
                }
                else
                {
                    _weeklyProjectedFullTarget = null;
                    _weeklyProjectedRatePerHour = 0;
                    ActivityLog.Log(Channel, $"weekly projection withheld: {projection.Reason}.");
                }
            }
            catch (Exception ex)
            {
                _weeklyProjectedFullTarget = null;
                _weeklyProjectedRatePerHour = 0;
                ActivityLog.Log(Channel, $"weekly projection update failed: {ex.Message}");
            }
        }

        // ── Secondary account poll ──────────────────────────────────────────

        private async Task PollSecondaryAsync()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                string secondaryDir = ExpandUserPath(settings.SecondaryClaudeConfigDir);
                _secondaryConfigured = !string.IsNullOrWhiteSpace(secondaryDir);

                if (!_secondaryConfigured)
                {
                    ActivityLog.Log(Channel, "[secondary] SecondaryClaudeConfigDir is unset/blank — showing 'not configured'.");
                    SetSecondaryUnavailable("not configured");
                    return;
                }

                if (!Directory.Exists(secondaryDir))
                {
                    ActivityLog.Log(Channel, $"[secondary] Config dir does not exist: {secondaryDir}");
                    SetSecondaryUnavailable("config dir not found");
                    return;
                }

                // Honor any active Retry-After back-off rather than hammering a throttled endpoint.
                if (_secondaryBackoffUntil.HasValue && DateTime.Now < _secondaryBackoffUntil.Value)
                {
                    ActivityLog.Log(Channel, $"[secondary] Skipping poll — honoring Retry-After, backing off until {_secondaryBackoffUntil.Value:HH:mm:ss}; keeping last reading.");
                    return;
                }

                var res = await PollAccountViaApiAsync(secondaryDir, isSecondary: true);
                if (res.success)
                {
                    _secondaryBackoffUntil = null;
                    _secondaryWeeklyPercent = res.weeklyPercent;
                    _secondaryWeeklyResetTarget = res.weeklyReset;
                    _secondaryLastPoll = DateTime.Now;
                    _secondaryLastState = ClaudeUsageMeterState.Ok;
                    _secondaryLastReason = null;

                    ActivityLog.Log(Channel,
                        $"[secondary] OK[api] — Weekly: {(_secondaryWeeklyPercent.HasValue ? _secondaryWeeklyPercent.Value + "%" : "--")} (reset target={(_secondaryWeeklyResetTarget.HasValue ? _secondaryWeeklyResetTarget.Value.ToString("ddd HH:mm") : "none")}).");

                    if (_secondaryWeeklyPercent.HasValue)
                        UpdateSecondaryWeeklyProjection(_secondaryWeeklyPercent.Value, _secondaryWeeklyResetTarget, _secondaryLastPoll.Value);
                }
                else if (res.rateLimited)
                {
                    // 429: set back-off and keep the last good reading rather than clearing to an error.
                    _secondaryBackoffUntil = DateTime.Now + (res.retryAfter ?? DefaultRateLimitBackoff);
                    ActivityLog.Log(Channel, $"[secondary] rate limited (429); backing off until {_secondaryBackoffUntil.Value:HH:mm:ss}, keeping last reading.");
                }
                else
                {
                    var state = res.notSignedIn ? ClaudeUsageMeterState.Unavailable : ClaudeUsageMeterState.Error;
                    SetSecondaryUnavailable(res.error ?? "secondary poll failed", state);
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"[secondary] poll threw: {ex.Message}");
                SetSecondaryUnavailable(ex.Message, ClaudeUsageMeterState.Error);
            }
        }

        private void SetSecondaryUnavailable(string reason, ClaudeUsageMeterState state = ClaudeUsageMeterState.Unavailable)
        {
            _secondaryWeeklyPercent = null;
            _secondaryWeeklyResetTarget = null;
            _secondaryWeeklyProjectedFullTarget = null;
            _secondaryWeeklyProjectedRatePerHour = 0;
            _secondaryLastState = state;
            _secondaryLastReason = reason;
        }

        private void UpdateSecondaryWeeklyProjection(int percent, DateTime? resetTarget, DateTime pollMoment)
        {
            try
            {
                var sample = new UsageSample { At = pollMoment, Percent = percent, ResetTarget = resetTarget };
                bool stored = SecondaryWeeklyUsageHistoryStore.Append(sample);
                ActivityLog.Log(Channel,
                    $"[secondary] weekly data-point {(stored ? "stored" : "NOT stored")}: {percent}% at {pollMoment:yyyy-MM-dd HH:mm:ss}"
                    + (resetTarget.HasValue ? $" (weekly reset target {resetTarget.Value:ddd HH:mm})" : " (weekly reset target none)") + ".");

                var projection = UsageProjection.Compute(SecondaryWeeklyUsageHistoryStore.ReadAll(), pollMoment);
                if (projection.HasProjection && projection.TimeTo100.HasValue)
                {
                    _secondaryWeeklyProjectedFullTarget = pollMoment + projection.TimeTo100.Value;
                    _secondaryWeeklyProjectedRatePerHour = projection.RatePerHour;
                    ActivityLog.Log(Channel,
                        $"[secondary] weekly projection: ~{FormatCountdown(projection.TimeTo100.Value)} to 100% "
                        + $"(weekly rate {projection.RatePerHour:0.00}%/hr over {projection.WindowSampleCount} current-window points; "
                        + $"weekly projected 100% at {_secondaryWeeklyProjectedFullTarget.Value:ddd yyyy-MM-dd HH:mm}).");
                }
                else
                {
                    _secondaryWeeklyProjectedFullTarget = null;
                    _secondaryWeeklyProjectedRatePerHour = 0;
                    ActivityLog.Log(Channel, $"[secondary] weekly projection withheld: {projection.Reason}.");
                }
            }
            catch (Exception ex)
            {
                _secondaryWeeklyProjectedFullTarget = null;
                _secondaryWeeklyProjectedRatePerHour = 0;
                ActivityLog.Log(Channel, $"[secondary] weekly projection update failed: {ex.Message}");
            }
        }

        // ── reset-label parsing helper (for external callers) ─────────────────

        private static readonly Dictionary<string, int> MonthNames = new(StringComparer.OrdinalIgnoreCase)
        {
            { "jan", 1 }, { "january", 1 },
            { "feb", 2 }, { "february", 2 },
            { "mar", 3 }, { "march", 3 },
            { "apr", 4 }, { "april", 4 },
            { "may", 5 },
            { "jun", 6 }, { "june", 6 },
            { "jul", 7 }, { "july", 7 },
            { "aug", 8 }, { "august", 8 },
            { "sep", 9 }, { "september", 9 },
            { "oct", 10 }, { "october", 10 },
            { "nov", 11 }, { "november", 11 },
            { "dec", 12 }, { "december", 12 },
        };

        private static readonly (string abbr, DayOfWeek dow)[] Weekdays =
        {
            ("sun", DayOfWeek.Sunday), ("mon", DayOfWeek.Monday), ("tue", DayOfWeek.Tuesday),
            ("wed", DayOfWeek.Wednesday), ("thu", DayOfWeek.Thursday), ("fri", DayOfWeek.Friday),
            ("sat", DayOfWeek.Saturday),
        };

        /// <summary>
        /// Parses a text reset label into a LOCAL datetime. Returns null if unparseable (no guessed fallback).
        /// </summary>
        internal static DateTime? ParseResetTarget(string? label, DateTime? nowOverride = null)
        {
            if (string.IsNullOrWhiteSpace(label)) return null;
            var now = nowOverride ?? DateTime.Now;
            string lower = label.ToLowerInvariant();

            var relativeMatch = Regex.Match(lower, @"(?:resets?\s+)?in\s+(?:(\d+)\s*(?:hrs?|hours?|h))?\s*(?:(\d+)\s*(?:mins?|minutes?|m))?", RegexOptions.IgnoreCase);
            if (relativeMatch.Success && (relativeMatch.Groups[1].Success || relativeMatch.Groups[2].Success))
            {
                int hours = 0;
                int minutes = 0;
                if (relativeMatch.Groups[1].Success) hours = int.Parse(relativeMatch.Groups[1].Value);
                if (relativeMatch.Groups[2].Success) minutes = int.Parse(relativeMatch.Groups[2].Value);
                if (hours > 0 || minutes > 0)
                {
                    return now.AddHours(hours).AddMinutes(minutes);
                }
            }

            var fullDateMatch = Regex.Match(lower, @"([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?");
            if (fullDateMatch.Success && MonthNames.TryGetValue(fullDateMatch.Groups[1].Value, out int month))
            {
                int day = int.Parse(fullDateMatch.Groups[2].Value);
                int hour = int.Parse(fullDateMatch.Groups[3].Value);
                int minute = fullDateMatch.Groups[4].Success ? int.Parse(fullDateMatch.Groups[4].Value) : 0;
                string mer = fullDateMatch.Groups[5].Value;
                if (mer == "pm" && hour < 12) hour += 12;
                else if (mer == "am" && hour == 12) hour = 0;

                string tzName = fullDateMatch.Groups[6].Success ? fullDateMatch.Groups[6].Value.Trim() : string.Empty;
                if (string.IsNullOrWhiteSpace(tzName))
                {
                    if (lower.Contains("utc") || lower.Contains("gmt")) tzName = "utc";
                    else if (lower.Contains("et") || lower.Contains("est") || lower.Contains("edt") || lower.Contains("eastern")) tzName = "America/New_York";
                    else if (lower.Contains("pt") || lower.Contains("pst") || lower.Contains("pdt") || lower.Contains("pacific")) tzName = "America/Los_Angeles";
                    else if (lower.Contains("ct") || lower.Contains("cst") || lower.Contains("cdt") || lower.Contains("central")) tzName = "America/Chicago";
                }

                TimeZoneInfo sourceTz = string.IsNullOrWhiteSpace(tzName)
                    ? ((hour == 1 && minute == 0) ? TimeZoneInfo.Utc : ResolveTimeZone("America/New_York"))
                    : ResolveTimeZone(tzName);

                int year = now.Year;
                try
                {
                    var sourceDt = new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Unspecified);
                    var sourceUtc = TimeZoneInfo.ConvertTimeToUtc(sourceDt, sourceTz);
                    var localTarget = TimeZoneInfo.ConvertTimeFromUtc(sourceUtc, TimeZoneInfo.Local);

                    if (localTarget < now.AddDays(-180))
                    {
                        sourceDt = new DateTime(year + 1, month, day, hour, minute, 0, DateTimeKind.Unspecified);
                        sourceUtc = TimeZoneInfo.ConvertTimeToUtc(sourceDt, sourceTz);
                        localTarget = TimeZoneInfo.ConvertTimeFromUtc(sourceUtc, TimeZoneInfo.Local);
                    }
                    return localTarget;
                }
                catch { }
            }

            var tm = Regex.Match(lower, @"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?");
            if (tm.Success)
            {
                int thour = int.Parse(tm.Groups[1].Value);
                int tminute = tm.Groups[2].Success ? int.Parse(tm.Groups[2].Value) : 0;
                string tmer = tm.Groups[3].Value;
                if (tmer == "pm" && thour < 12) thour += 12;
                else if (tmer == "am" && thour == 12) thour = 0;

                if (thour <= 23 && tminute <= 59)
                {
                    bool isEastern = lower.Contains("et") || lower.Contains("eastern") || lower.Contains("new_york");
                    TimeZoneInfo sourceTz = isEastern ? ResolveTimeZone("America/New_York") : (thour == 1 && tminute == 0 ? TimeZoneInfo.Utc : TimeZoneInfo.Local);
                    var nowInSource = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.Local, sourceTz);

                    DayOfWeek? targetDow = null;
                    foreach (var (abbr, dow) in Weekdays)
                    {
                        if (lower.Contains(abbr)) { targetDow = dow; break; }
                    }

                    DateTime candidateInSource;
                    if (targetDow.HasValue)
                    {
                        int delta = (((int)targetDow.Value) - (int)nowInSource.DayOfWeek + 7) % 7;
                        if (delta == 0 && (nowInSource.Hour > thour || (nowInSource.Hour == thour && nowInSource.Minute >= tminute)))
                        {
                            delta = 7;
                        }
                        candidateInSource = nowInSource.Date.AddDays(delta).Add(new TimeSpan(thour, tminute, 0));
                    }
                    else
                    {
                        candidateInSource = nowInSource.Date.Add(new TimeSpan(thour, tminute, 0));
                        if (candidateInSource <= nowInSource) candidateInSource = candidateInSource.AddDays(1);
                    }

                    var candidateUtc = TimeZoneInfo.ConvertTimeToUtc(candidateInSource, sourceTz);
                    return TimeZoneInfo.ConvertTimeFromUtc(candidateUtc, TimeZoneInfo.Local);
                }
            }

            return null;
        }

        internal static TimeZoneInfo ResolveTimeZone(string tzName)
        {
            if (string.IsNullOrWhiteSpace(tzName)) return TimeZoneInfo.Local;
            if (TimeZoneInfo.TryFindSystemTimeZoneById(tzName, out var tz)) return tz;

            string lower = tzName.ToLowerInvariant().Trim();
            if (lower == "utc" || lower == "gmt" || lower == "z" || lower.Contains("universal") || lower.Contains("etc/utc") || lower.Contains("etc/gmt"))
                return TimeZoneInfo.Utc;

            if (lower.Contains("new_york") || lower.Contains("eastern") || lower.Contains("detroit") || lower.Contains("toronto") || lower == "et" || lower == "est" || lower == "edt" || lower.Contains("us/eastern"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Eastern Standard Time", out var est)) return est;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/New_York", out var any)) return any;
            }

            if (lower.Contains("chicago") || lower.Contains("central") || lower == "ct" || lower == "cst" || lower == "cdt" || lower.Contains("us/central"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Central Standard Time", out var cst)) return cst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Chicago", out var ach)) return ach;
            }

            if (lower.Contains("denver") || lower.Contains("mountain") || lower == "mt" || lower == "mst" || lower == "mdt" || lower.Contains("us/mountain"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Mountain Standard Time", out var mst)) return mst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Denver", out var ade)) return ade;
            }

            if (lower.Contains("los_angeles") || lower.Contains("pacific") || lower == "pt" || lower == "pst" || lower == "pdt" || lower.Contains("us/pacific"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Pacific Standard Time", out var pst)) return pst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Los_Angeles", out var ala)) return ala;
            }

            return TimeZoneInfo.Local;
        }

        /// <summary>"1d 4h 12m" / "4h 12m" / "12m" — omits leading zero units.</summary>
        internal static string FormatCountdown(TimeSpan t)
        {
            if (t < TimeSpan.Zero) t = TimeSpan.Zero;
            int days = t.Days;
            int hours = t.Hours;
            int minutes = t.Minutes;
            var sb = new StringBuilder();
            if (days > 0) sb.Append($"{days}d ");
            if (days > 0 || hours > 0) sb.Append($"{hours}h ");
            sb.Append($"{minutes}m");
            return sb.ToString();
        }

        // ── status assembly ─────────────────────────────────────────────────

        private void Emit(ClaudeUsageMeterState state, string? reason = null)
        {
            _lastState = state;
            var status = new ClaudeUsageStatus
            {
                State = state,
                Percent = _percent,
                ResetTarget = _resetTarget,
                WeeklyPercent = _weeklyPercent,
                WeeklyResetTarget = _weeklyResetTarget,
                LastPoll = _lastPoll,
                DisplayText = BuildDisplayText(state),
                ToolTip = BuildToolTip(state, reason),
                WeeklyDisplayText = BuildWeeklyDisplayText(state),
                WeeklyToolTip = BuildWeeklyToolTip(state, reason),
                SecondaryConfigured = _secondaryConfigured,
                SecondaryState = _secondaryLastState,
                SecondaryWeeklyPercent = _secondaryWeeklyPercent,
                SecondaryWeeklyResetTarget = _secondaryWeeklyResetTarget,
                SecondaryLastPoll = _secondaryLastPoll,
                SecondaryWeeklyDisplayText = BuildSecondaryWeeklyDisplayText(),
                SecondaryWeeklyToolTip = BuildSecondaryWeeklyToolTip(),
            };
            StatusChanged?.Invoke(status);
        }

        private string BuildDisplayText(ClaudeUsageMeterState state)
        {
            if (!_percent.HasValue) return "Claude: --";

            string text = $"Claude: {_percent.Value}% used";
            if (_percent.Value >= CountdownThresholdPercent && _resetTarget.HasValue)
            {
                var remaining = _resetTarget.Value - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }

            if (_projectedFullTarget.HasValue)
            {
                var toFull = _projectedFullTarget.Value - DateTime.Now;
                if (toFull > TimeSpan.Zero)
                    text += $" · ~{FormatCountdown(toFull)} to 100%";
            }

            return text;
        }

        private string BuildToolTip(ClaudeUsageMeterState state, string? reason)
        {
            var tip = new StringBuilder();
            tip.Append("Claude usage meter (Current Session)");
            tip.Append(state switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking Claude usage via Anthropic OAuth API…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(reason) ? "" : $" ({reason})")} — is claude CLI logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(reason) ? "" : $": {reason}")}",
                _ => _percent.HasValue ? $"\n{_percent.Value}% of the Current Session window used" : "",
            });
            if (_resetTarget.HasValue)
                tip.Append($"\nResets: {_resetTarget.Value:ddd MMM d, h:mm tt}");
            else
                tip.Append("\nResets: unknown");
            if (_projectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_projectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_projectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_lastPoll.HasValue ? $"\nLast checked: {_lastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        private string BuildWeeklyDisplayText(ClaudeUsageMeterState state)
        {
            if (!_weeklyPercent.HasValue) return "Claude Weekly (Primary): --";

            string text = $"Claude Weekly (Primary): {_weeklyPercent.Value}% used";
            if (_weeklyPercent.Value >= CountdownThresholdPercent && _weeklyResetTarget.HasValue)
            {
                var remaining = _weeklyResetTarget.Value - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }

            if (_weeklyProjectedFullTarget.HasValue)
            {
                var toFull = _weeklyProjectedFullTarget.Value - DateTime.Now;
                if (toFull > TimeSpan.Zero)
                    text += $" · ~{FormatCountdown(toFull)} to 100%";
            }

            return text;
        }

        private string BuildWeeklyToolTip(ClaudeUsageMeterState state, string? reason)
        {
            var tip = new StringBuilder();
            tip.Append("Claude usage meter (All Models tier)");
            tip.Append(state switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking Claude usage via Anthropic OAuth API…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(reason) ? "" : $" ({reason})")} — is claude CLI logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(reason) ? "" : $": {reason}")}",
                _ => _weeklyPercent.HasValue ? $"\n{_weeklyPercent.Value}% of the All Models window used" : "",
            });
            if (_weeklyResetTarget.HasValue)
                tip.Append($"\nResets: {_weeklyResetTarget.Value:ddd MMM d, h:mm tt}");
            else
                tip.Append("\nResets: unknown");
            if (_weeklyProjectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_weeklyProjectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_weeklyProjectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_lastPoll.HasValue ? $"\nLast checked: {_lastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        private string BuildSecondaryWeeklyDisplayText()
        {
            if (!_secondaryConfigured) return "Claude Weekly (Secondary): not configured";
            if (_secondaryLastState == ClaudeUsageMeterState.Error) return "Claude Weekly (Secondary): error";
            if (!_secondaryWeeklyPercent.HasValue) return "Claude Weekly (Secondary): --";

            string text = $"Claude Weekly (Secondary): {_secondaryWeeklyPercent.Value}% used";
            if (_secondaryWeeklyPercent.Value >= CountdownThresholdPercent && _secondaryWeeklyResetTarget.HasValue)
            {
                var remaining = _secondaryWeeklyResetTarget.Value - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }

            if (_secondaryWeeklyProjectedFullTarget.HasValue)
            {
                var toFull = _secondaryWeeklyProjectedFullTarget.Value - DateTime.Now;
                if (toFull > TimeSpan.Zero)
                    text += $" · ~{FormatCountdown(toFull)} to 100%";
            }

            return text;
        }

        private string BuildSecondaryWeeklyToolTip()
        {
            var tip = new StringBuilder();
            tip.Append("Claude usage meter (All Models tier, Secondary account)");

            if (!_secondaryConfigured)
            {
                tip.Append("\nNot configured — set SecondaryClaudeConfigDir in BuildConsole Settings to enable this meter.");
                return tip.ToString();
            }

            tip.Append(_secondaryLastState switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking secondary account's Claude usage via Anthropic OAuth API…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(_secondaryLastReason) ? "" : $" ({_secondaryLastReason})")} — is the secondary account's claude CLI session logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(_secondaryLastReason) ? "" : $": {_secondaryLastReason}")}",
                _ => _secondaryWeeklyPercent.HasValue ? $"\n{_secondaryWeeklyPercent.Value}% of the All Models window used" : "",
            });
            if (_secondaryWeeklyResetTarget.HasValue)
                tip.Append($"\nResets: {_secondaryWeeklyResetTarget.Value:ddd MMM d, h:mm tt}");
            else
                tip.Append("\nResets: unknown");
            if (_secondaryWeeklyProjectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_secondaryWeeklyProjectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_secondaryWeeklyProjectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_secondaryLastPoll.HasValue ? $"\nLast checked: {_secondaryLastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        private static int Clamp(double p) => (int)Math.Round(Math.Max(0, Math.Min(100, p)));

        private static string Trim(string? s) =>
            string.IsNullOrEmpty(s) ? "" : (s!.Length > 80 ? s.Substring(0, 80) + "…" : s);
    }
}
