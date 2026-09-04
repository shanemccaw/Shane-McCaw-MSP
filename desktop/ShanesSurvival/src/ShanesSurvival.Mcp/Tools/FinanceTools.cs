using System.ComponentModel;
using System.Globalization;
using System.Text;
using ModelContextProtocol.Server;
using ShanesSurvival.Core.Accounts;
using ShanesSurvival.Core.Dashboard;
using ShanesSurvival.Core.Settings;
using ShanesSurvival.Core.Transactions;

namespace ShanesSurvival.Mcp.Tools;

/// <summary>
/// Real MCP tools grounded in ShanesSurvival's own Postgres database — the same connection
/// string the WPF app reads from %AppData%\ShanesSurvival\settings.json, and the same GATE
/// shortfall/bleed math already built and verified in <see cref="DashboardService"/> (#2885). No
/// math is re-derived here; every tool below either calls DashboardService directly or runs a
/// real, bounded read/write against the same tables. <see cref="SetBillTargetAsync"/> (#2902) is
/// the one write tool so far — it reuses <see cref="AccountRepository.UpdateRoleAsync"/>, the
/// same call the WPF "Assign Account Roles…" dialog makes, rather than re-deriving the
/// lookup/update logic.
/// </summary>
[McpServerToolType]
public sealed class FinanceTools(
    SettingsService settingsService,
    DashboardService dashboardService,
    AccountRepository accountRepository,
    TransactionRepository transactionRepository,
    PayPeriodDueService payPeriodDueService,
    PayPeriodForecastService payPeriodForecastService)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "gate_status")]
    [Description(
        "Real GATE status: total real available funds (Income Gate balance + every real " +
        "reserve-role account's balance) against the total real shortfall summed across every " +
        "bill account, and whether that leaves things covered or short by $X. Shows the Income " +
        "Gate balance, each reserve account and its balance, and the combined total separately " +
        "before the final covered/short line. Grounded in live balances, not invented numbers.")]
    public async Task<string> GetGateStatusAsync()
    {
        var result = await dashboardService.ComputeAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not compute GATE status: {result.ErrorMessage}";
        }

        var sb = new StringBuilder();

        if (result.IncomeGateBalance is null)
        {
            sb.AppendLine("Income Gate balance is not currently known (no account assigned the " +
                          "Income Gate role, or it hasn't been synced with Plaid yet).");
        }
        else
        {
            sb.AppendLine($"Income Gate (\"{result.IncomeGateAccountName}\") real balance: {Money(result.IncomeGateBalance)}");
        }

        if (result.ReserveAccounts.Count == 0)
        {
            sb.AppendLine("No accounts are assigned the Reserve role.");
        }
        else
        {
            sb.AppendLine("Reserve accounts:");
            foreach (var reserve in result.ReserveAccounts)
            {
                sb.AppendLine($"  - {reserve.Name}: {Money(reserve.CurrentBalance)}");
            }
            sb.AppendLine($"Total reserve: {Money(result.ReserveTotal)}");
        }

        if (result.TotalAvailable is null)
        {
            sb.AppendLine("Total real available funds cannot be computed without a known Income Gate balance.");
        }
        else
        {
            sb.AppendLine($"Total real available funds (Income Gate + reserve): {Money(result.TotalAvailable)}");
        }

        sb.AppendLine($"Total real shortfall across bill accounts: {Money(result.TotalShortfall)}");

        if (result.TopLineAmount is null)
        {
            sb.AppendLine("Top-line covered/short cannot be computed without a known Income Gate balance.");
        }
        else if (result.IsCovered)
        {
            sb.AppendLine($"Covered by {Money(result.TopLineAmount)}.");
        }
        else
        {
            sb.AppendLine($"Short by {Money(-result.TopLineAmount)}.");
        }

        var gateTierBills = result.GateBills.Select(FormatBill).ToList();
        if (gateTierBills.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("GATE-tier bills (mortgage/Tesla — always tracked):");
            foreach (var line in gateTierBills)
            {
                sb.AppendLine($"  - {line}");
            }
        }

        AppendWarnings(sb, result.Warnings);
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "bill_status")]
    [Description(
        "Real per-bill-account status for every account with the Bill role: real target " +
        "amount vs. real current Plaid balance, and the real shortfall (max(0, target - " +
        "balance)), sorted worst-shortfall-first. GATE-tier bills (mortgage, Tesla) and the " +
        "rest of the bills are both included, GATE-tier called out separately. Each bill also " +
        "shows its real last_paid_date (#2912) — informational only here; it doesn't change " +
        "this shortfall math, use pay_period_due_status for the already-paid-this-cycle lens.")]
    public async Task<string> GetBillStatusAsync()
    {
        var result = await dashboardService.ComputeAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not compute bill status: {result.ErrorMessage}";
        }

        var sb = new StringBuilder();

        if (result.GateBills.Count == 0 && result.OtherBills.Count == 0)
        {
            sb.AppendLine("No accounts are assigned the Bill role yet.");
        }
        else
        {
            if (result.GateBills.Count > 0)
            {
                sb.AppendLine("GATE-tier bills:");
                foreach (var bill in result.GateBills)
                {
                    sb.AppendLine($"  - {FormatBill(bill)}");
                }
            }

            if (result.OtherBills.Count > 0)
            {
                sb.AppendLine("Other bills (worst shortfall first):");
                foreach (var bill in result.OtherBills)
                {
                    sb.AppendLine($"  - {FormatBill(bill)}");
                }
            }

            sb.AppendLine();
            sb.AppendLine($"Total real shortfall: {Money(result.TotalShortfall)}");
        }

        AppendWarnings(sb, result.Warnings);
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "spend_bleed")]
    [Description(
        "Real spend-account bleed view, scoped to the 2 spend accounts only: real transactions " +
        "from the last 30 days, grouped and summed by merchant so a bleed pattern (many small " +
        "charges at one merchant) is visible. Only real outflows count — refunds/inflows are " +
        "excluded, same as the WPF dashboard.")]
    public async Task<string> GetSpendBleedAsync()
    {
        var result = await dashboardService.ComputeAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not compute spend bleed: {result.ErrorMessage}";
        }

        var sb = new StringBuilder();

        if (result.SpendBleed.Count == 0)
        {
            sb.AppendLine("No accounts are assigned the Spend role yet.");
        }
        else
        {
            foreach (var account in result.SpendBleed)
            {
                sb.AppendLine($"{account.Name} — total spend last 30 days: {Money(account.TotalSpent)}");
                if (account.Merchants.Count == 0)
                {
                    sb.AppendLine("  (no transactions in the last 30 days)");
                }
                else
                {
                    foreach (var merchant in account.Merchants)
                    {
                        sb.AppendLine(
                            $"  - {merchant.Merchant}: {Money(merchant.TotalAmount)} across {merchant.TransactionCount} transaction(s)");
                    }
                }
                sb.AppendLine();
            }
        }

        AppendWarnings(sb, result.Warnings);
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "recent_transactions")]
    [Description(
        "Real, most-recent-first transactions for one account, bounded to a real limit. " +
        "Matches the account by exact real name (case-insensitive) as assigned in \"Assign " +
        "Account Roles…\" — use bill_status or spend_bleed first to see real account names.")]
    public async Task<string> GetRecentTransactionsAsync(
        [Description("The account's real name, exactly as shown by bill_status/spend_bleed/gate_status (case-insensitive).")]
        string accountName,
        [Description("Maximum number of real transactions to return, most recent first. Default 20, capped at 100.")]
        int limit = 20)
    {
        var connectionString = ConnectionString;
        var boundedLimit = Math.Clamp(limit <= 0 ? 20 : limit, 1, 100);

        var accounts = await accountRepository.ListAsync(connectionString);
        if (!accounts.Success)
        {
            return $"Could not read accounts: {accounts.ErrorMessage}";
        }

        var account = accounts.Accounts.FirstOrDefault(
            a => string.Equals(a.Name, accountName, StringComparison.OrdinalIgnoreCase));
        if (account is null)
        {
            var known = string.Join(", ", accounts.Accounts.Select(a => a.Name));
            return $"No account named \"{accountName}\" found. Real known accounts: {(known.Length == 0 ? "(none synced yet)" : known)}";
        }

        var transactions = await transactionRepository.ListRecentAsync(connectionString, account.Id, boundedLimit);
        if (!transactions.Success)
        {
            return $"Could not read transactions for \"{account.Name}\": {transactions.ErrorMessage}";
        }

        if (transactions.Transactions.Count == 0)
        {
            return $"\"{account.Name}\" has no transactions yet.";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"Most recent {transactions.Transactions.Count} transaction(s) on \"{account.Name}\":");
        foreach (var tx in transactions.Transactions)
        {
            // merchant_name is genuinely null for many real transaction types (ACH transfers,
            // direct-deposit payroll, etc.) — fall back to Plaid's raw `name`/description
            // (e.g. "COM2 TREAS 310 DEPOSIT") before giving up and saying "Unknown merchant".
            var merchant = !string.IsNullOrWhiteSpace(tx.MerchantName)
                ? tx.MerchantName
                : !string.IsNullOrWhiteSpace(tx.Name)
                    ? tx.Name
                    : "Unknown merchant";
            var pending = tx.Pending ? " (pending)" : "";
            var category = string.IsNullOrWhiteSpace(tx.Category) ? "" : $" [{tx.Category}]";
            sb.AppendLine($"  - {tx.Date:yyyy-MM-dd}  {Money(tx.Amount)}  {merchant}{category}{pending}");
        }

        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "set_bill_target")]
    [Description(
        "Sets a real target_amount on an existing account with the Bill role — the same field " +
        "the WPF \"Assign Account Roles…\" dialog writes. The account must already exist (match " +
        "by real name, case-insensitive, same convention as recent_transactions) and must " +
        "already have role = Bill; setting a target on a Spend/Income Gate/Unassigned account " +
        "is rejected with a clear error rather than silently accepted or ignored.")]
    public async Task<string> SetBillTargetAsync(
        [Description("The account's real name, exactly as shown by bill_status/spend_bleed/gate_status (case-insensitive).")]
        string accountName,
        [Description("The new real target amount for this bill account, e.g. 1850.00.")]
        decimal targetAmount)
    {
        var connectionString = ConnectionString;

        var accounts = await accountRepository.ListAsync(connectionString);
        if (!accounts.Success)
        {
            return $"Could not read accounts: {accounts.ErrorMessage}";
        }

        var account = accounts.Accounts.FirstOrDefault(
            a => string.Equals(a.Name, accountName, StringComparison.OrdinalIgnoreCase));
        if (account is null)
        {
            var known = string.Join(", ", accounts.Accounts.Select(a => a.Name));
            return $"No account named \"{accountName}\" found. Real known accounts: {(known.Length == 0 ? "(none synced yet)" : known)}";
        }

        if (account.Role != AccountRole.Bill)
        {
            return $"\"{account.Name}\" has role {account.Role.DisplayName()}, not Bill — " +
                   "target_amount only applies to Bill accounts. Assign it the Bill role first " +
                   "(via \"Assign Account Roles…\" in the WPF app) before setting a target.";
        }

        var update = await accountRepository.UpdateRoleAsync(
            connectionString, account.Id, account.Role, targetAmount, account.IsGate);
        if (!update.Success)
        {
            return $"Could not set target for \"{account.Name}\": {update.ErrorMessage}";
        }

        return $"Set \"{account.Name}\" target to {Money(targetAmount)}. Run bill_status to confirm the shortfall total.";
    }

    [McpServerTool(Name = "set_bill_due_day")]
    [Description(
        "Sets a real due_day (1-31, the real calendar day of month the bill is due) on an " +
        "existing account with the Bill role — same validation pattern as set_bill_target. The " +
        "account must already exist (match by real name, case-insensitive) and must already " +
        "have role = Bill; setting a due day on a Spend/Income Gate/Unassigned/Emergency Fund " +
        "account is rejected with a clear error rather than silently accepted or ignored.")]
    public async Task<string> SetBillDueDayAsync(
        [Description("The account's real name, exactly as shown by bill_status/spend_bleed/gate_status (case-insensitive).")]
        string accountName,
        [Description("The real day of month this bill is due, 1-31.")]
        int dueDay)
    {
        if (dueDay is < 1 or > 31)
        {
            return $"dueDay must be between 1 and 31 (got {dueDay}).";
        }

        var connectionString = ConnectionString;

        var accounts = await accountRepository.ListAsync(connectionString);
        if (!accounts.Success)
        {
            return $"Could not read accounts: {accounts.ErrorMessage}";
        }

        var account = accounts.Accounts.FirstOrDefault(
            a => string.Equals(a.Name, accountName, StringComparison.OrdinalIgnoreCase));
        if (account is null)
        {
            var known = string.Join(", ", accounts.Accounts.Select(a => a.Name));
            return $"No account named \"{accountName}\" found. Real known accounts: {(known.Length == 0 ? "(none synced yet)" : known)}";
        }

        if (account.Role != AccountRole.Bill)
        {
            return $"\"{account.Name}\" has role {account.Role.DisplayName()}, not Bill — " +
                   "due_day only applies to Bill accounts. Assign it the Bill role first " +
                   "(via \"Assign Account Roles…\" in the WPF app) before setting a due day.";
        }

        var update = await accountRepository.UpdateDueDayAsync(connectionString, account.Id, dueDay);
        if (!update.Success)
        {
            return $"Could not set due day for \"{account.Name}\": {update.ErrorMessage}";
        }

        return $"Set \"{account.Name}\" due day to {dueDay}. Run pay_period_due_status to confirm.";
    }

    [McpServerTool(Name = "mark_bill_paid")]
    [Description(
        "Records that a real Bill-role account's payment for the current cycle has genuinely " +
        "been made — sets accounts.last_paid_date, the field pay_period_due_status uses to tell " +
        "\"already paid this cycle\" apart from a genuinely neglected bill (#2912). Real bug " +
        "this fixes: pay_period_due_status previously had no way to know a bill was already " +
        "paid, and would list it as still due — a real overcount on the short-runway total. " +
        "Same validation pattern as set_bill_target/set_bill_due_day: the account must already " +
        "exist (match by real name, case-insensitive) and must already have role = Bill.")]
    public async Task<string> MarkBillPaidAsync(
        [Description("The account's real name, exactly as shown by bill_status/spend_bleed/gate_status (case-insensitive).")]
        string accountName,
        [Description("The real date this bill was paid, e.g. 2026-09-05. Defaults to today if omitted.")]
        DateOnly? paidDate = null)
    {
        var connectionString = ConnectionString;

        var accounts = await accountRepository.ListAsync(connectionString);
        if (!accounts.Success)
        {
            return $"Could not read accounts: {accounts.ErrorMessage}";
        }

        var account = accounts.Accounts.FirstOrDefault(
            a => string.Equals(a.Name, accountName, StringComparison.OrdinalIgnoreCase));
        if (account is null)
        {
            var known = string.Join(", ", accounts.Accounts.Select(a => a.Name));
            return $"No account named \"{accountName}\" found. Real known accounts: {(known.Length == 0 ? "(none synced yet)" : known)}";
        }

        if (account.Role != AccountRole.Bill)
        {
            return $"\"{account.Name}\" has role {account.Role.DisplayName()}, not Bill — " +
                   "last_paid_date only applies to Bill accounts. Assign it the Bill role first " +
                   "(via \"Assign Account Roles…\" in the WPF app) before marking it paid.";
        }

        var resolvedPaidDate = paidDate ?? DateOnly.FromDateTime(DateTime.Now);

        var update = await accountRepository.UpdateLastPaidDateAsync(connectionString, account.Id, resolvedPaidDate);
        if (!update.Success)
        {
            return $"Could not mark \"{account.Name}\" paid: {update.ErrorMessage}";
        }

        return $"Marked \"{account.Name}\" paid as of {resolvedPaidDate:yyyy-MM-dd}. Run pay_period_due_status to confirm it's dropped from the current cycle.";
    }

    [McpServerTool(Name = "pay_period_due_status")]
    [Description(
        "Real 'what's due between this paycheck and the next one' view — every Bill-role " +
        "account whose real due_day falls within [today, nextPayDate), with its real " +
        "target_amount and the real sum. Handles real month wraparound (e.g. due_day 5 when " +
        "today is the 25th and nextPayDate is early next month). Does not touch bill_status/" +
        "gate_status's existing flat monthly-shortfall math — this is a separate lens. Bill " +
        "accounts with no due_day set yet are called out in Warnings rather than silently " +
        "under-counted.")]
    public async Task<string> GetPayPeriodDueStatusAsync(
        [Description("The real date the next paycheck arrives, e.g. 2026-09-19. Must be after today.")]
        DateOnly nextPayDate)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var result = await payPeriodDueService.ComputeAsync(ConnectionString, today, nextPayDate);
        if (!result.Success)
        {
            return $"Could not compute pay-period due status: {result.ErrorMessage}";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"Bills due between {result.Today:yyyy-MM-dd} and {result.NextPayDate:yyyy-MM-dd} (exclusive):");

        if (result.DueBills.Count == 0)
        {
            sb.AppendLine("  (none)");
        }
        else
        {
            foreach (var bill in result.DueBills)
            {
                var target = bill.TargetAmount is null ? (bill.Warning ?? "no target") : Money(bill.TargetAmount);
                sb.AppendLine($"  - {bill.Name}: due {bill.DueDate:yyyy-MM-dd} — {target}");
            }
            sb.AppendLine();
            sb.AppendLine($"Total real due in this window: {Money(result.TotalDue)}");
        }

        AppendWarnings(sb, result.Warnings);
        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "pay_period_forecast")]
    [Description(
        "Real two-cycle covered/short forecast (#2918) — no parameters needed. Cycle 1 is " +
        "today through the real next_pay_date already stored on your primary real income " +
        "source (#2905), compared against real total available funds (gate_status's Income " +
        "Gate + reserve total). Cycle 2 is that next_pay_date through the pay date after it " +
        "(next_pay_date + pay_frequency_days), compared against the real summed " +
        "expected_per_cycle across every active income source that has it set. Reuses " +
        "pay_period_due_status's exact due-window + already-paid-this-cycle logic for both " +
        "windows — nothing is re-derived. If no active income source has both a real " +
        "pay_frequency_days and next_pay_date set, says so plainly instead of guessing at a " +
        "cycle length.")]
    public async Task<string> GetPayPeriodForecastAsync()
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var result = await payPeriodForecastService.ComputeAsync(ConnectionString, today);
        if (!result.Success || result.Cycle1 is null || result.Cycle2 is null)
        {
            return $"Could not compute pay-period forecast: {result.ErrorMessage}";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"Two-cycle forecast, anchored on \"{result.PrimarySourceName}\"'s real pay schedule:");
        sb.AppendLine();
        AppendCycle(sb, "Cycle 1", result.Cycle1, "must save", "must find this before");
        sb.AppendLine();
        AppendCycle(sb, "Cycle 2", result.Cycle2, "on track to save", "will be short");

        return sb.ToString().TrimEnd();
    }

    private static void AppendCycle(
        StringBuilder sb, string label, PayPeriodForecastCycle cycle, string coveredVerb, string shortVerb)
    {
        sb.AppendLine($"{label}: {cycle.WindowStart:yyyy-MM-dd} → {cycle.WindowEnd:yyyy-MM-dd}");

        if (cycle.DueBills.Count == 0)
        {
            sb.AppendLine("  Bills due in this window: (none)");
        }
        else
        {
            sb.AppendLine("  Bills due in this window:");
            foreach (var bill in cycle.DueBills)
            {
                var target = bill.TargetAmount is null ? (bill.Warning ?? "no target") : Money(bill.TargetAmount);
                sb.AppendLine($"    - {bill.Name}: due {bill.DueDate:yyyy-MM-dd} — {target}");
            }
        }
        sb.AppendLine($"  Total real due: {Money(cycle.TotalDue)}");
        sb.AppendLine($"  Measured against: {Money(cycle.AvailableAmount)}");

        if (cycle.IsCovered is null)
        {
            sb.AppendLine("  Covered/short cannot be computed — see warnings below.");
        }
        else if (cycle.IsCovered.Value)
        {
            sb.AppendLine($"  Covered, {Money(cycle.Delta)} left over ({coveredVerb} to cover the next cycle).");
        }
        else
        {
            sb.AppendLine($"  Short {Money(-cycle.Delta)} — {shortVerb} {cycle.WindowEnd:yyyy-MM-dd}.");
        }

        AppendWarnings(sb, cycle.Warnings);
    }

    [McpServerTool(Name = "emergency_fund_status")]
    [Description(
        "Real status for every account with the Emergency Fund role: real current Plaid " +
        "balance against the real savings goal (target_amount, the same field bill accounts " +
        "use for their monthly target), and whether that leaves it covered or short by $X. If " +
        "no account is assigned the Emergency Fund role yet, says so plainly rather than " +
        "returning an empty/confusing result.")]
    public async Task<string> GetEmergencyFundStatusAsync()
    {
        var accounts = await accountRepository.ListAsync(ConnectionString);
        if (!accounts.Success)
        {
            return $"Could not compute emergency fund status: {accounts.ErrorMessage}";
        }

        var emergencyFundAccounts = accounts.Accounts
            .Where(a => a.Role == AccountRole.EmergencyFund)
            .OrderBy(a => a.Name)
            .ToList();

        if (emergencyFundAccounts.Count == 0)
        {
            return "No account is assigned the Emergency Fund role yet. Assign one in " +
                   "\"Assign Account Roles…\" in the WPF app.";
        }

        var sb = new StringBuilder();
        foreach (var account in emergencyFundAccounts)
        {
            sb.AppendLine($"{account.Name}: real balance {Money(account.CurrentBalance)}");

            if (account.TargetAmount is null)
            {
                sb.AppendLine("  No savings goal set yet.");
            }
            else
            {
                sb.AppendLine($"  Goal: {Money(account.TargetAmount)}");
                if (account.CurrentBalance is null)
                {
                    sb.AppendLine("  Covered/short cannot be computed without a known real balance.");
                }
                else
                {
                    var delta = account.CurrentBalance.Value - account.TargetAmount.Value;
                    sb.AppendLine(delta >= 0
                        ? $"  Covered by {Money(delta)}."
                        : $"  Short by {Money(-delta)}.");
                }
            }
        }

        return sb.ToString().TrimEnd();
    }

    private static string FormatBill(BillStatus bill)
    {
        var target = bill.TargetAmount is null ? "no target" : Money(bill.TargetAmount);
        var balance = bill.CurrentBalance is null ? "balance unknown" : Money(bill.CurrentBalance);
        var shortfall = bill.Shortfall is null
            ? (bill.Warning ?? "shortfall unknown")
            : bill.Shortfall.Value == 0
                ? "covered"
                : $"short {Money(bill.Shortfall)}";
        // last_paid_date (#2912) is informational only here — it doesn't change this bill's own
        // shortfall math (current balance vs. target); pay_period_due_status is what actually
        // acts on "already paid this cycle."
        var lastPaid = bill.LastPaidDate is null ? "never marked paid" : $"last paid {bill.LastPaidDate:yyyy-MM-dd}";
        return $"{bill.Name}: target {target}, balance {balance} — {shortfall} ({lastPaid})";
    }

    private static void AppendWarnings(StringBuilder sb, IReadOnlyList<string> warnings)
    {
        if (warnings.Count == 0)
        {
            return;
        }

        sb.AppendLine();
        sb.AppendLine("Warnings:");
        foreach (var warning in warnings)
        {
            sb.AppendLine($"  - {warning}");
        }
    }

    private static string Money(decimal? amount) =>
        amount is null ? "unknown" : amount.Value.ToString("C2", Usd);
}
