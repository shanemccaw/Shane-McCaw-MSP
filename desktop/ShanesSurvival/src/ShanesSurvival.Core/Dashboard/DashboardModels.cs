namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// One bill account's real shortfall status. Shortfall is null (not 0) when it genuinely
/// can't be computed — no target set, or Plaid hasn't returned a balance for this account —
/// so the dashboard can say "target not set" / "balance unknown" instead of silently
/// reporting a false $0 shortfall. LastPaidDate (#2912) is purely informational here — it
/// doesn't change this record's own shortfall math (current balance vs. target), a separate
/// real question from "is this cycle's payment already made"; that question is answered by
/// <see cref="PayPeriodDueService"/> instead.
/// </summary>
public sealed record BillStatus(
    Guid AccountId,
    string Name,
    decimal? TargetAmount,
    decimal? CurrentBalance,
    bool IsGate,
    decimal? Shortfall,
    string? Warning,
    DateOnly? LastPaidDate);

public sealed record MerchantBleed(string Merchant, int TransactionCount, decimal TotalAmount);

public sealed record SpendAccountBleed(Guid AccountId, string Name, IReadOnlyList<MerchantBleed> Merchants, decimal TotalSpent);

/// <summary>
/// One real role = 'reserve' account's real current Plaid balance (#2909) — usable reserve
/// money that isn't the primary Income Gate account but should still count toward "can I
/// actually cover this." CurrentBalance is null (not 0) when Plaid hasn't returned a balance
/// yet, same convention as BillStatus, so it can be excluded from ReserveTotal and called out
/// in Warnings instead of silently counted as $0.
/// </summary>
public sealed record ReserveAccountBalance(Guid AccountId, string Name, decimal? CurrentBalance);

public sealed record DashboardResult(
    bool Success,
    string? ErrorMessage,
    IReadOnlyList<string> Warnings,
    decimal? IncomeGateBalance,
    string? IncomeGateAccountName,
    IReadOnlyList<BillStatus> GateBills,
    IReadOnlyList<BillStatus> OtherBills,
    decimal TotalShortfall,
    decimal? TopLineAmount,
    IReadOnlyList<SpendAccountBleed> SpendBleed,
    IReadOnlyList<ReserveAccountBalance> ReserveAccounts,
    decimal ReserveTotal,
    decimal? TotalAvailable)
{
    /// <summary>True = "Covered" (top-line is zero or positive). Only meaningful when TopLineAmount is non-null.</summary>
    public bool IsCovered => TopLineAmount is >= 0;
}
