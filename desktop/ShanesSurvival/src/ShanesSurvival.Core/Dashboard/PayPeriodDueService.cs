using ShanesSurvival.Core.Accounts;

namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// Real "what's due between this paycheck and the next one" lens (#2904) — a different
/// question than <see cref="DashboardService"/>'s flat monthly shortfall, which treats every
/// bill's target_amount as due right now. This walks each Bill-role account's real due_day
/// (migrations/007_bill_due_days.sql) forward from today and asks whether it lands inside
/// [today, nextPayDate) before the next paycheck arrives — handling real month wraparound
/// (e.g. due_day = 5 when today is the 25th and nextPayDate is early next month). Reuses
/// <see cref="AccountRepository.ListAsync"/> rather than re-deriving the accounts read; no
/// existing bill_status/gate_status math is touched.
/// </summary>
public sealed class PayPeriodDueService(AccountRepository accountRepository)
{
    public async Task<PayPeriodDueResult> ComputeAsync(string? connectionString, DateOnly today, DateOnly nextPayDate)
    {
        if (nextPayDate <= today)
        {
            return Failure("nextPayDate must be after today — it's the date the next paycheck arrives.");
        }

        var accounts = await accountRepository.ListAsync(connectionString);
        if (!accounts.Success)
        {
            return Failure($"Could not read accounts: {accounts.ErrorMessage}");
        }

        var warnings = new List<string>();
        var dueBills = new List<DueBill>();

        var billAccounts = accounts.Accounts.Where(a => a.Role == AccountRole.Bill).OrderBy(a => a.Name).ToList();
        if (billAccounts.Count == 0)
        {
            warnings.Add("No accounts are assigned the Bill role yet.");
        }

        foreach (var account in billAccounts)
        {
            if (account.DueDay is null)
            {
                warnings.Add($"\"{account.Name}\" has no due_day set yet — excluded from this window. Use set_bill_due_day.");
                continue;
            }

            var dueDate = FindDueDateInWindow(today, nextPayDate, account.DueDay.Value);
            if (dueDate is null)
            {
                continue;
            }

            string? warning = account.TargetAmount is null ? "target not set" : null;
            dueBills.Add(new DueBill(account.Id, account.Name, dueDate.Value, account.TargetAmount, warning));
        }

        foreach (var missing in dueBills.Where(b => b.Warning is not null))
        {
            warnings.Add($"\"{missing.Name}\" is due {missing.DueDate:yyyy-MM-dd} but has no target_amount set — excluded from the total.");
        }

        var totalDue = dueBills.Where(b => b.TargetAmount.HasValue).Sum(b => b.TargetAmount!.Value);
        var ordered = dueBills.OrderBy(b => b.DueDate).ToList();

        return new PayPeriodDueResult(true, null, warnings, today, nextPayDate, ordered, totalDue);
    }

    /// <summary>
    /// Walks month-by-month from today's month through nextPayDate's month, clamping dueDay to
    /// each month's real last day (e.g. dueDay 31 in a 30-day month), and returns the first
    /// candidate date that actually falls in [today, nextPayDate) — or null if none does.
    /// </summary>
    private static DateOnly? FindDueDateInWindow(DateOnly today, DateOnly nextPayDate, int dueDay)
    {
        var monthCursor = new DateOnly(today.Year, today.Month, 1);
        var endCursor = new DateOnly(nextPayDate.Year, nextPayDate.Month, 1);

        while (monthCursor <= endCursor)
        {
            var daysInMonth = DateTime.DaysInMonth(monthCursor.Year, monthCursor.Month);
            var candidate = new DateOnly(monthCursor.Year, monthCursor.Month, Math.Min(dueDay, daysInMonth));
            if (candidate >= today && candidate < nextPayDate)
            {
                return candidate;
            }
            monthCursor = monthCursor.AddMonths(1);
        }

        return null;
    }

    private static PayPeriodDueResult Failure(string message) =>
        new(false, message, [], default, default, [], 0m);
}
