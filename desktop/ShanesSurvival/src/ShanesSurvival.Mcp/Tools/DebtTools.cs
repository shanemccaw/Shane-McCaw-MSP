using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Text;
using ModelContextProtocol.Server;
using ShanesSurvival.Core.Debts;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.Mcp.Tools;

/// <summary>
/// Real MCP tools for the debts table (#2903), on top of #2887's read-only tools. Debts are
/// manually entered by Shane, never sourced from Plaid — real arrears, collections, and
/// garnishments often don't show up cleanly in Plaid transaction data, so this lets Shane
/// describe a real arrears situation conversationally ("rent is 4 months behind") and have
/// Claude Desktop do the math and write the real entry. No automatic linkage to
/// target_amount/GATE shortfall math yet — that's a separate, later design decision.
/// </summary>
[McpServerToolType]
public sealed class DebtTools(SettingsService settingsService, DebtRepository debtRepository)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "record_debt")]
    [Description(
        "Records a real debt/arrears entry. Upserts by creditor_name (case-insensitive, same " +
        "matching convention as set_bill_target/recent_transactions) — if a debt for that " +
        "creditor already exists it's updated in place, otherwise a new one is created. " +
        "Optional fields left unset on an update leave that column unchanged rather than " +
        "clearing it, so e.g. updating just the balance doesn't erase existing notes.")]
    public async Task<string> RecordDebtAsync(
        [Description("The real creditor's name, e.g. \"Landlord\" or \"Chase Card\". Matched case-insensitively.")]
        string creditorName,
        [Description("The real current total balance owed, in dollars.")]
        decimal balance,
        [Description("The real minimum monthly payment, if known.")]
        decimal? minimumPayment = null,
        [Description("How many real days past due this debt currently is, if known.")]
        int? daysPastDue = null,
        [Description("Whether this debt is currently in real delinquency, if known.")]
        bool? isDelinquent = null,
        [Description("Optional real free-text notes, e.g. \"4 months behind, landlord threatening eviction\".")]
        string? notes = null,
        [Description(
            "Whether this debt is critical (real foreclosure/levy/garnishment-tier risk — " +
            "Shane-assigned, never inferred), so it's always surfaced first by get_debts and " +
            "never buried among lower-stakes debts. Left unset on an update leaves the existing " +
            "flag unchanged.")]
        bool? isCritical = null)
    {
        var result = await debtRepository.UpsertAsync(
            ConnectionString, creditorName, balance, minimumPayment, isDelinquent, daysPastDue, notes, isCritical);
        if (!result.Success || result.Debt is null)
        {
            return $"Could not record debt for \"{creditorName}\": {result.ErrorMessage}";
        }

        var verb = result.WasCreated ? "Created" : "Updated";
        var critical = result.Debt.IsCritical ? " [CRITICAL]" : "";
        return $"{verb} debt \"{result.Debt.CreditorName}\"{critical}: balance {Money(result.Debt.Balance)}, " +
               $"{FormatDelinquency(result.Debt)}. Run get_debts to confirm.";
    }

    [McpServerTool(Name = "get_debts")]
    [Description(
        "Lists every real debt row. Critical debts (is_critical — real foreclosure/levy/" +
        "garnishment-tier risk, Shane-assigned) are always listed first in their own section, " +
        "same always-surfaced treatment GATE-tier bills get on the bill side. The rest are " +
        "worst (highest days_past_due) first. Manually entered by Shane, never sourced from " +
        "Plaid.")]
    public async Task<string> GetDebtsAsync()
    {
        var result = await debtRepository.ListAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not read debts: {result.ErrorMessage}";
        }

        if (result.Debts.Count == 0)
        {
            return "No debts recorded yet.";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"{result.Debts.Count} real debt(s):");

        var criticalDebts = result.Debts.Where(d => d.IsCritical).ToList();
        var otherDebts = result.Debts.Where(d => !d.IsCritical).ToList();

        if (criticalDebts.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("CRITICAL debts (real foreclosure/levy/garnishment-tier risk — always tracked):");
            foreach (var debt in criticalDebts)
            {
                sb.AppendLine($"  - {FormatDebt(debt)}");
            }
        }

        if (otherDebts.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Other debts (worst days-past-due first):");
            foreach (var debt in otherDebts)
            {
                sb.AppendLine($"  - {FormatDebt(debt)}");
            }
        }

        decimal totalBalance = result.Debts.Sum(d => d.Balance);
        sb.AppendLine();
        sb.AppendLine($"Total real debt balance: {Money(totalBalance)}");
        return sb.ToString().TrimEnd();
    }

    private static string FormatDebt(DebtRow debt)
    {
        var minimumPayment = debt.MinimumPayment is null ? "" : $", min payment {Money(debt.MinimumPayment.Value)}";
        var notes = string.IsNullOrWhiteSpace(debt.Notes) ? "" : $" — {debt.Notes}";
        return $"{debt.CreditorName}: balance {Money(debt.Balance)}{minimumPayment}, {FormatDelinquency(debt)}{notes}";
    }

    private static string FormatDelinquency(DebtRow debt) =>
        debt.IsDelinquent
            ? $"delinquent, {debt.DaysPastDue} day(s) past due"
            : debt.DaysPastDue > 0
                ? $"{debt.DaysPastDue} day(s) past due"
                : "current";

    private static string Money(decimal amount) => amount.ToString("C2", Usd);
}
