using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1418 — Shane: "The secondary account needs to be limited to a max of
    /// Sonnet Medium so I can get 40 hours of build time out of it through the
    /// weekend. Is there a way to say if using secondary, never push a build that
    /// requires anything more than Sonnet Medium." Centralizes the real "exceeds
    /// the cap" test — any Opus model, any Fable model, or anything run above High
    /// effort — so QueueWatcherService (the launch-time gate) and BuildQueuePanel
    /// (the parked-item display / override / drain) share exactly one definition
    /// instead of two independently-drifting copies.
    ///
    /// Raised from Sonnet Medium to Sonnet High per Shane's follow-up request —
    /// only xhigh (and any Opus model) is held; High effort launches normally.
    ///
    /// Git #1479 — Shane upgraded the secondary account to Claude Max 20x (same
    /// tier as primary), so the per-account cap's original reason (the secondary
    /// account's limited capacity) no longer existed. The file was deleted
    /// entirely rather than neutered, but its own closing comment said a future
    /// cap — if ever needed again — was "a one-line flip back to
    /// `IsOpusModel(model) || IsAboveHighEffort(effort)`."
    ///
    /// Git #1989 — that flip-back, for a different reason: not a permanent
    /// per-account tier cap, but a manual conservation toggle Shane switches on
    /// when a specific usage window is tight (e.g. 90% consumed hours before a
    /// reset). Same gate, plus Fable — which didn't exist when this was first
    /// written and is above Sonnet — added to the test. Per Shane's own
    /// correction on #1989: a build that exceeds this gate is PARKED (status
    /// <see cref="AccountCapPolicy.CappedStatus"/>), never silently downgraded —
    /// a build labeled Opus xhigh quietly running as Sonnet High is exactly the
    /// kind of thing that must never happen unannounced.
    /// </summary>
    public static class AccountCapPolicy
    {
        /// <summary>
        /// bt_build_queue.status value for a row that was claimed off the queue but
        /// deliberately never launched because the Conservation Cap toggle was on and
        /// its model/effort exceeded Sonnet High. Distinct from "queued" (so
        /// GetNextAsync's `WHERE status = 'queued'` naturally never reclaims it), from
        /// "failed" (this isn't an error — it's parked on purpose), and — critically —
        /// distinct from the unrelated #1638 "parked" staging status (Shane manually
        /// staging a build before it auto-runs). Reusing "parked" here would conflate
        /// two different concepts: a deliberate manual stage vs. an automatic cap park,
        /// and would corrupt #1638's own Parked filter/count/Un-park flow. Never
        /// reused as "held" either — that legacy status still has its own one-shot
        /// startup reclaim (QueueWatcherService.ReclaimLegacyHeldRowsAsync, Git #1479)
        /// which must keep running untouched for any leftover pre-#1479 row; parking at
        /// a genuinely new, distinct value means that reclaim can never race this cap.
        /// </summary>
        public const string CappedStatus = "capped";

        public static bool IsOpusModel(string? model) =>
            !string.IsNullOrWhiteSpace(model) && model.Contains("opus", StringComparison.OrdinalIgnoreCase);

        /// <summary>Git #1989 — Fable didn't exist when this policy was first written; it's
        /// above Sonnet and belongs in the same gate as Opus.</summary>
        public static bool IsFableModel(string? model) =>
            !string.IsNullOrWhiteSpace(model) && model.Contains("fable", StringComparison.OrdinalIgnoreCase);

        public static bool IsAboveHighEffort(string? effort) =>
            !string.IsNullOrWhiteSpace(effort) &&
            effort.Equals("xhigh", StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// The single shared gate: true for any Opus model, any Fable model, or any
        /// model run at xhigh effort. Sonnet at High (or below) always returns false.
        /// </summary>
        public static bool ExceedsSonnetHigh(string? model, string? effort) =>
            IsOpusModel(model) || IsFableModel(model) || IsAboveHighEffort(effort);
    }
}
