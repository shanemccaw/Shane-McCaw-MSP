namespace ShanesSurvival.Core.PayPeriodPlans;

/// <summary>
/// Matches the pay_period_plans.status TEXT column (migrations/004_pay_period_plans.sql), which
/// is the source of truth; this enum exists purely for type-safe C# handling of that same small,
/// fixed vocabulary. No tool in this pass sets Completed directly — a plan is marked Completed
/// automatically once every one of its allocations has been executed.
/// </summary>
public enum PlanStatus
{
    Proposed,
    Active,
    Completed,
}

public static class PlanStatusExtensions
{
    public static string ToDbValue(this PlanStatus status) => status switch
    {
        PlanStatus.Proposed => "proposed",
        PlanStatus.Active => "active",
        PlanStatus.Completed => "completed",
        _ => "active",
    };

    public static PlanStatus ParseDbValue(string value) => value switch
    {
        "proposed" => PlanStatus.Proposed,
        "completed" => PlanStatus.Completed,
        _ => PlanStatus.Active,
    };
}

/// <summary>
/// One real allocation line as supplied by a caller (MCP tool argument) — accounts are named,
/// not GUIDs, matching the same case-insensitive-by-name convention
/// <see cref="Mcp.Tools.FinanceTools"/>'s <c>recent_transactions</c> already uses, since Claude
/// Desktop only ever sees real account names from the other tools, never a raw account id.
/// </summary>
public sealed record AllocationInput(string AccountName, decimal Amount, string? Reason);

/// <summary>
/// One real allocation line as persisted/read back — resolved to its real account, with the
/// account's current real Plaid balance alongside it so a progress check
/// (<c>get_active_pay_period_plan</c>) is grounded in what has actually landed, not just what
/// the plan says should happen.
/// </summary>
public sealed record PlanAllocationRow(
    Guid Id,
    Guid AccountId,
    string AccountName,
    decimal Amount,
    string? Reason,
    bool Executed,
    DateTimeOffset? ExecutedAt,
    decimal? CurrentBalance);

public sealed record PayPeriodPlanRow(
    Guid Id,
    DateOnly PayDate,
    decimal IncomeAmount,
    PlanStatus Status,
    string? Notes,
    DateTimeOffset CreatedAt,
    IReadOnlyList<PlanAllocationRow> Allocations);

public sealed record PlanResult(bool Success, PayPeriodPlanRow? Plan, string? ErrorMessage);

public sealed record PlanWriteResult(bool Success, Guid? PlanId, string? ErrorMessage);

public sealed record AllocationWriteResult(bool Success, string? ErrorMessage);
