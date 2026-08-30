using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Media;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1920 — coordinated accent-color assignment for build sets shown in Build Watch
    /// and the Build Queue panel.
    ///
    /// <para>The old <c>GetBuildSetBrush</c> was a pure function of <c>hash(name) % 10</c>
    /// against a fixed 10-color palette. It had no awareness of any other build set in play,
    /// so two different names hashing to the same bucket collided every time — Shane saw
    /// "Config-State-Core" and "Portal" render with the same background, visually
    /// indistinguishable.</para>
    ///
    /// <para>This registry replaces that with a real, coordinated assignment. Each surface
    /// declares the build sets it is currently showing via <see cref="ReportActive"/>; the
    /// registry keeps a stable <c>name → palette index</c> map and hands each newly-seen
    /// active set the lowest palette index NOT already in use by another currently-active
    /// set, so no two simultaneously-active sets ever share a color. A color is freed back to
    /// the pool once its set has nothing active/visible left in any surface (plus a short
    /// grace window so a set being actively rendered never flickers to a different color on a
    /// refresh tick), making it reusable by a different set later — a one-name-one-color-forever
    /// map is not sustainable with only 10 palette colors and unbounded build-set names.</para>
    ///
    /// <para><b>The &gt;10 edge case.</b> With a 10-color palette, if more than 10 distinct
    /// build sets are genuinely active at the exact same moment, true color uniqueness is
    /// mathematically impossible. Past the 10th active set the registry falls back to a
    /// deterministic per-name color (stable, so it still never flickers) and flags that set as
    /// <see cref="IsColorShared"/> = true, so the caller can layer on a secondary visual
    /// differentiator (Build Watch / the queue group header draw a dashed accent + "shared
    /// color" note) instead of silently colliding. See <see cref="GetBrush"/>.</para>
    /// </summary>
    public static class BuildSetColorRegistry
    {
        // The 10 palette resource keys, in assignment-preference order. Index 0 (Mauve) is also
        // the empty/ungrouped fallback, matching the pre-#1920 behavior.
        private static readonly string[] PaletteKeys =
        {
            "MauveBrush",
            "BlueBrush",
            "LavenderBrush",
            "SapphireBrush",
            "TealBrush",
            "SkyBrush",
            "GreenBrush",
            "PeachBrush",
            "YellowBrush",
            "MaroonBrush"
        };

        // How long a color stays reserved for a name after it was last requested/reported,
        // even once it drops out of every surface's active set. Prevents a set that is still
        // being rendered on a given tick from flickering to another color between polls.
        private static readonly TimeSpan FreeGrace = TimeSpan.FromSeconds(30);

        private static readonly object _gate = new();

        // Stable name → palette index. Kept as long as the name stays active (or within grace).
        private static readonly Dictionary<string, int> _assigned =
            new(StringComparer.OrdinalIgnoreCase);

        // Names that overflowed past the 10-color palette while all colors were in use — they
        // carry a deterministic (possibly shared) color and want a secondary differentiator.
        private static readonly HashSet<string> _overflow =
            new(StringComparer.OrdinalIgnoreCase);

        // Per-surface ("queue", "watch", …) set of build sets currently visible there.
        private static readonly Dictionary<string, HashSet<string>> _activeBySource =
            new(StringComparer.OrdinalIgnoreCase);

        // Last time each name was requested or reported active — feeds the grace window.
        private static readonly Dictionary<string, DateTime> _lastSeen =
            new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Declare the full set of build-set names a given surface is currently showing.
        /// Call this at the top of each render/poll pass, before the <see cref="GetBrush"/>
        /// calls for that surface. Names not visible in ANY surface (and past the grace
        /// window) have their color freed for reuse.
        /// </summary>
        public static void ReportActive(string source, IEnumerable<string> names)
        {
            if (string.IsNullOrEmpty(source)) return;
            var set = new HashSet<string>(
                (names ?? Enumerable.Empty<string>()).Where(n => !string.IsNullOrWhiteSpace(n)),
                StringComparer.OrdinalIgnoreCase);

            lock (_gate)
            {
                _activeBySource[source] = set;
                var now = DateTime.UtcNow;
                foreach (var n in set) _lastSeen[n] = now;
                Prune(now);
            }
        }

        /// <summary>Number of distinct palette colors available (10).</summary>
        public static int PaletteSize => PaletteKeys.Length;

        /// <summary>
        /// The palette index (0..<see cref="PaletteSize"/>-1) currently assigned to a build
        /// set, assigning one on first sight exactly like <see cref="GetBrush"/> but WITHOUT
        /// resolving the WPF brush resource — so the coordination logic is drivable off the UI
        /// thread (diagnostics / collision tests). Returns -1 for a null/blank name (which maps
        /// to the shared Mauve fallback, not a coordinated slot).
        /// </summary>
        public static int GetPaletteIndex(string? buildSetName)
        {
            if (string.IsNullOrWhiteSpace(buildSetName)) return -1;
            lock (_gate)
            {
                _lastSeen[buildSetName] = DateTime.UtcNow;
                if (!_assigned.TryGetValue(buildSetName, out int index))
                {
                    index = Allocate(buildSetName);
                    _assigned[buildSetName] = index;
                }
                return index;
            }
        }

        /// <summary>
        /// Resolve the accent brush for a build set, assigning it a coordinated,
        /// collision-free palette color on first sight. Safe to call on the UI thread only
        /// (it resolves WPF resources).
        /// </summary>
        public static Brush GetBrush(string? buildSetName)
        {
            int index = GetPaletteIndex(buildSetName);
            if (index < 0)
                return (Brush)Application.Current.FindResource("MauveBrush");
            return (Brush)Application.Current.FindResource(PaletteKeys[index]);
        }

        /// <summary>
        /// True once this build set was assigned while all 10 palette colors were already
        /// taken by other currently-active sets — its color is deterministic but may be
        /// shared, so a secondary visual differentiator should be layered on. False in the
        /// normal (≤10 active sets) case.
        /// </summary>
        public static bool IsColorShared(string? buildSetName)
        {
            if (string.IsNullOrWhiteSpace(buildSetName)) return false;
            lock (_gate) return _overflow.Contains(buildSetName);
        }

        // Lowest palette index not currently used by another assigned (active) set. If every
        // color is taken (>10 concurrently active), fall back to a deterministic per-name
        // index so the color is at least stable, and flag the set as overflow so callers can
        // add a secondary differentiator instead of silently colliding.
        private static int Allocate(string name)
        {
            var used = new HashSet<int>(_assigned.Values);
            for (int i = 0; i < PaletteKeys.Length; i++)
            {
                if (!used.Contains(i))
                {
                    _overflow.Remove(name);
                    return i;
                }
            }

            int hash = 0;
            foreach (char c in name) hash = (hash * 31) + c;
            _overflow.Add(name);
            return Math.Abs(hash) % PaletteKeys.Length;
        }

        // Release the color of any assigned name that is no longer visible in any surface and
        // hasn't been requested within the grace window.
        private static void Prune(DateTime now)
        {
            var union = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var s in _activeBySource.Values) union.UnionWith(s);

            var stale = _assigned.Keys
                .Where(k => !union.Contains(k)
                            && (!_lastSeen.TryGetValue(k, out var t) || now - t > FreeGrace))
                .ToList();

            foreach (var k in stale)
            {
                _assigned.Remove(k);
                _overflow.Remove(k);
                _lastSeen.Remove(k);
            }
        }
    }
}
