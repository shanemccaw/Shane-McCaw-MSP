using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3983 — one real, distinct color per bug lifecycle state, shared by the DOM inspector's
    /// in-page status icon (injected as JS) and the WPF bug-history detail window. Four states, not
    /// just red/green: Open, Verifying, Closed-Fixed, and Closed-NotABug each get their own color so
    /// a glance at the dot tells you which one it is.
    /// </summary>
    public static class ElementBugStatusPresenter
    {
        public const string OpenColor = "#EF4444";           // red — needs attention
        public const string VerifyingColor = "#F59E0B";       // amber — in progress
        public const string ClosedFixedColor = "#10B981";     // green — resolved
        public const string ClosedNotABugColor = "#64748B";   // slate — dismissed, deliberately not red or green

        /// <summary>Real color + human label for one entry's current status/resolution.</summary>
        public static (string Color, string Label) ColorAndLabelFor(VisualTestTrackerEntry entry)
        {
            if (string.Equals(entry.Status, "Closed", StringComparison.OrdinalIgnoreCase))
            {
                return string.Equals(entry.Resolution, "NotABug", StringComparison.OrdinalIgnoreCase)
                    ? (ClosedNotABugColor, "Closed — Not a Bug")
                    : (ClosedFixedColor, "Closed — Fixed");
            }

            if (string.Equals(entry.Status, "Verifying", StringComparison.OrdinalIgnoreCase))
                return (VerifyingColor, "Verifying");

            return (OpenColor, "Open");
        }
    }
}
