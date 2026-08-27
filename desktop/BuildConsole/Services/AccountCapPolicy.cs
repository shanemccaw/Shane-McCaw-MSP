using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1418 — Shane: "The secondary account needs to be limited to a max of
    /// Sonnet Medium so I can get 40 hours of build time out of it through the
    /// weekend. Is there a way to say if using secondary, never push a build that
    /// requires anything more than Sonnet Medium." Centralizes the real "exceeds
    /// Sonnet Medium" test — any Opus model, or Sonnet run at High/xhigh effort —
    /// so QueueWatcherService (the launch-time gate) and BuildQueuePanel (the
    /// bulk-resume/held-item display) share exactly one definition instead of
    /// two independently-drifting copies.
    /// </summary>
    public static class AccountCapPolicy
    {
        /// <summary>The real GitHub Milestone builds get parked on when they're capped off the secondary account. A visible, distinct label from the existing product milestones (v1.1/v1.2, etc).</summary>
        public const string SonnetPlusOverflowMilestoneTitle = "Sonnet+ Overflow";

        /// <summary>
        /// bt_build_queue.status value for an item that was claimed off the queue but
        /// deliberately never launched because it would have exceeded the secondary
        /// account's Sonnet Medium cap. Distinct from "queued" (so GetNextAsync's
        /// `WHERE status = 'queued'` naturally never reclaims it) and from "failed"
        /// (this isn't an error — it's parked on purpose, pending a manual bulk resume).
        /// </summary>
        public const string HeldStatus = "held";

        public static bool IsOpusModel(string? model) =>
            !string.IsNullOrWhiteSpace(model) && model.Contains("opus", StringComparison.OrdinalIgnoreCase);

        public static bool IsHighOrAboveEffort(string? effort) =>
            !string.IsNullOrWhiteSpace(effort) &&
            (effort.Equals("high", StringComparison.OrdinalIgnoreCase) ||
             effort.Equals("xhigh", StringComparison.OrdinalIgnoreCase));

        /// <summary>True when this model/effort combination genuinely requires more than Sonnet Medium — an Opus model at any effort, or Sonnet (or anything else) run at High/xhigh effort.</summary>
        public static bool ExceedsSonnetMedium(string? model, string? effort) =>
            IsOpusModel(model) || IsHighOrAboveEffort(effort);
    }
}
