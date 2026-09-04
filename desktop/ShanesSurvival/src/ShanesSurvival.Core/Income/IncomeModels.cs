namespace ShanesSurvival.Core.Income;

/// <summary>One real income source (migrations/005_income_tracking.sql).</summary>
public sealed record IncomeSourceRow(
    Guid Id,
    string Name,
    string Person,
    int? PayFrequencyDays,
    decimal? ExpectedPerCycle,
    DateOnly? NextPayDate,
    bool IsActive);

/// <summary>One real deposit against an income source.</summary>
public sealed record IncomeEntryRow(
    Guid Id,
    Guid SourceId,
    string SourceName,
    DateOnly Date,
    decimal Amount,
    string? Notes,
    DateTimeOffset CreatedAt);

public sealed record IncomeSourceWriteResult(bool Success, IncomeSourceRow? Source, string? ErrorMessage);
public sealed record IncomeEntryWriteResult(bool Success, IncomeEntryRow? Entry, DateOnly? NewNextPayDate, string? ErrorMessage);
public sealed record IncomeHistoryResult(bool Success, IReadOnlyList<IncomeEntryRow> Entries, string? ErrorMessage);
public sealed record IncomeSourceListResult(bool Success, IReadOnlyList<IncomeSourceRow> Sources, string? ErrorMessage);
