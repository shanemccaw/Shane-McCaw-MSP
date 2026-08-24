using System;
using System.Text;

namespace BuildConsole.Services
{
    /// <summary>
    /// Local (--notGit) build identifiers as a LETTER sequence: A, B, C … Z, AA, AB …
    ///
    /// ── Why letters at all? ──────────────────────────────────────────────────────
    /// Shane: "we need to change the --notGit number sequence because #109 as an
    /// example would be in Git… Can we do this in letters or something?" Real GitHub
    /// issues are always plain numeric; local --notGit builds used to be plain numeric
    /// too, so a bare "#109" was genuinely ambiguous — could be a real GitHub issue OR
    /// a local reference. Moving local identifiers to a distinct LETTER namespace makes
    /// a local id un-mistakable for a GitHub number *by construction*, not by convention.
    ///
    /// ── How it maps onto the existing storage ────────────────────────────────────
    /// The Build Queue already stores a local build as a NEGATIVE github_number (-N);
    /// GitHub issues are positive. That negative trick already separates the two at the
    /// DB/storage layer — the ambiguity was only ever at the *input / display* edge
    /// (what a human types or reads). So letters live purely at those edges: a local
    /// build with ordinal <c>k</c> is stored as github_number = -k and shown / typed as
    /// its letters <c>Letters(k)</c>. No DB / schema change is required — the ordinal IS
    /// the absolute value of the negative github_number.
    ///
    /// The mapping is the classic bijective base-26 ("spreadsheet column") scheme so it
    /// is a true 1:1 function with no zero/leading-A ambiguity:
    ///   1→A  2→B … 26→Z  27→AA  28→AB … 52→AZ  53→BA … 702→ZZ  703→AAA …
    /// </summary>
    public static class LocalBuildId
    {
        /// <summary>
        /// ordinal (1-based) → letters. Throws for ordinal &lt; 1 (there is no letter for
        /// zero or a negative ordinal — callers pass |github_number|, always ≥ 1).
        /// </summary>
        public static string ToLetters(int ordinal)
        {
            if (ordinal < 1)
                throw new ArgumentOutOfRangeException(nameof(ordinal), ordinal,
                    "Local build ordinal must be >= 1 (letters start at A = 1).");

            var sb = new StringBuilder();
            int n = ordinal;
            while (n > 0)
            {
                n--;                                   // shift into 0-based for the digit
                sb.Insert(0, (char)('A' + (n % 26)));
                n /= 26;
            }
            return sb.ToString();
        }

        /// <summary>
        /// letters → ordinal (1-based). Case-insensitive. Returns false for anything that
        /// is not a pure run of ASCII letters (empty, digits, punctuation, "-3", "12A"…).
        /// </summary>
        public static bool TryFromLetters(string? token, out int ordinal)
        {
            ordinal = 0;
            if (string.IsNullOrWhiteSpace(token)) return false;

            long n = 0;
            foreach (char raw in token.Trim())
            {
                char c = char.ToUpperInvariant(raw);
                if (c < 'A' || c > 'Z') return false;  // not a pure-letter token
                n = (n * 26) + (c - 'A' + 1);
                if (n > int.MaxValue) return false;    // absurdly long token — reject
            }
            if (n < 1) return false;
            ordinal = (int)n;
            return true;
        }

        /// <summary>True iff <paramref name="token"/> is a pure run of ASCII letters.</summary>
        public static bool IsLetterToken(string? token) => TryFromLetters(token, out _);

        /// <summary>
        /// Render a queue-row identity (github_number) for humans: a positive number is a
        /// real GitHub issue ("#123"); a negative number is a LOCAL build shown by its
        /// letters ("local #C"). Single source of truth for every "how do I print this
        /// build's id" spot so the letter scheme can never drift between call sites.
        /// </summary>
        public static string FormatRef(int githubNumber)
        {
            if (githubNumber < 0) return $"local #{ToLetters(-githubNumber)}";
            return $"#{githubNumber}";
        }
    }
}
