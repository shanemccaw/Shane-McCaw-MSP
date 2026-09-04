using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2815 — the HTTP+PAT side of the shared GitHub rate-limit circuit breaker
    /// (<see cref="GitHubRateLimitCircuit"/>). Installed on <see cref="GitHubApiClient"/>'s single
    /// <see cref="HttpClient"/> so EVERY request that client makes (board reconcile,
    /// <see cref="BoardStatusSync"/> mirrors, issue time-series, sub-issue walks, …) consults the
    /// same breaker the `gh` CLI path does — one exhaustion trips both, one recovery closes both.
    ///
    /// While the breaker is OPEN, a request is short-circuited here WITHOUT touching the network,
    /// returning a synthetic 403 that is byte-for-byte handled by callers the same way a real
    /// rate-limited 403 is (EnsureSuccessStatusCode throws / IsSuccessStatusCode is false). When a
    /// real response comes back rate-limited (429, or 403 with GitHub's rate-limit headers), the
    /// breaker is tripped — honoring <c>x-ratelimit-reset</c> / <c>Retry-After</c> for the window —
    /// so the NEXT tick's calls short-circuit instead of hammering. Any success closes it.
    /// </summary>
    public sealed class GitHubRateLimitHandler : DelegatingHandler
    {
        public GitHubRateLimitHandler(HttpMessageHandler inner) : base(inner) { }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (GitHubRateLimitCircuit.ShouldShortCircuit(out var reason))
            {
                return new HttpResponseMessage(HttpStatusCode.Forbidden)
                {
                    ReasonPhrase = "rate-limit circuit open (Git #2815)",
                    Content = new StringContent(reason),
                    RequestMessage = request,
                };
            }

            var res = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);

            if (IsRateLimited(res))
                GitHubRateLimitCircuit.RecordRateLimited("HTTP API", ReadResetUtc(res));
            else if (res.IsSuccessStatusCode || res.StatusCode == HttpStatusCode.NotModified)
                GitHubRateLimitCircuit.RecordSuccess();
            // Any other failure (404, a genuine non-rate-limit 403 permission error, 5xx) leaves the
            // breaker untouched — we only trip on a real rate-limit signal, never a generic error.

            return res;
        }

        /// <summary>GitHub signals a rate limit as HTTP 429 (secondary/abuse) or 403 accompanied by
        /// its rate-limit headers — <c>x-ratelimit-remaining: 0</c> (primary) or a <c>retry-after</c>
        /// (secondary). A 403 WITHOUT those headers is a genuine permission error and must NOT trip
        /// the breaker.</summary>
        private static bool IsRateLimited(HttpResponseMessage res)
        {
            if (res.StatusCode == (HttpStatusCode)429) return true;
            if (res.StatusCode != HttpStatusCode.Forbidden) return false;
            if (res.Headers.TryGetValues("retry-after", out _)) return true;
            if (res.Headers.TryGetValues("x-ratelimit-remaining", out var rem) &&
                rem.FirstOrDefault() is { } r && int.TryParse(r, out var remaining) && remaining <= 0)
                return true;
            return false;
        }

        /// <summary>Compute the UTC instant GitHub says the limit resets, from <c>retry-after</c>
        /// (delta seconds) or <c>x-ratelimit-reset</c> (epoch seconds). Null when neither is present —
        /// the circuit then falls back to its own exponential backoff.</summary>
        private static DateTime? ReadResetUtc(HttpResponseMessage res)
        {
            if (res.Headers.TryGetValues("retry-after", out var ra) &&
                ra.FirstOrDefault() is { } rav && int.TryParse(rav, out var secs) && secs > 0)
                return DateTime.UtcNow.AddSeconds(secs);

            if (res.Headers.TryGetValues("x-ratelimit-reset", out var xr) &&
                xr.FirstOrDefault() is { } xrv && long.TryParse(xrv, out var epoch))
                return DateTimeOffset.FromUnixTimeSeconds(epoch).UtcDateTime;

            return null;
        }
    }
}
