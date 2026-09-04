namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// One bill account's real shortfall status. Shortfall is null (not 0) when it genuinely
/// can't be computed — no target set, or Plaid hasn't returned a balance for this account —
/// so the dashboard can say "target not set" / "balance unknown" instead of silently
/// reporting a false $0 shortfall.
/// </summary>
public sealed record BillStatus(
    Guid AccountId,
    string Name,
    decimal? TargetAmount,
    decimal? CurrentBalance,
    bool IsGate,
    decimal? Shortfall,
    string? Warning);

public sealed record MerchantBleed(string Merchant, int TransactionCount, decimal TotalAmount);

public sealed record SpendAccountBleed(Guid AccountId, string Name, IReadOnlyList<MerchantBleed> Merchants, decimal TotalSpent);

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
    IReadOnlyList<SpendAccountBleed> SpendBleed)
{
    /// <summary>True = "Covered" (top-line is zero or positive). Only meaningful when TopLineAmount is non-null.</summary>
    public bool IsCovered => TopLineAmount is >= 0;
}
