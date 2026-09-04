using System.ComponentModel;
using System.Globalization;
using System.Text;
using ModelContextProtocol.Server;
using ShanesSurvival.Core.PayPeriodPlans;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.Mcp.Tools;

/// <summary>
/// Real write MCP tools for the Pay-Period Plan (#2892), on top of #2887's read-only tools.
/// No programmatic money movement of any kind — every tool here only ever writes a plan row to
/// this app's own Postgres database (via <see cref="PayPeriodPlanRepository"/>); Shane still
/// executes each real transfer manually in his own bank's app (Navy Federal — no programmatic
/// transfer capability exists, confirmed 2026-09-04) and reports it back via
/// <see cref="MarkAllocationExecutedAsync"/>.
/// </summary>
[McpServerToolType]
public sealed class PayPeriodPlanTools(SettingsService settingsService, PayPeriodPlanRepository planRepository)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "create_pay_period_plan")]
    [Description(
        "Creates a new real pay-period plan (immediately Active) allocating a real paycheck " +
        "across real bill/spend accounts. Each allocation names a real account exactly as shown " +
        "by gate_status/bill_status/spend_bleed — an unrecognized name fails the whole call, " +
        "nothing is written. This only writes a plan to this app's own database; Shane still " +
        "has to make each real transfer himself in his bank's app.")]
    public async Task<string> CreatePayPeriodPlanAsync(
        [Description("The real paycheck amount, in dollars.")]
        decimal incomeAmount,
        [Description("The real pay date, e.g. 2026-09-05.")]
        DateOnly payDate,
        [Description("The real allocations making up this plan — at least one required.")]
        AllocationInput[] allocations,
        [Description("Optional real notes about this plan.")]
        string? notes = null)
    {
        var result = await planRepository.CreateAsync(ConnectionString, incomeAmount, payDate, notes, allocations);
        if (!result.Success)
        {
            return $"Could not create pay-period plan: {result.ErrorMessage}";
        }

        return $"Created pay-period plan {result.PlanId} for {payDate:yyyy-MM-dd} " +
               $"({Money(incomeAmount)} across {allocations.Length} allocation(s)). Status: active.";
    }

    [McpServerTool(Name = "revise_pay_period_plan")]
    [Description(
        "Mid-cycle adjustment to an existing pay-period plan: replaces every allocation that " +
        "hasn't been executed yet with the new list. Allocations already marked executed are " +
        "left untouched — this can never erase the record of a real transfer that already " +
        "happened. Use get_active_pay_period_plan first to get the real plan id.")]
    public async Task<string> RevisePayPeriodPlanAsync(
        [Description("The real plan id to revise, from get_active_pay_period_plan.")]
        Guid planId,
        [Description("The full real replacement set of not-yet-executed allocations — at least one required.")]
        AllocationInput[] newAllocations)
    {
        var result = await planRepository.ReviseAsync(ConnectionString, planId, newAllocations);
        if (!result.Success)
        {
            return $"Could not revise pay-period plan: {result.ErrorMessage}";
        }

        return $"Revised pay-period plan {result.PlanId} — now {newAllocations.Length} " +
               "not-yet-executed allocation(s); previously executed allocations are unchanged.";
    }

    [McpServerTool(Name = "mark_allocation_executed")]
    [Description(
        "Records that Shane actually made one real transfer in his own bank app for a real " +
        "allocation line. This does not move any money itself — it only marks the allocation " +
        "as done. Once every allocation on a plan is marked executed, the plan itself flips to " +
        "completed automatically. Safe to call again on an already-executed allocation.")]
    public async Task<string> MarkAllocationExecutedAsync(
        [Description("The real allocation id, from get_active_pay_period_plan.")]
        Guid allocationId)
    {
        var result = await planRepository.MarkAllocationExecutedAsync(ConnectionString, allocationId);
        if (!result.Success)
        {
            return $"Could not mark allocation executed: {result.ErrorMessage}";
        }

        return $"Marked allocation {allocationId} executed.";
    }

    [McpServerTool(Name = "get_active_pay_period_plan")]
    [Description(
        "The real current pay-period plan (Active, or the rarer Proposed) — every allocation " +
        "alongside the real current Plaid balance of its account, so progress can be checked " +
        "against what has actually landed, not just what the plan says should happen. Returns " +
        "a plain statement if there's no active plan right now.")]
    public async Task<string> GetActivePayPeriodPlanAsync()
    {
        var result = await planRepository.GetActiveAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not read the active pay-period plan: {result.ErrorMessage}";
        }
        if (result.Plan is null)
        {
            return "No active pay-period plan right now. Use create_pay_period_plan to start one.";
        }

        var plan = result.Plan;
        var sb = new StringBuilder();
        sb.AppendLine($"Plan {plan.Id} — pay date {plan.PayDate:yyyy-MM-dd}, income {Money(plan.IncomeAmount)}, status: {plan.Status.ToDbValue()}");
        if (!string.IsNullOrWhiteSpace(plan.Notes))
        {
            sb.AppendLine($"Notes: {plan.Notes}");
        }
        sb.AppendLine();

        foreach (var allocation in plan.Allocations)
        {
            var reasonSuffix = string.IsNullOrWhiteSpace(allocation.Reason) ? "" : $" — {allocation.Reason}";
            var executedSuffix = allocation.Executed
                ? $" [EXECUTED {allocation.ExecutedAt:yyyy-MM-dd HH:mm}Z]"
                : " [not yet executed]";
            var balanceSuffix = allocation.CurrentBalance is null
                ? " (current balance unknown)"
                : $" (current balance {Money(allocation.CurrentBalance)})";
            sb.AppendLine($"  - {allocation.AccountName}: {Money(allocation.Amount)}{reasonSuffix}{executedSuffix}{balanceSuffix} [id: {allocation.Id}]");
        }

        return sb.ToString().TrimEnd();
    }

    private static string Money(decimal? amount) =>
        amount is null ? "unknown" : amount.Value.ToString("C2", Usd);
}
