using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4442 — one real observation of a page's DOM: the mutations seen during a short observation
    /// window, plus the page's stable structural element keys at the end of it.
    /// </summary>
    public sealed class DomPageObservation
    {
        public List<DomMutationRecord> Mutations { get; set; } = new();

        /// <summary>"TAG|selector" for every element carrying a data-testid or a non-generated id.</summary>
        public List<string> StructureKeys { get; set; } = new();

        public DateTime ObservedAt { get; set; } = DateTime.Now;

        /// <summary>The document URL the observation was taken on.</summary>
        public string Href { get; set; } = "";
    }

    /// <summary>
    /// Git #4442 — the ONE comparison between a stored DOM baseline and a live observation, shared by
    /// the Test Mode navigation auto-check banner and <c>DomDriftDiffWindow</c> so both report the same
    /// drift. Before this, the window treated every live mutation as drift, which made "only show a
    /// banner if the diff changed" meaningless — routine mutations (a ticking clock, a spinner) were
    /// reported every time.
    ///
    /// Drift is:
    ///  1. live mutations whose signature (type, action, tag, normalized selector, attribute) is not
    ///     already in the baseline — values and timestamps are deliberately NOT part of the signature, so
    ///     a clock's text changing is the same routine mutation every visit; and
    ///  2. structural keys present live but not in the baseline ("added"), or in the baseline but gone
    ///     live ("removed") — only when the baseline actually has a structural snapshot.
    /// </summary>
    public static class DomBaselineDiff
    {
        public const string StructureType = "structure";

        private static readonly Regex NthOfType = new(@":nth-of-type\(\d+\)", RegexOptions.Compiled);

        /// <summary>Identity of a mutation for baseline matching. List positions are normalized
        /// (li:nth-of-type(7) ≡ li:nth-of-type(8)) so a list growing by one row isn't a new signature.</summary>
        public static string SignatureOf(DomMutationRecord m)
        {
            string selector = NthOfType.Replace(m.Selector ?? "", ":nth-of-type(n)");
            return string.Join("|",
                (m.Type ?? "").ToLowerInvariant(),
                (m.Action ?? "").ToLowerInvariant(),
                (m.Tag ?? "").ToUpperInvariant(),
                selector,
                (m.AttributeName ?? "").ToLowerInvariant());
        }

        /// <summary>Real drift of <paramref name="live"/> against <paramref name="baseline"/>, one record
        /// per distinct signature. With no baseline at all there is nothing to drift from, so every
        /// distinct live mutation is returned (what "Accept" would record as the initial baseline).</summary>
        public static List<DomMutationRecord> ComputeDrift(VisualTestTrackerDomBaseline? baseline, DomPageObservation live)
        {
            var known = new HashSet<string>(
                (baseline?.Mutations ?? new List<DomMutationRecord>()).Select(SignatureOf),
                StringComparer.Ordinal);

            var drift = new List<DomMutationRecord>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in live.Mutations ?? new List<DomMutationRecord>())
            {
                if (string.Equals(m.Type, StructureType, StringComparison.OrdinalIgnoreCase)) continue;
                string sig = SignatureOf(m);
                if (known.Contains(sig) || !seen.Add(sig)) continue;
                drift.Add(m);
            }

            if (baseline != null && baseline.HasStructureSnapshot)
            {
                var baseKeys = new HashSet<string>(baseline.StructureKeys ?? new List<string>(), StringComparer.Ordinal);
                var liveKeys = new HashSet<string>(live.StructureKeys ?? new List<string>(), StringComparer.Ordinal);
                string stamp = live.ObservedAt.ToString("HH:mm:ss");

                foreach (var key in liveKeys.Where(k => !baseKeys.Contains(k)).OrderBy(k => k, StringComparer.Ordinal))
                    drift.Add(StructureRecord(key, "added", "Element present live but not in the baseline", stamp));
                foreach (var key in baseKeys.Where(k => !liveKeys.Contains(k)).OrderBy(k => k, StringComparer.Ordinal))
                    drift.Add(StructureRecord(key, "removed", "Element in the baseline is no longer present", stamp));
            }

            return drift;
        }

        /// <summary>The baseline that results from accepting <paramref name="live"/>: the union of known
        /// mutation signatures (nothing already accepted is forgotten) and the live structure as the new
        /// structural snapshot.</summary>
        public static VisualTestTrackerDomBaseline MergeIntoBaseline(
            VisualTestTrackerDomBaseline? baseline, DomPageObservation live, string baseUrl, string pagePath)
        {
            var merged = new List<DomMutationRecord>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var m in (baseline?.Mutations ?? new List<DomMutationRecord>()).Concat(live.Mutations ?? new List<DomMutationRecord>()))
            {
                if (string.Equals(m.Type, StructureType, StringComparison.OrdinalIgnoreCase)) continue;
                if (seen.Add(SignatureOf(m))) merged.Add(m);
            }

            return new VisualTestTrackerDomBaseline
            {
                Id = baseline?.Id ?? 0,
                PageId = baseline?.PageId ?? 0,
                BaseUrl = baseUrl,
                PagePath = pagePath,
                Mutations = merged,
                StructureKeys = (live.StructureKeys ?? new List<string>()).Distinct(StringComparer.Ordinal).ToList(),
                HasStructureSnapshot = true,
                CreatedAt = baseline?.CreatedAt ?? DateTime.Now,
                LastVerifiedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            };
        }

        /// <summary>Violations in <paramref name="current"/> whose (rule, selector) wasn't in
        /// <paramref name="previous"/> — "new since the last audit".</summary>
        public static List<AccessibilityViolation> NewViolations(
            IEnumerable<AccessibilityViolation>? previous, IEnumerable<AccessibilityViolation>? current)
        {
            static string Key(AccessibilityViolation v) => $"{v.Rule}|{v.Selector}";
            var known = new HashSet<string>((previous ?? Enumerable.Empty<AccessibilityViolation>()).Select(Key), StringComparer.Ordinal);
            return (current ?? Enumerable.Empty<AccessibilityViolation>()).Where(v => !known.Contains(Key(v))).ToList();
        }

        private static DomMutationRecord StructureRecord(string key, string action, string description, string stamp)
        {
            int sep = key.IndexOf('|');
            return new DomMutationRecord
            {
                Type = StructureType,
                Action = action,
                Tag = sep > 0 ? key.Substring(0, sep) : "",
                Selector = sep > 0 ? key.Substring(sep + 1) : key,
                TargetDescription = description,
                Timestamp = stamp,
            };
        }
    }
}
