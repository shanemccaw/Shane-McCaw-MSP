using System.ComponentModel;
using System.Globalization;
using System.Text;
using ModelContextProtocol.Server;
using ShanesSurvival.Core.Income;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.Mcp.Tools;

/// <summary>
/// Real MCP tools for income sources + pay history (#2905), on <see cref="IncomeRepository"/>.
/// Sets up (but does not itself wire) #2904's pay_period_due_status pulling next_pay_date
/// automatically from a real income source — explicitly out of scope here.
/// </summary>
[McpServerToolType]
public sealed class IncomeTools(SettingsService settingsService, IncomeRepository incomeRepository)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "set_income_source")]
    [Description(
        "Creates or updates a real income source — matched/upserted by real name " +
        "(case-insensitive). On update, any argument left unset keeps that field's current " +
        "real value rather than clearing it, so a call that only touches nextPayDate can't " +
        "silently wipe an already-recorded payFrequencyDays/expectedPerCycle.")]
    public async Task<string> SetIncomeSourceAsync(
        [Description("The real income source name, e.g. \"NASA Salary\", \"Ronnie Uber\", \"Shane McCaw Consulting\".")]
        string name,
        [Description("Who this income belongs to, freeform (e.g. \"shane\", \"ronnie\"). Defaults to \"shane\" on first create.")]
        string? person = null,
        [Description("Real pay cycle length in days, e.g. 14 for biweekly. Leave unset for irregular gig/freelance income.")]
        int? payFrequencyDays = null,
        [Description("The real expected amount per pay cycle, in dollars.")]
        decimal? expectedPerCycle = null,
        [Description("The real next expected pay date, e.g. 2026-09-19.")]
        DateOnly? nextPayDate = null)
    {
        var result = await incomeRepository.UpsertSourceAsync(
            ConnectionString, name, person, payFrequencyDays, expectedPerCycle, nextPayDate);
        if (!result.Success || result.Source is null)
        {
            return $"Could not save income source \"{name}\": {result.ErrorMessage}";
        }

        var source = result.Source;
        var frequency = source.PayFrequencyDays is null ? "irregular" : $"every {source.PayFrequencyDays} day(s)";
        var expected = source.ExpectedPerCycle is null ? "unknown" : Money(source.ExpectedPerCycle);
        var next = source.NextPayDate is null ? "unknown" : source.NextPayDate.Value.ToString("yyyy-MM-dd");
        return $"Saved income source \"{source.Name}\" (person: {source.Person}, cycle: {frequency}, " +
               $"expected/cycle: {expected}, next pay date: {next}).";
    }

    [McpServerTool(Name = "record_income")]
    [Description(
        "Records a real deposit against an existing real income source (match by real name, " +
        "case-insensitive — use set_income_source first if it doesn't exist yet). If that " +
        "source has a real pay cycle length set, its next_pay_date is automatically advanced " +
        "to date + payFrequencyDays — real and deterministic, never guessed.")]
    public async Task<string> RecordIncomeAsync(
        [Description("The income source's real name, exactly as saved by set_income_source (case-insensitive).")]
        string sourceName,
        [Description("The real deposit amount, in dollars.")]
        decimal amount,
        [Description("The real deposit date, e.g. 2026-09-05.")]
        DateOnly date,
        [Description("Optional real notes about this deposit.")]
        string? notes = null)
    {
        var result = await incomeRepository.RecordEntryAsync(ConnectionString, sourceName, amount, date, notes);
        if (!result.Success || result.Entry is null)
        {
            return $"Could not record income for \"{sourceName}\": {result.ErrorMessage}";
        }

        var advanceSuffix = result.NewNextPayDate is null
            ? ""
            : $" next_pay_date advanced to {result.NewNextPayDate:yyyy-MM-dd}.";
        return $"Recorded {Money(amount)} for \"{result.Entry.SourceName}\" on {date:yyyy-MM-dd}.{advanceSuffix}";
    }

    [McpServerTool(Name = "get_income_history")]
    [Description(
        "Real income entries, most-recent-first, optionally filtered to one real income " +
        "source (match by real name, case-insensitive). Default limit 20, capped at 100 — " +
        "same convention as recent_transactions.")]
    public async Task<string> GetIncomeHistoryAsync(
        [Description("Optional real income source name to filter to, exactly as saved by set_income_source (case-insensitive).")]
        string? sourceName = null,
        [Description("Maximum number of real entries to return, most recent first. Default 20, capped at 100.")]
        int limit = 20)
    {
        var result = await incomeRepository.GetHistoryAsync(ConnectionString, sourceName, limit);
        if (!result.Success)
        {
            return $"Could not read income history: {result.ErrorMessage}";
        }

        if (result.Entries.Count == 0)
        {
            return string.IsNullOrWhiteSpace(sourceName)
                ? "No income entries recorded yet."
                : $"\"{sourceName}\" has no income entries recorded yet.";
        }

        var sb = new StringBuilder();
        var scope = string.IsNullOrWhiteSpace(sourceName) ? "all sources" : $"\"{sourceName}\"";
        sb.AppendLine($"Most recent {result.Entries.Count} income entry/entries ({scope}):");
        foreach (var entry in result.Entries)
        {
            var notesSuffix = string.IsNullOrWhiteSpace(entry.Notes) ? "" : $" — {entry.Notes}";
            sb.AppendLine($"  - {entry.Date:yyyy-MM-dd}  {Money(entry.Amount)}  {entry.SourceName}{notesSuffix}");
        }

        return sb.ToString().TrimEnd();
    }

    private static string Money(decimal? amount) =>
        amount is null ? "unknown" : amount.Value.ToString("C2", Usd);
}
