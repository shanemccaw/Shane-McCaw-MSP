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

/// <summary>
/// Real transactions matched by a transaction_tags rule (#2931), grouped/summed by the rule's
/// own Tag rather than by raw merchant — e.g. "Ronnie's medication (cash): $360.00" surfaced
/// as its own line instead of being buried inside "7-Eleven: $1,310.12."
/// </summary>
public sealed record TaggedBleed(string Tag, int TransactionCount, decimal TotalAmount);

/// <summary>
/// Merchants excludes any transaction that matched a real transaction_tags rule — those are
/// pulled out into TaggedSpend instead, so a merchant's remaining total reflects only its
/// genuinely untagged spend. TotalSpent still covers everything (tagged + untagged) so the
/// account-level "total spend last 30 days" figure doesn't silently drop real spend.
/// </summary>
public sealed record SpendAccountBleed(
    Guid AccountId,
    string Name,
    IReadOnlyList<MerchantBleed> Merchants,
    IReadOnlyList<TaggedBleed> TaggedSpend,
    decimal TotalSpent);

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
