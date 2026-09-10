using System;
using System.Collections.Generic;
using System.Linq;

namespace MyArchitect.Models;

/// <summary>
/// Pure client-side port of the server's own freeze/maintenance matching —
/// <c>portal-change-freeze.ts</c>'s <c>isWindowActiveAt</c>/
/// <c>matchesFreezeScope</c> and <c>portal-change-maintenance.ts</c>'s
/// <c>spanWithinMaintenanceWindow</c>/<c>matchesMaintenanceScope</c> — evaluated
/// at a single instant (<c>spanEnd: null</c>'s "point in time" case both server
/// functions already support) rather than a booked span, because the real gap
/// #3482 fills is a check surfaced right before execution: "is a freeze/
/// maintenance concern live RIGHT NOW for this change", not "was the change's
/// original booking inside/outside one". No server endpoint runs this check at
/// execution time — msp-change-executions.ts's human-action/attest routes never
/// touch either calendar — so this is the client's own real evaluation over the
/// real windows GET /api/msp/change-freeze-windows and
/// GET /api/msp/change-maintenance-windows already return.
/// </summary>
public static class ChangeCalendarMatching
{
    private const int MaxOccurrences = 10_000;

    /// <summary>Stored `category` → the workload label the freeze/maintenance scope
    /// tables key on. Mirrors portal-change-control.ts's WORKLOAD_BY_CATEGORY; an
    /// unrecognized category falls back to "Identity", same as the server.</summary>
    private static readonly Dictionary<string, string> WorkloadByCategory = new(StringComparer.Ordinal)
    {
        ["ConditionalAccess"] = "Conditional Access",
        ["Exchange"] = "Exchange / mail",
        ["Identity"] = "Identity",
        ["Intune"] = "Intune",
        ["Defender"] = "Defender",
        ["SharePoint"] = "SharePoint",
        ["Purview"] = "Purview",
        ["Teams"] = "Teams",
    };

    public static string WorkloadForCategory(string category) =>
        WorkloadByCategory.TryGetValue(category ?? string.Empty, out var workload) ? workload : "Identity";

    private static DateTimeOffset AddPeriod(DateTimeOffset date, string recurrence, int count)
    {
        return recurrence switch
        {
            "weekly" => date.AddDays(7 * count),
            "monthly" => date.AddMonths(count),
            "quarterly" => date.AddMonths(3 * count),
            "annually" => date.AddYears(count),
            _ => date,
        };
    }

    private static bool ScopeMatches(string scope, string? scopeTenantId, string? scopeWorkload, string tenantId, string workload)
    {
        return scope switch
        {
            "global" => true,
            "tenant" => string.Equals(scopeTenantId ?? string.Empty, tenantId, StringComparison.OrdinalIgnoreCase),
            "workload" => string.Equals(scopeWorkload ?? string.Empty, workload, StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    /// <summary>Port of <c>isWindowActiveAt</c> — whether <paramref name="now"/> falls inside
    /// a live occurrence of this freeze window.</summary>
    private static bool IsFreezeWindowActiveAt(ChangeFreezeWindow window, DateTimeOffset now)
    {
        if (!window.Active) return false;
        var durationMs = (window.EndsAt - window.StartsAt).TotalMilliseconds;
        if (durationMs <= 0) return false;

        if (window.Recurrence == "none")
        {
            return now >= window.StartsAt && now < window.EndsAt;
        }

        DateTimeOffset? lastStart = null;
        for (var i = 0; i < MaxOccurrences; i++)
        {
            var occStart = AddPeriod(window.StartsAt, window.Recurrence, i);
            if (window.RecurrenceUntil is { } until && occStart > until) break;
            if (occStart > now) break;
            lastStart = occStart;
        }
        if (lastStart is null) return false;
        var occEnd = lastStart.Value.AddMilliseconds(durationMs);
        return now < occEnd;
    }

    /// <summary>Port of <c>spanWithinMaintenanceWindow</c> called at a single instant
    /// (the null-<c>spanEnd</c> point-in-time case) — whether <paramref name="now"/> falls
    /// inside a live occurrence of this maintenance window.</summary>
    private static bool IsMaintenanceWindowCoveringAt(ChangeMaintenanceWindow window, DateTimeOffset now)
    {
        if (!window.Active) return false;
        var durationMs = (window.EndsAt - window.StartsAt).TotalMilliseconds;
        if (durationMs <= 0) return false;

        if (window.Recurrence == "none")
        {
            return now >= window.StartsAt && now < window.EndsAt;
        }

        for (var i = 0; i < MaxOccurrences; i++)
        {
            var occStart = AddPeriod(window.StartsAt, window.Recurrence, i);
            if (window.RecurrenceUntil is { } until && occStart > until) break;
            if (occStart > now) break;
            var occEnd = occStart.AddMilliseconds(durationMs);
            if (now < occEnd) return true;
        }
        return false;
    }

    /// <summary>The most specific active freeze blocking (tenantId, workload) right now, or
    /// null if none applies. Candidates are ranked tenant &gt; workload &gt; global, same
    /// order <c>candidateFreezeWindows</c> sorts server-side, so the most specific rule in
    /// effect is the one reported.</summary>
    public static ChangeFreezeWindow? FindActiveFreezeNow(
        IEnumerable<ChangeFreezeWindow> windows, string tenantId, string workload, DateTimeOffset now)
    {
        var rank = new Dictionary<string, int> { ["tenant"] = 0, ["workload"] = 1, ["global"] = 2 };
        var ordered = windows
            .Where(w => w.Active && ScopeMatches(w.Scope, w.TenantId, w.Workload, tenantId, workload))
            .OrderBy(w => rank.TryGetValue(w.Scope, out var r) ? r : 3);
        foreach (var w in ordered)
        {
            if (IsFreezeWindowActiveAt(w, now)) return w;
        }
        return null;
    }

    /// <summary>The most specific maintenance window covering (tenantId, workload) right now,
    /// or null if none covers it. A null result means the change would be executing OUTSIDE
    /// every standing maintenance rule — a real fact worth surfacing, not necessarily a hard
    /// block (unlike freeze, maintenance coverage is advisory here — the server itself only
    /// enforces it against a change's originally BOOKED span at submission, never at
    /// execution time).</summary>
    public static ChangeMaintenanceWindow? FindMaintenanceCoverageNow(
        IEnumerable<ChangeMaintenanceWindow> windows, string tenantId, string workload, DateTimeOffset now)
    {
        var rank = new Dictionary<string, int> { ["tenant"] = 0, ["workload"] = 1, ["global"] = 2 };
        var ordered = windows
            .Where(w => w.Active && ScopeMatches(w.Scope, w.TenantId, w.Workload, tenantId, workload))
            .OrderBy(w => rank.TryGetValue(w.Scope, out var r) ? r : 3);
        foreach (var w in ordered)
        {
            if (IsMaintenanceWindowCoveringAt(w, now)) return w;
        }
        return null;
    }
}
