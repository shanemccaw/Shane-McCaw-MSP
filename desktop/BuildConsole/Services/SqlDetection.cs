using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3828 — real SQL-input detection for the Command Center palette (Ctrl+K).
    /// Mirrors the existing, already-shipped heuristic in
    /// <see cref="ChatButtonInjector"/>'s <c>SQL_BLOCK_RE</c> (the JS classifier that
    /// tags a claude.ai chat code block as "sql") so the palette recognizes the same
    /// shapes of SQL Shane already gets "Send to Builder" treatment for in chat,
    /// rather than inventing a second, divergent heuristic. Also supports an explicit
    /// <c>sql:</c> prefix for a query that wouldn't otherwise be caught (e.g. one that
    /// starts with a table name via a bare statement the regex doesn't recognize).
    /// </summary>
    public static class SqlDetection
    {
        public const string ExplicitPrefix = "sql:";

        // Same keyword set/shape as ChatButtonInjector.cs's SQL_BLOCK_RE: skip any
        // leading "-- ..." comment lines, then match a real statement keyword at the
        // start. Deliberately case-insensitive, deliberately anchored (a prose search
        // query that merely mentions "delete" mid-sentence must not trip this).
        private static readonly Regex SqlLeadingRegex = new(
            @"^\s*(--.*\n)*\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|BEGIN|GRANT|REVOKE|TRUNCATE|EXPLAIN)\b",
            RegexOptions.IgnoreCase);

        /// <summary>
        /// True if <paramref name="text"/> is real SQL input — either it starts with the
        /// explicit <c>sql:</c> prefix, or it matches the same leading-keyword shape the
        /// chat code-block classifier already uses.
        /// </summary>
        public static bool LooksLikeSqlQuery(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            string trimmed = text.TrimStart();
            if (trimmed.StartsWith(ExplicitPrefix, System.StringComparison.OrdinalIgnoreCase))
                return trimmed.Length > ExplicitPrefix.Length && trimmed[ExplicitPrefix.Length..].Trim().Length > 0;
            return SqlLeadingRegex.IsMatch(text);
        }

        /// <summary>Strips a leading <c>sql:</c> prefix (if present) and trims the rest — the actual query text to run.</summary>
        public static string ExtractQuery(string? text)
        {
            string trimmed = (text ?? "").TrimStart();
            if (trimmed.StartsWith(ExplicitPrefix, System.StringComparison.OrdinalIgnoreCase))
                return trimmed[ExplicitPrefix.Length..].Trim();
            return (text ?? "").Trim();
        }
    }
}
