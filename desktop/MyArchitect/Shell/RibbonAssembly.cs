using System;
using System.Collections.Generic;
using System.Linq;

namespace MyArchitect.Shell;

/// <summary>
/// Trail + Back-group injection + fixed-tab group merging — ported from AdminV2's
/// <c>registry/ribbonAssembly.ts</c> (see <c>artifacts/admin-panel/src/adminv2/SHELL.md</c> §2).
/// A screen/Feature never hand-authors a Back group; the shell always splices one in.
/// </summary>
public static class RibbonAssembly
{
    private const int TrailCap = 6;

    /// <summary>Most-recent-first, deduped on Kind:Id, capped at <see cref="TrailCap"/>.</summary>
    public static List<TrailEntry> PushTrail(List<TrailEntry> trail, TrailEntry entry)
    {
        var next = new List<TrailEntry> { entry };
        next.AddRange(trail.Where(t => !(t.Kind == entry.Kind && t.Id == entry.Id)));
        if (next.Count > TrailCap)
        {
            next.RemoveRange(TrailCap, next.Count - TrailCap);
        }
        return next;
    }

    /// <summary>
    /// Builds the Back group: <c>trail[0]</c> is where you *are*, so the large button is
    /// <c>trail[1]</c> (wherever you just came from); below it the two before that; then
    /// "Search everything". Never hidden — when there's nowhere to go back to, the group still
    /// renders with only Search, because hiding it would shift every other group one position
    /// left (the exact instability this exists to prevent).
    /// </summary>
    public static RibbonGroupSpec BackGroupFrom(List<TrailEntry> trail, Action onSearchEverything)
    {
        var group = new RibbonGroupSpec { Label = "Back", Order = -1 };

        if (trail.Count > 1)
        {
            var backTo = trail[1];
            group.Large.Add(new RibbonCommandSpec
            {
                Label = backTo.Label,
                Intent = RibbonIntent.Open,
                OnSelect = backTo.Open,
            });

            foreach (var t in trail.Skip(2).Take(2))
            {
                group.Small.Add(new RibbonCommandSpec
                {
                    Label = t.Label,
                    Intent = RibbonIntent.Open,
                    OnSelect = t.Open,
                });
            }
        }

        group.Small.Add(new RibbonCommandSpec
        {
            Label = "Search everything",
            Intent = RibbonIntent.Open,
            OnSelect = onSearchEverything,
        });

        return group;
    }

    /// <summary>
    /// Splices the Back group at position 2 (index 1) of a contextual tab's own groups — never
    /// position 0, so a contextual tab's own most-important group can still lead.
    /// </summary>
    public static List<RibbonGroupSpec> AssembleContextualGroups(
        ContextualTabSpec spec, List<TrailEntry> trail, Action onSearchEverything)
    {
        var back = BackGroupFrom(trail, onSearchEverything);
        var result = new List<RibbonGroupSpec>();
        var own = spec.Groups.OrderBy(g => g.Order).ToList();

        if (own.Count > 0) result.Add(own[0]);
        result.Add(back);
        result.AddRange(own.Skip(1));
        return result;
    }

    /// <summary>
    /// Merges groups that share a <see cref="RibbonGroupSpec.Label"/> on the same fixed tab into
    /// one physical box (UI_RULES.md §2 — Watch is fed by Alerts #3483, SLA breaches #3487 and
    /// the Task Queue #3490; each gets its own alert but they render as one themed box, not three
    /// tabs). The merged box sorts at whichever contributor asked for the lowest Order.
    /// </summary>
    public static List<RibbonGroupSpec> MergeGroupsByLabel(IEnumerable<RibbonGroupSpec> groups)
    {
        var merged = new Dictionary<string, RibbonGroupSpec>(StringComparer.Ordinal);
        var order = new List<string>();

        foreach (var g in groups)
        {
            if (!merged.TryGetValue(g.Label, out var existing))
            {
                merged[g.Label] = new RibbonGroupSpec { Label = g.Label, Order = g.Order };
                order.Add(g.Label);
                existing = merged[g.Label];
            }
            else if (g.Order < existing.Order)
            {
                // Re-key with the lower order while keeping the same accumulated command lists.
                merged[g.Label] = new RibbonGroupSpec { Label = g.Label, Order = g.Order, Large = existing.Large, Small = existing.Small };
                existing = merged[g.Label];
            }

            existing.Large.AddRange(g.Large);
            existing.Small.AddRange(g.Small);
        }

        return order.Select(l => merged[l]).OrderBy(g => g.Order).ToList();
    }
}
