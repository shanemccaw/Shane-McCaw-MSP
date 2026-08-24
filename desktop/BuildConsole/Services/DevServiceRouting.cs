using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1210 — resolves a uiSteps navigation route to the correct LOCAL DEV front-end service
    /// origin (Marketing 5173 / Admin 5174 / Portal 5175 / Website 5176), instead of the API server's
    /// port (8080) that {{DEPLOY_URL}} / config.ApiBaseUrl resolves to.
    ///
    /// Background (the real regression this fixes): manifests declare "baseUrl":"{{DEPLOY_URL}}", which
    /// HttpTestExecutor.ResolvePlaceholders maps to config.ApiBaseUrl. In the OLD single-origin Replit
    /// model that ONE origin served BOTH the API and every SPA, so a uiStep navigating to {{DEPLOY_URL}}
    /// landed on a real page. The three-tier environment rework (+#1209 local-first) made Dev's
    /// ApiBaseUrl = http://localhost:8080 — the API server ONLY, which serves NO SPA — so EVERY uiStep
    /// navigated to 8080 and failed (blank/404), while apiTests (which SHOULD hit 8080) kept passing.
    /// Each local front-end (5173-5176) proxies /api -> 8080, so a uiStep that lands on the RIGHT
    /// front-end port both renders the SPA and has its relative /api calls proxied correctly.
    ///
    /// This only applies to Dev (localhost per-service ports). Staging and Production keep a single
    /// origin serving all routes, so there this is a no-op — the run-wide base URL is used unchanged and
    /// no origin remapping happens (see RunManifestAsync: the resolver is only built for TargetEnvironment.Dev).
    ///
    /// The port map is read from <see cref="DevServicesManager.KnownServices"/> — the single source of
    /// truth for the local per-service port map — rather than duplicating port numbers here.
    /// </summary>
    public static class DevServiceRouting
    {
        // KnownServices keys, kept as named constants so the route rules below read clearly and a typo
        // is a compile error rather than a silent miss.
        public const string Marketing = "shane-mccaw-consulting";
        public const string Admin = "admin-panel";
        public const string Portal = "msp-portal";
        public const string Website = "msp-website";

        /// <summary>The service the run navigates to when no route in the manifest is clearly owned by a
        /// specific front-end (only shared/ambiguous routes like "/login" or "/"). Marketing is the public
        /// root site, the natural home for bare "/" and generic routes.</summary>
        public const string DefaultServiceKey = Marketing;

        /// <summary>The uiStep action verbs that perform a NAVIGATION (and therefore carry a route path in
        /// their target/selector that must be resolved to a front-end origin) — as opposed to DOM actions
        /// (click/input/expect/…) whose selector is a CSS selector, not a route. Mirrors the action verbs
        /// UiTestExecutor.ResolveGotoTarget is reached from (goto + logout/ensureloggedout). Manifests today
        /// only use "goto"; the others are matched defensively.</summary>
        private static readonly HashSet<string> NavActions = new(StringComparer.OrdinalIgnoreCase)
        {
            "goto", "navigate", "logout", "ensureloggedout",
        };

        public static bool IsNavAction(string? action) =>
            !string.IsNullOrWhiteSpace(action) && NavActions.Contains(action.Trim());

        /// <summary>
        /// The service key that CLEARLY owns <paramref name="route"/>, or null when the route is
        /// shared/ambiguous (e.g. "/login", used by both Admin and Portal) or unknown — in which case the
        /// caller falls back to the run's primary service. <paramref name="route"/> is a root-anchored path
        /// like "/portal/x", "/scan", or "/{{TEST_PORTAL_SLUG}}/login" (query string and case are ignored).
        /// </summary>
        public static string? ServiceKeyForRoute(string? route)
        {
            if (string.IsNullOrWhiteSpace(route)) return null;
            string t = route.Trim();

            // Only root-anchored absolute paths carry a routable prefix; a truly-relative ("x"/"../x") or
            // already-absolute ("http://…") target is left to the caller's existing resolution.
            if (!t.StartsWith("/")) return null;

            int q = t.IndexOf('?');
            if (q >= 0) t = t.Substring(0, q);
            t = t.ToLowerInvariant();

            // Portal — anything under /portal, plus tenant-slug-at-root portal routes like
            // "/{{test_portal_slug}}/login" (the slug placeholder is the first path segment).
            if (t == "/portal" || t.StartsWith("/portal/")) return Portal;
            if (IsSlugAtRoot(t)) return Portal;

            // Admin panel — /admin and the admin SPA's own top-level routes.
            if (t == "/admin" || t.StartsWith("/admin/")
                || t.StartsWith("/content") || t.StartsWith("/view-as")
                || t == "/dashboard" || t.StartsWith("/dashboard/")
                || t == "/customers" || t.StartsWith("/customers/")
                || t == "/m365-health" || t.StartsWith("/m365-health/"))
                return Admin;

            // Marketing — the public site's own routes.
            if (t == "/scan" || t.StartsWith("/scan/")
                || t == "/pricing" || t.StartsWith("/pricing/")
                || t == "/quick-start" || t.StartsWith("/quick-start/")
                || t == "/retainers" || t.StartsWith("/retainers/")
                || t == "/monitoring" || t.StartsWith("/monitoring/")
                || t == "/buy" || t.StartsWith("/buy/")
                || t.StartsWith("/records") || t.StartsWith("/lp")
                || t.StartsWith("/copilot-assessment"))
                return Marketing;

            // "/login", bare "/", and anything else: shared/ambiguous — defer to the primary service.
            return null;
        }

        /// <summary>True for a route whose FIRST path segment is a {{…SLUG…}} placeholder (a tenant-slug
        /// portal route the tenant slug is dropped into at root, e.g. "/{{TEST_PORTAL_SLUG}}/login").</summary>
        private static bool IsSlugAtRoot(string lowerPath)
        {
            // lowerPath already starts with "/". Look at the first segment only.
            int next = lowerPath.IndexOf('/', 1);
            string first = next < 0 ? lowerPath.Substring(1) : lowerPath.Substring(1, next - 1);
            return first.StartsWith("{{") && first.EndsWith("}}") && first.Contains("slug");
        }

        /// <summary>
        /// The manifest's PRIMARY front-end service — the origin the run navigates to for its shared/ambiguous
        /// routes ("/login", "/"). Classified by scoring every navigation route against
        /// <see cref="ServiceKeyForRoute"/>; the highest-scoring service wins. When nothing is clearly owned,
        /// falls back to <see cref="DefaultServiceKey"/> (Marketing). Classified from the RAW manifest routes
        /// (placeholders intact) so a "/{{TEST_PORTAL_SLUG}}/…" route still classifies as Portal.
        /// </summary>
        public static string PrimaryServiceKey(IEnumerable<string> navRoutes)
        {
            var score = new Dictionary<string, int>
            {
                [Marketing] = 0, [Admin] = 0, [Portal] = 0, [Website] = 0,
            };

            foreach (var route in navRoutes)
            {
                var key = ServiceKeyForRoute(route);
                if (key != null)
                    score[key] += 3;
                else if (!string.IsNullOrWhiteSpace(route) && StripQuery(route.Trim()) == "/")
                    score[Marketing] += 1; // bare "/" is a weak Marketing signal.
            }

            string best = DefaultServiceKey;
            int bestScore = 0;
            foreach (var kv in score)
            {
                if (kv.Value > bestScore)
                {
                    bestScore = kv.Value;
                    best = kv.Key;
                }
            }
            return best;
        }

        private static string StripQuery(string s)
        {
            int q = s.IndexOf('?');
            return q >= 0 ? s.Substring(0, q) : s;
        }

        /// <summary>The local Dev origin (http://localhost:{port}) for a KnownServices key, using the port
        /// from <see cref="DevServicesManager.KnownServices"/>. Falls back to the Marketing port if an
        /// unknown key is passed (never expected).</summary>
        public static string OriginForServiceKey(string serviceKey)
        {
            if (DevServicesManager.KnownServices.TryGetValue(serviceKey, out var def))
                return $"http://localhost:{def.Port}";
            if (DevServicesManager.KnownServices.TryGetValue(DefaultServiceKey, out var d))
                return $"http://localhost:{d.Port}";
            return "http://localhost:5173";
        }

        /// <summary>Resolve a single navigation <paramref name="route"/> to the Dev front-end origin it should
        /// load from: the service that clearly owns the route, else the run's <paramref name="primaryServiceKey"/>.
        /// This is the per-navigation remap that lets a cross-service flow (e.g. #1210's money-path-e2e:
        /// "/LP/…" on Marketing then "/portal/…" on Portal) land each goto on the correct front-end within one run.</summary>
        public static string OriginForRoute(string route, string primaryServiceKey)
        {
            string key = ServiceKeyForRoute(route) ?? primaryServiceKey;
            return OriginForServiceKey(key);
        }

        /// <summary>Human-readable "Marketing (5173)" style label for a service key, for logging the resolution
        /// decision so a misroute is diagnosable from the log alone.</summary>
        public static string DescribeServiceKey(string serviceKey)
        {
            if (DevServicesManager.KnownServices.TryGetValue(serviceKey, out var def))
                return $"{def.Title} ({def.Port})";
            return serviceKey;
        }
    }
}
