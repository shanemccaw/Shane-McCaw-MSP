using ShanesSurvival.Core.Income;

namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// Real "two automatic cycles, each covered/short" forecast (#2918) — Shane's own framing:
/// "This is what is due between this paycheck and this paycheck -> Must save x dollars to
/// cover next cycle. This is what is due between next paycheck and the paycheck after ->
/// Going to be short x dollars." Unlike <see cref="PayPeriodDueService"/>'s
/// pay_period_due_status, which requires a caller to manually supply nextPayDate, this pulls
/// the real next_pay_date/pay_frequency_days already stored on an income source (#2905) so no
/// date has to be supplied by hand.
///
/// No is_primary flag exists on income_sources (migrations/005_income_tracking.sql), so
/// "the primary source" is picked deterministically: the real active source with the earliest
/// real next_pay_date among those that actually have both pay_frequency_days and next_pay_date
/// set (see <see cref="IncomeRepository.ListActiveAsync"/>'s ordering). Reuses
/// <see cref="PayPeriodDueService"/> for both cycles' due-window math and
/// <see cref="DashboardService"/> for Cycle 1's real available-funds figure — no shortfall/gate
/// math is re-derived here.
/// </summary>
public sealed class PayPeriodForecastService(
    IncomeRepository incomeRepository,
    PayPeriodDueService payPeriodDueService,
    DashboardService dashboardService)
{
    public async Task<PayPeriodForecastResult> ComputeAsync(string? connectionString, DateOnly today)
    {
        var sources = await incomeRepository.ListActiveAsync(connectionString);
        if (!sources.Success)
        {
            return Failure($"Could not read income sources: {sources.ErrorMessage}");
        }

        // Real honest limitation: cycle boundaries need both a real cycle length and a real
        // next-pay anchor date. A source missing either can't define a cycle, so it's not a
        // candidate for "primary" here — but it can still count toward Cycle 2's summed
        // expected_per_cycle below if that field is set.
        var cycleCandidates = sources.Sources
            .Where(s => s.PayFrequencyDays is > 0 && s.NextPayDate is not null)
            .ToList();

        if (cycleCandidates.Count == 0)
        {
            return Failure(
                "No active income source has both a pay frequency and a next pay date set yet — " +
                "can't compute automatic cycle boundaries. Use set_income_source to set " +
                "payFrequencyDays and nextPayDate on your real income source first.");
        }

        // ListActiveAsync already orders by next_pay_date NULLS LAST, name — first candidate
        // with a real next_pay_date is the earliest, deterministic "primary" for this forecast.
        var primary = cycleCandidates[0];
        var nextPayDate = primary.NextPayDate!.Value;
        var payFrequencyDays = primary.PayFrequencyDays!.Value;

        if (nextPayDate <= today)
        {
            return Failure(
                $"\"{primary.Name}\"'s real next_pay_date ({nextPayDate:yyyy-MM-dd}) is on or before " +
                "today — it looks stale. Record the real deposit with record_income (which " +
                "auto-advances next_pay_date), or update it directly with set_income_source, " +
                "before running this forecast again.");
        }

        var cycle2End = nextPayDate.AddDays(payFrequencyDays);

        var cycle1Due = await payPeriodDueService.ComputeAsync(connectionString, today, nextPayDate);
        if (!cycle1Due.Success)
        {
            return Failure($"Could not compute Cycle 1's due-window: {cycle1Due.ErrorMessage}");
        }

        var gate = await dashboardService.ComputeAsync(connectionString);
        if (!gate.Success)
        {
            return Failure($"Could not compute real available funds for Cycle 1: {gate.ErrorMessage}");
        }

        var cycle1 = new PayPeriodForecastCycle(
            today, nextPayDate, cycle1Due.DueBills, cycle1Due.TotalDue, gate.TotalAvailable, cycle1Due.Warnings);

        var cycle2Due = await payPeriodDueService.ComputeAsync(connectionString, nextPayDate, cycle2End);
        if (!cycle2Due.Success)
        {
            return Failure($"Could not compute Cycle 2's due-window: {cycle2Due.ErrorMessage}");
        }

        // Cycle 2's real expected paycheck total: sum expected_per_cycle across every active
        // income source that has it set (not just the primary source) — per the real spec, a
        // second gig/freelance source's expected amount counts toward the next cycle's coverage
        // too. Null (not 0) when none of them have it set, so the verdict can say "unknown"
        // instead of silently claiming a $0 income cycle.
        var sourcesWithExpected = sources.Sources.Where(s => s.ExpectedPerCycle is not null).ToList();
        decimal? expectedCycle2 = sourcesWithExpected.Count == 0
            ? null
            : sourcesWithExpected.Sum(s => s.ExpectedPerCycle!.Value);

        var cycle2Warnings = cycle2Due.Warnings.ToList();
        if (expectedCycle2 is null)
        {
            cycle2Warnings.Add(
                "No active income source has expected_per_cycle set — Cycle 2's covered/short " +
                "verdict can't be computed. Use set_income_source to set it.");
        }

        var cycle2 = new PayPeriodForecastCycle(
            nextPayDate, cycle2End, cycle2Due.DueBills, cycle2Due.TotalDue, expectedCycle2, cycle2Warnings);

        return new PayPeriodForecastResult(true, null, primary.Name, cycle1, cycle2);
    }

    private static PayPeriodForecastResult Failure(string message) => new(false, message, null, null, null);
}
