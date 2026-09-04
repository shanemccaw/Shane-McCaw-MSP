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
/// Real, read-only MCP tools grounded in ShanesSurvival's own Postgres database — the same
/// connection string the WPF app reads from %AppData%\ShanesSurvival\settings.json, and the
/// same GATE shortfall/bleed math already built and verified in <see cref="DashboardService"/>
/// (#2885). No math is re-derived here; every tool below either calls DashboardService directly
/// or runs a real, bounded read against the same tables. No write tools in this pass.
/// </summary>
[McpServerToolType]
public sealed class FinanceTools(
    SettingsService settingsService,
    DashboardService dashboardService,
    AccountRepository accountRepository,
    TransactionRepository transactionRepository)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "gate_status")]
    [Description(
        "Real GATE status: the Income Gate (Direct Deposit) account's current real Plaid " +
        "balance against the total real shortfall summed across every bill account, and " +
        "whether that leaves things covered or short by $X. Grounded in live balances, not " +
        "invented numbers.")]
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
        "rest of the bills are both included, GATE-tier called out separately.")]
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
            var merchant = string.IsNullOrWhiteSpace(tx.MerchantName) ? "Unknown merchant" : tx.MerchantName;
            var pending = tx.Pending ? " (pending)" : "";
            var category = string.IsNullOrWhiteSpace(tx.Category) ? "" : $" [{tx.Category}]";
            sb.AppendLine($"  - {tx.Date:yyyy-MM-dd}  {Money(tx.Amount)}  {merchant}{category}{pending}");
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
        return $"{bill.Name}: target {target}, balance {balance} — {shortfall}";
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
