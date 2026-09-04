namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// One real Bill-role account with a due_day falling within a queried pay-period window
/// (migrations/007_bill_due_days.sql, #2904). TargetAmount/Warning follow the same
/// null-means-genuinely-unknown convention as <see cref="BillStatus"/> — a bill with no
/// target set still shows up here (it's genuinely due), just excluded from the real sum.
/// </summary>
public sealed record DueBill(
    Guid AccountId,
    string Name,
    DateOnly DueDate,
    decimal? TargetAmount,
    string? Warning);

public sealed record PayPeriodDueResult(
    bool Success,
    string? ErrorMessage,
    IReadOnlyList<string> Warnings,
    DateOnly Today,
    DateOnly NextPayDate,
    IReadOnlyList<DueBill> DueBills,
    decimal TotalDue);
