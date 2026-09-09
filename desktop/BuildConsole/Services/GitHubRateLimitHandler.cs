using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
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
            else if (res.IsSuccessStatusCode && await IsGraphQlRateLimitedBodyAsync(request, res).ConfigureAwait(false))
                GitHubRateLimitCircuit.RecordRateLimited("GraphQL body");
            else if (res.IsSuccessStatusCode || res.StatusCode == HttpStatusCode.NotModified)
                GitHubRateLimitCircuit.RecordSuccess();
            // Any other failure (404, a genuine non-rate-limit 403 permission error, 5xx) leaves the
            // breaker untouched — we only trip on a real rate-limit signal, never a generic error.

            return res;
        }

        /// <summary>Git #3349 — GitHub's GraphQL endpoint commonly signals a secondary/point rate
        /// limit as an HTTP <c>200 OK</c> whose JSON body carries
        /// <c>{"errors":[{"type":"RATE_LIMITED",...}]}</c>, not a 429/403. <see cref="IsRateLimited"/>
        /// only looks at HTTP status + headers, so that shape used to fall straight into the success
        /// branch and RESET the breaker instead of tripping it. Scoped to the <c>/graphql</c> request
        /// path (the only transport this shape applies to) and buffers the body once, re-attaching an
        /// equivalent <see cref="ByteArrayContent"/> so every downstream reader still sees the exact
        /// same content it would have without this check.</summary>
        private static async Task<bool> IsGraphQlRateLimitedBodyAsync(HttpRequestMessage request, HttpResponseMessage res)
        {
            if (res.Content == null) return false;
            if (request.RequestUri is not { } uri || !uri.AbsolutePath.TrimEnd('/').EndsWith("/graphql", StringComparison.OrdinalIgnoreCase))
                return false;

            string body = string.Empty;
            bool readOk = true;
            try
            {
                body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch
            {
                // Body unreadable for some reason — don't let this check break the response.
                readOk = false;
            }
            finally
            {
                // Re-buffer so every existing caller downstream of this handler can still read the
                // body exactly as before (HttpContent can only be read once off the wire).
                var bytes = Encoding.UTF8.GetBytes(body ?? string.Empty);
                var replacement = new ByteArrayContent(bytes);
                foreach (var header in res.Content.Headers)
                    replacement.Headers.TryAddWithoutValidation(header.Key, header.Value);
                res.Content = replacement;
            }

            if (!readOk || string.IsNullOrEmpty(body)) return false;
            return body.Contains("RATE_LIMITED", StringComparison.OrdinalIgnoreCase)
                && GitHubRateLimitCircuit.LooksLikeRateLimit(body);
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
