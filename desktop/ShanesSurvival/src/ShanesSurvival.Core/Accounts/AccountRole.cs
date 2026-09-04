namespace ShanesSurvival.Core.Accounts;

/// <summary>
/// The role Shane explicitly assigns to a synced Plaid account — never inferred from the
/// account's name/type/subtype. Matches the accounts.role TEXT column
/// (migrations/003_account_roles.sql), which is the source of truth; this enum exists purely
/// for type-safe C# handling of that same small, fixed vocabulary.
/// </summary>
public enum AccountRole
{
    /// <summary>role IS NULL — not yet assigned.</summary>
    Unassigned,

    /// <summary>The one Direct Deposit account all real income lands in.</summary>
    IncomeGate,

    /// <summary>One of the ~10+ real bill accounts (mortgage, Tesla, utilities, etc.).</summary>
    Bill,

    /// <summary>One of the 2 household spend accounts (Ronnie &amp; Shane's, DJ's).</summary>
    Spend,
}

public static class AccountRoleExtensions
{
    public static string? ToDbValue(this AccountRole role) => role switch
    {
        AccountRole.IncomeGate => "income_gate",
        AccountRole.Bill => "bill",
        AccountRole.Spend => "spend",
        AccountRole.Unassigned => null,
        _ => null,
    };

    public static AccountRole ParseDbValue(string? value) => value switch
    {
        "income_gate" => AccountRole.IncomeGate,
        "bill" => AccountRole.Bill,
        "spend" => AccountRole.Spend,
        _ => AccountRole.Unassigned,
    };

    public static string DisplayName(this AccountRole role) => role switch
    {
        AccountRole.IncomeGate => "Income Gate (Direct Deposit)",
        AccountRole.Bill => "Bill",
        AccountRole.Spend => "Spend",
        AccountRole.Unassigned => "Unassigned",
        _ => "Unassigned",
    };
}
