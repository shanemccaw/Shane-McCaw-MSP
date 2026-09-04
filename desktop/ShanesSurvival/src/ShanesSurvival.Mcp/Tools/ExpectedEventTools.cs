using System.ComponentModel;
using System.Globalization;
using System.Text;
using ModelContextProtocol.Server;
using ShanesSurvival.Core.ExpectedEvents;
using ShanesSurvival.Core.Settings;

namespace ShanesSurvival.Mcp.Tools;

/// <summary>
/// Real MCP tools for expected_one_time_events (#2910) — a pending one-time inflow/outflow
/// that hasn't happened yet, e.g. a real insurance deductible owed or a contingent
/// reimbursement. Lets Shane tell Claude Desktop "keep this in mind for the plan" without it
/// being silently counted as real money until it's actually realized. Deliberately not linked
/// into gate_status/bill_status shortfall math — see get_gate_status/get_bill_status for real
/// current-balance math, which this intentionally does not touch.
/// </summary>
[McpServerToolType]
public sealed class ExpectedEventTools(SettingsService settingsService, ExpectedEventRepository eventRepository)
{
    private static readonly CultureInfo Usd = CultureInfo.GetCultureInfo("en-US");

    private string? ConnectionString => settingsService.Load().PostgresConnectionString;

    [McpServerTool(Name = "record_expected_event")]
    [Description(
        "Records a real pending one-time inflow or outflow that hasn't happened yet — e.g. an " +
        "insurance deductible owed, or a contingent reimbursement. Always creates a new pending " +
        "event; not counted as real money until mark_event_realized is called.")]
    public async Task<string> RecordExpectedEventAsync(
        [Description("Real plain-language description, e.g. \"Roof insurance deductible\" or \"Roof repair reimbursement\".")]
        string description,
        [Description("Whether this is real money coming IN (\"inflow\") or going OUT (\"outflow\").")]
        string direction,
        [Description("The real one-time amount, in dollars.")]
        decimal amount,
        [Description("Real expected date, if known. Often genuinely unknown — leave unset.")]
        DateOnly? expectedDate = null,
        [Description("Optional real contingency, e.g. \"after roofing company certifies completion with insurer\".")]
        string? contingencyNotes = null)
    {
        var result = await eventRepository.RecordAsync(
            ConnectionString, description, direction, amount, expectedDate, contingencyNotes);
        if (!result.Success || result.Event is null)
        {
            return $"Could not record expected event \"{description}\": {result.ErrorMessage}";
        }

        return $"Recorded pending {result.Event.Direction} \"{result.Event.Description}\": {Money(result.Event.Amount)}" +
               FormatDate(result.Event.ExpectedDate) +
               FormatContingency(result.Event.ContingencyNotes) +
               $". Id {result.Event.Id}. Run get_expected_events to confirm.";
    }

    [McpServerTool(Name = "get_expected_events")]
    [Description(
        "Lists every real pending one-time event (status = 'pending'), most-relevant first: " +
        "events with a real expected_date soonest first, then no-date ones after. Realized/" +
        "cancelled events are not real anymore and are excluded.")]
    public async Task<string> GetExpectedEventsAsync()
    {
        var result = await eventRepository.ListPendingAsync(ConnectionString);
        if (!result.Success)
        {
            return $"Could not read expected events: {result.ErrorMessage}";
        }

        if (result.Events.Count == 0)
        {
            return "No pending expected events recorded.";
        }

        var sb = new StringBuilder();
        sb.AppendLine($"{result.Events.Count} real pending expected event(s):");

        foreach (var ev in result.Events)
        {
            sb.AppendLine(
                $"  - [{ev.Direction}] {ev.Description}: {Money(ev.Amount)}{FormatDate(ev.ExpectedDate)}" +
                $"{FormatContingency(ev.ContingencyNotes)} (id {ev.Id})");
        }

        return sb.ToString().TrimEnd();
    }

    [McpServerTool(Name = "mark_event_realized")]
    [Description(
        "Marks a real pending expected event as realized — the real inflow/outflow actually " +
        "happened. Does NOT write into debts/income_entries/any account balance; Shane still " +
        "confirms the real transaction separately. Idempotent — marking an already-realized " +
        "event again is a safe no-op.")]
    public async Task<string> MarkEventRealizedAsync(
        [Description("The real expected event's id, from record_expected_event or get_expected_events.")]
        Guid eventId)
    {
        var result = await eventRepository.MarkRealizedAsync(ConnectionString, eventId);
        if (!result.Success || result.Event is null)
        {
            return $"Could not mark expected event realized: {result.ErrorMessage}";
        }

        return $"\"{result.Event.Description}\" ({Money(result.Event.Amount)}, {result.Event.Direction}) is now realized. " +
               "This was not written into debts/income/any account balance — record that separately if it's a real transaction.";
    }

    private static string FormatDate(DateOnly? date) =>
        date is null ? "" : $", expected {date.Value:yyyy-MM-dd}";

    private static string FormatContingency(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? "" : $" — {notes}";

    private static string Money(decimal amount) => amount.ToString("C2", Usd);
}
