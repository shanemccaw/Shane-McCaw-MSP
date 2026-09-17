using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    public enum PageAutoCheckKind
    {
        /// <summary>Checked against existing records, nothing changed — no banner.</summary>
        Silent,
        /// <summary>A missing a11y audit and/or DOM baseline was run and recorded.</summary>
        FirstVisit,
        /// <summary>Real DOM drift against the stored baseline (accessibility re-scanned).</summary>
        Drift,
        /// <summary>The check could not run or could not save — said plainly, never as success.</summary>
        Problem,
    }

    public sealed class PageAutoCheckOutcome
    {
        public PageAutoCheckKind Kind { get; init; }
        public string Headline { get; init; } = "";
        public string Detail { get; init; } = "";
        public string BaseUrl { get; init; } = "";
        public string PagePath { get; init; } = "";
        public VisualTestTrackerDomBaseline? Baseline { get; init; }
        public DomPageObservation? Observation { get; init; }
        public List<DomMutationRecord> Drift { get; init; } = new();
        public VisualTestTrackerStore? Store { get; init; }
    }

    /// <summary>
    /// Git #4442 — Test Mode's navigation auto-check. For a watched page, looks up the persisted
    /// accessibility audit and DOM baseline; runs and records whichever is missing; otherwise observes
    /// the page again and diffs it against the baseline (<see cref="DomBaselineDiff"/>). Real drift also
    /// re-runs the accessibility audit (Shane's addendum on #4442 — a structural change can introduce a
    /// new violation, so the stored audit can't be trusted once drift is confirmed). Returns an outcome
    /// for the caller to show; <see cref="PageAutoCheckKind.Silent"/> means no banner.
    ///
    /// UI-thread only (WebView2 script calls), invoked from MainWindow.UpdateTestModeActiveTab().
    /// </summary>
    public static class PageAutoCheckService
    {
        public const string A11yMigrationFile = "lib/db/migrations/manual/2026-09-17-visual-test-tracker-a11y-audits-4442.sql";
        public const string DomMigrationFile = "lib/db/migrations/manual/2026-09-15-dom-mutation-baselines.sql";

        private static readonly TimeSpan DocumentReadyTimeout = TimeSpan.FromSeconds(20);
        // After readyState=complete, SPA pages (every watched site is Vite + React) are still rendering.
        private static readonly TimeSpan SettleDelay = TimeSpan.FromMilliseconds(1500);
        private static readonly TimeSpan ObservationWindow = TimeSpan.FromSeconds(3);

        // Latest real observation per page, so DomDriftDiffWindow opened afterward from the composer shows
        // the same drift the banner reported instead of re-observing a page that has since settled.
        private static readonly Dictionary<string, (VisualTestTrackerDomBaseline? Baseline, DomPageObservation Observation)> _lastObservations = new();

        private static bool _setupProblemReported;

        /// <summary>The base-URL key the DOM baseline table is written under — scheme://authority, the same
        /// convention TestModeComposerPanel's Verify/Update Baseline actions already use for this table.</summary>
        public static string BaseUrlKeyFor(string fullUrl)
            => Uri.TryCreate(fullUrl, UriKind.Absolute, out var uri) ? $"{uri.Scheme}://{uri.Authority}" : "";

        private static string CacheKey(string baseUrl, string pagePath) => baseUrl + "\n" + pagePath;

        public static bool TryGetLastObservation(string baseUrl, string pagePath,
            out VisualTestTrackerDomBaseline? baseline, out DomPageObservation? observation)
        {
            if (_lastObservations.TryGetValue(CacheKey(baseUrl, pagePath), out var entry))
            {
                baseline = entry.Baseline;
                observation = entry.Observation;
                return true;
            }
            baseline = null;
            observation = null;
            return false;
        }

        /// <summary>Called after "Accept Drift &amp; Update Baseline" so a later diff window compares against
        /// the accepted baseline, not the one it replaced.</summary>
        public static void RecordAcceptedBaseline(string baseUrl, string pagePath, VisualTestTrackerDomBaseline baseline)
        {
            var key = CacheKey(baseUrl, pagePath);
            if (_lastObservations.TryGetValue(key, out var entry))
                _lastObservations[key] = (baseline, entry.Observation);
        }

        /// <summary>A one-off observation of the page as it is now (no once-per-document claim) — for the
        /// composer's manual drift check when no auto-check has observed this page yet.</summary>
        public static async Task<DomPageObservation?> ObserveNowAsync(WebView2 webView)
        {
            var token = await VisualTestTrackerTelemetry.StartDomObservationAsync(webView, null, null);
            if (token == null) return null;
            await Task.Delay(ObservationWindow);
            return await VisualTestTrackerTelemetry.CollectDomObservationAsync(webView, token);
        }

        /// <summary>Runs the auto-check for <paramref name="pageUrl"/> showing in <paramref name="webView"/>.
        /// Null when nothing ran: this document was already checked for this page (one page load raises
        /// several navigation events — the in-page claim lets exactly one of them through), or the page
        /// moved on before the check finished (that navigation runs its own check). <paramref name="watchedBase"/> is the
        /// configured watched base the tab matched — the key visual_test_tracker_pages rows use, for page_id.</summary>
        public static async Task<PageAutoCheckOutcome?> RunAsync(WebView2 webView, string pageUrl, string baseUrl, string pagePath, string watchedBase, Action? onClaimed = null)
        {
            if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(pagePath)) return null;

            try
            {
                return await RunCoreAsync(webView, pageUrl, baseUrl, pagePath, watchedBase, onClaimed);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Page auto-check failed for {baseUrl}{pagePath}: {ex.Message}");
                return new PageAutoCheckOutcome
                {
                    Kind = PageAutoCheckKind.Problem,
                    Headline = "Page check failed — nothing was recorded for this page.",
                    Detail = ex.Message,
                    BaseUrl = baseUrl,
                    PagePath = pagePath,
                };
            }
        }

        private static async Task<PageAutoCheckOutcome?> RunCoreAsync(WebView2 webView, string pageUrl, string baseUrl, string pagePath, string watchedBase, Action? onClaimed)
        {
            if (!await VisualTestTrackerTelemetry.WaitForDocumentReadyAsync(webView, DocumentReadyTimeout)) return null;
            await Task.Delay(SettleDelay);

            var connStr = VisualTestTrackerStore.ResolveConnectionString();
            if (string.IsNullOrWhiteSpace(connStr))
                return SetupProblemOnce(baseUrl, pagePath, "Page checks are off — no DATABASE_URL is configured.",
                    "Accessibility audits and DOM baselines are stored in the local database; none is resolvable from build-queue-watcher.config.json or .env.local.");

            var store = new VisualTestTrackerStore(connStr);
            bool domTableReady, a11yTableReady;
            try
            {
                (domTableReady, a11yTableReady) = await store.GetAutoCheckTablesReadyOrThrowAsync();
            }
            catch (Exception ex)
            {
                return SetupProblemOnce(baseUrl, pagePath, "Page checks are off — the local database is unreachable.", ex.Message);
            }
            if (!domTableReady || !a11yTableReady)
            {
                var missing = new List<string>();
                if (!domTableReady) missing.Add(DomMigrationFile);
                if (!a11yTableReady) missing.Add(A11yMigrationFile);
                return SetupProblemOnce(baseUrl, pagePath, "Page checks are off until a migration is run.",
                    "Run " + string.Join(" and ", missing) + " — until then no accessibility audit or DOM baseline can be recorded.");
            }

            var token = await VisualTestTrackerTelemetry.StartDomObservationAsync(webView, baseUrl + pagePath, pageUrl);
            if (token == null) return null; // already checked on this document, or no longer this page
            onClaimed?.Invoke();
            await Task.Delay(ObservationWindow);
            var observation = await VisualTestTrackerTelemetry.CollectDomObservationAsync(webView, token);
            // Navigated, reloaded, or routed elsewhere mid-check — that navigation runs its own check.
            if (observation == null || !SameDocumentUrl(observation.Href, pageUrl)) return null;

            var baseline = await store.GetDomBaselineOrThrowAsync(baseUrl, pagePath);
            var audit = await store.GetA11yAuditOrThrowAsync(baseUrl, pagePath);
            int pageId = 0;
            try { pageId = await store.FindPageIdAsync(watchedBase, pagePath) ?? 0; } catch { }

            bool firstDom = baseline == null;
            bool firstA11y = audit == null;
            var drift = new List<DomMutationRecord>();

            if (baseline == null)
            {
                baseline = DomBaselineDiff.MergeIntoBaseline(null, observation, baseUrl, pagePath);
                baseline.PageId = pageId;
                await store.SaveDomBaselineOrThrowAsync(baseline);
            }
            else
            {
                drift = DomBaselineDiff.ComputeDrift(baseline, observation);
                if (!baseline.HasStructureSnapshot)
                {
                    // Row saved without a structural snapshot: record one now so the next visit can compare
                    // structure too. This visit's drift is mutation-only — nothing to compare structure against.
                    await store.UpdateDomBaselineSnapshotOrThrowAsync(baseUrl, pagePath, observation.StructureKeys);
                    baseline.StructureKeys = observation.StructureKeys.ToList();
                    baseline.HasStructureSnapshot = true;
                }
            }

            _lastObservations[CacheKey(baseUrl, pagePath)] = (baseline, observation);

            bool runA11y = firstA11y || drift.Count > 0;
            AccessibilityAuditReport? report = null;
            List<AccessibilityViolation> newViolations = new();
            bool a11yFailed = false;

            if (runA11y)
            {
                if (!await VisualTestTrackerTelemetry.IsDomObservationCurrentAsync(webView, token))
                    return null; // page changed between observing and auditing — don't audit a different page

                report = await VisualTestTrackerTelemetry.RunAccessibilityAuditAsync(webView);
                // The scanner draws violation badges on the page — right for a manual audit, noise for one
                // that ran on its own. The violations are persisted; the A11y panel can re-show them.
                await VisualTestTrackerTelemetry.ClearA11yBadgesAsync(webView);

                // RunAccessibilityAuditAsync returns an empty report on failure; only a real run carries the
                // scanner's own timestamp. Never persist a failed run as "0 violations".
                if (string.IsNullOrWhiteSpace(report.Timestamp))
                {
                    a11yFailed = true;
                }
                else
                {
                    newViolations = DomBaselineDiff.NewViolations(audit?.Violations, report.Violations);
                    await store.SaveA11yAuditOrThrowAsync(new VisualTestTrackerA11yAudit
                    {
                        Id = audit?.Id ?? 0,
                        PageId = pageId > 0 ? pageId : audit?.PageId ?? 0,
                        BaseUrl = baseUrl,
                        PagePath = pagePath,
                        Violations = report.Violations,
                        CreatedAt = audit?.CreatedAt ?? DateTime.Now,
                        LastAuditedAt = DateTime.Now,
                    });
                }
            }

            ActivityLog.Log(VisualTestTrackerStore.Channel,
                $"Page auto-check {baseUrl}{pagePath}: firstDom={firstDom} firstA11y={firstA11y} " +
                $"liveMutations={observation.Mutations.Count} structureKeys={observation.StructureKeys.Count} drift={drift.Count} " +
                $"a11yRan={runA11y} a11yFailed={a11yFailed} violations={report?.Violations.Count ?? -1} newViolations={newViolations.Count}");

            if (!firstDom && !firstA11y && drift.Count == 0) return Silent(baseUrl, pagePath, baseline, observation, store);

            string a11ySentence = a11yFailed
                ? "The accessibility audit could not run on this page, so no audit was recorded."
                : runA11y ? A11ySummary(report!, firstA11y, newViolations) : "";

            string headline;
            var details = new List<string>();
            PageAutoCheckKind kind;

            if (drift.Count > 0)
            {
                kind = PageAutoCheckKind.Drift;
                headline = $"DOM drift found — {drift.Count} change{Plural(drift.Count)} not in this page's baseline; accessibility re-scanned.";
                details.Add(a11ySentence);
            }
            else if (firstDom && firstA11y)
            {
                kind = PageAutoCheckKind.FirstVisit;
                headline = "First visit — ran an accessibility audit and recorded a DOM baseline for this page.";
                details.Add(a11ySentence);
                details.Add(BaselineSentence(observation));
            }
            else if (firstDom)
            {
                kind = PageAutoCheckKind.FirstVisit;
                headline = "First DOM check — recorded a DOM baseline for this page.";
                details.Add(BaselineSentence(observation));
                details.Add($"Accessibility audit already on record from {audit!.LastAuditedAt:yyyy-MM-dd HH:mm}.");
            }
            else
            {
                kind = PageAutoCheckKind.FirstVisit;
                headline = "First accessibility audit — ran an accessibility audit for this page.";
                details.Add(a11ySentence);
                details.Add("DOM baseline already on record — no drift.");
            }

            if (a11yFailed) kind = kind == PageAutoCheckKind.Drift ? kind : PageAutoCheckKind.Problem;

            return new PageAutoCheckOutcome
            {
                Kind = kind,
                Headline = headline,
                Detail = string.Join(" ", details.Where(d => !string.IsNullOrWhiteSpace(d))),
                BaseUrl = baseUrl,
                PagePath = pagePath,
                Baseline = baseline,
                Observation = observation,
                Drift = drift,
                Store = store,
            };
        }

        private static string A11ySummary(AccessibilityAuditReport report, bool firstAudit, List<AccessibilityViolation> newViolations)
        {
            int total = report.Violations.Count;
            string totals = $"{total} accessibility violation{Plural(total)} ({report.MissingAltCount} missing alt, {report.ContrastCount} contrast, {report.AriaCount} ARIA)";
            if (firstAudit) return $"Accessibility: {totals}.";
            return newViolations.Count > 0
                ? $"Accessibility: {newViolations.Count} NEW violation{Plural(newViolations.Count)} since the last audit — {totals} in total."
                : $"Accessibility: no new violations since the last audit — {totals}.";
        }

        private static string BaselineSentence(DomPageObservation observation)
        {
            int signatures = observation.Mutations.Select(DomBaselineDiff.SignatureOf).Distinct().Count();
            return $"DOM baseline: {observation.StructureKeys.Count} stable element{Plural(observation.StructureKeys.Count)} and {signatures} routine mutation{Plural(signatures)} recorded.";
        }

        private static string Plural(int n) => n == 1 ? "" : "s";

        private static bool SameDocumentUrl(string a, string b)
        {
            static string Strip(string u) { int i = (u ?? "").IndexOf('#'); return i >= 0 ? u!.Substring(0, i) : u ?? ""; }
            return string.Equals(Strip(a), Strip(b), StringComparison.Ordinal);
        }

        private static PageAutoCheckOutcome Silent(string baseUrl, string pagePath, VisualTestTrackerDomBaseline baseline,
            DomPageObservation observation, VisualTestTrackerStore store) => new()
        {
            Kind = PageAutoCheckKind.Silent,
            BaseUrl = baseUrl,
            PagePath = pagePath,
            Baseline = baseline,
            Observation = observation,
            Store = store,
        };

        /// <summary>A setup gap (no DB, migration not run) is the same on every page — say it once per app
        /// session rather than on every navigation.</summary>
        private static PageAutoCheckOutcome? SetupProblemOnce(string baseUrl, string pagePath, string headline, string detail)
        {
            if (_setupProblemReported) return null;
            _setupProblemReported = true;
            ActivityLog.Log(VisualTestTrackerStore.Channel, $"Page auto-check unavailable: {headline} {detail}");
            return new PageAutoCheckOutcome
            {
                Kind = PageAutoCheckKind.Problem,
                Headline = headline,
                Detail = detail,
                BaseUrl = baseUrl,
                PagePath = pagePath,
            };
        }
    }
}
