namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// One real forecast cycle (#2918) — the due-window math from <see cref="PayPeriodDueService"/>
/// plus what it's being measured against (available funds for Cycle 1, expected paycheck total
/// for Cycle 2) and the resulting covered/short verdict. AvailableAmount is null (not 0) when it
/// genuinely can't be computed (e.g. Income Gate balance unknown, or no active income source has
/// expected_per_cycle set) — same null-means-unknown convention as the rest of this app, so the
/// verdict can say so instead of silently reporting a false covered/short.
/// </summary>
public sealed record PayPeriodForecastCycle(
    DateOnly WindowStart,
    DateOnly WindowEnd,
    IReadOnlyList<DueBill> DueBills,
    decimal TotalDue,
    decimal? AvailableAmount,
    IReadOnlyList<string> Warnings)
{
    public decimal? Delta => AvailableAmount is null ? null : AvailableAmount.Value - TotalDue;
    public bool? IsCovered => Delta is null ? null : Delta.Value >= 0;
}

public sealed record PayPeriodForecastResult(
    bool Success,
    string? ErrorMessage,
    string? PrimarySourceName,
    PayPeriodForecastCycle? Cycle1,
    PayPeriodForecastCycle? Cycle2);
