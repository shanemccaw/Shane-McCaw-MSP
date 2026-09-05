using Npgsql;
using ShanesSurvival.Core.Transactions;

namespace ShanesSurvival.Core.Dashboard;

/// <summary>
/// Real shortfall math computed live off real Plaid balances already in Postgres — not
/// transaction inference, since funding happens manually/irregularly and balances are the
/// honest signal. Never throws: every real failure becomes a Result the UI shows, same
/// pattern as the rest of this app's services.
///
/// Math (per the real spec worked out with Shane on 2026-09-04, extended 2026-09-04 (#2909)
/// to include real reserve accounts):
///   Per bill account: shortfall = max(0, target_amount - current_balance)
///   Total shortfall  = sum across every bill account (accounts missing a target/balance are
///                       excluded from the sum and called out in Warnings, never silently
///                       treated as $0 or as fully unfunded)
///   Reserve total    = sum of every real role = 'reserve' account's current_balance (accounts
///                       missing a balance are excluded and called out in Warnings, same
///                       convention as bill shortfalls)
///   Total available  = Income Gate account's current_balance + reserve total
///   Top-line         = total available - total shortfall
/// </summary>
public sealed class DashboardService(TransactionTagRepository transactionTagRepository)
{
    private const int BleedLookbackDays = 30;

    public async Task<DashboardResult> ComputeAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return Failure("No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            var warnings = new List<string>();

            var incomeGateAccounts = await LoadRoleAccountsAsync(connection, "income_gate");
            decimal? incomeGateBalance = null;
            string? incomeGateName = null;
            if (incomeGateAccounts.Count == 0)
            {
                warnings.Add("No account assigned the Income Gate role yet — open \"Assign Account Roles…\".");
            }
            else
            {
                if (incomeGateAccounts.Count > 1)
                {
                    warnings.Add(
                        $"{incomeGateAccounts.Count} accounts are assigned Income Gate — using \"{incomeGateAccounts[0].Name}\". " +
                        "Only one should carry this role; reassign the rest in \"Assign Account Roles…\".");
                }
                var gate = incomeGateAccounts[0];
                incomeGateName = gate.Name;
                incomeGateBalance = gate.CurrentBalance;
                if (incomeGateBalance is null)
                {
                    warnings.Add($"\"{gate.Name}\" has no real balance from Plaid yet — click \"Sync Now\".");
                }
            }

            var billAccounts = await LoadRoleAccountsAsync(connection, "bill");
            var bills = new List<BillStatus>();
            foreach (var account in billAccounts)
            {
                string? warning = null;
                decimal? shortfall = null;

                if (account.TargetAmount is null)
                {
                    warning = "target not set";
                }
                else if (account.CurrentBalance is null)
                {
                    warning = "balance unknown — Sync Now";
                }
                else
                {
                    shortfall = Math.Max(0m, account.TargetAmount.Value - account.CurrentBalance.Value);
                }

                bills.Add(new BillStatus(
                    account.Id, account.Name, account.TargetAmount, account.CurrentBalance,
                    account.IsGate, shortfall, warning, account.LastPaidDate));
            }

            foreach (var missing in bills.Where(b => b.Warning is not null))
            {
                warnings.Add($"\"{missing.Name}\": {missing.Warning} — excluded from total shortfall.");
            }

            var totalShortfall = bills.Where(b => b.Shortfall.HasValue).Sum(b => b.Shortfall!.Value);

            var reserveRoleAccounts = await LoadRoleAccountsAsync(connection, "reserve");
            var reserveAccounts = reserveRoleAccounts
                .Select(a => new ReserveAccountBalance(a.Id, a.Name, a.CurrentBalance))
                .ToList();
            foreach (var reserve in reserveAccounts.Where(r => r.CurrentBalance is null))
            {
                warnings.Add($"\"{reserve.Name}\" has no real balance from Plaid yet — click \"Sync Now\". Excluded from reserve total.");
            }
            var reserveTotal = reserveAccounts.Where(r => r.CurrentBalance.HasValue).Sum(r => r.CurrentBalance!.Value);

            var totalAvailable = incomeGateBalance.HasValue ? incomeGateBalance.Value + reserveTotal : (decimal?)null;
            var topLine = totalAvailable.HasValue ? totalAvailable.Value - totalShortfall : (decimal?)null;

            var gateBills = bills.Where(b => b.IsGate)
                .OrderByDescending(b => b.Shortfall ?? -1m)
                .ToList();
            var otherBills = bills.Where(b => !b.IsGate)
                .OrderByDescending(b => b.Shortfall ?? -1m)
                .ToList();

            var tagRules = await transactionTagRepository.ListAsync(connectionString);
            if (!tagRules.Success)
            {
                warnings.Add($"Could not load transaction tag rules — spend bleed will not reflect tagging: {tagRules.ErrorMessage}");
            }

            var spendAccounts = await LoadRoleAccountsAsync(connection, "spend");
            var spendBleed = new List<SpendAccountBleed>();
            foreach (var account in spendAccounts)
            {
                spendBleed.Add(await LoadMerchantBleedAsync(connection, account.Id, account.Name, tagRules.Rules));
            }
            if (spendAccounts.Count == 0)
            {
                warnings.Add("No account assigned the Spend role yet — open \"Assign Account Roles…\".");
            }

            return new DashboardResult(
                true, null, warnings,
                incomeGateBalance, incomeGateName,
                gateBills, otherBills, totalShortfall, topLine, spendBleed,
                reserveAccounts, reserveTotal, totalAvailable);
        }
        catch (Exception ex)
        {
            return Failure($"Could not compute dashboard: {ex.Message}");
        }
    }

    private sealed record RoleAccount(
        Guid Id, string Name, decimal? CurrentBalance, decimal? TargetAmount, bool IsGate, DateOnly? LastPaidDate);

    private static async Task<List<RoleAccount>> LoadRoleAccountsAsync(NpgsqlConnection connection, string role)
    {
        var accounts = new List<RoleAccount>();
        await using var command = new NpgsqlCommand(
            "SELECT id, name, current_balance, target_amount, is_gate, last_paid_date FROM accounts WHERE role = @role ORDER BY name",
            connection);
        command.Parameters.AddWithValue("role", role);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            accounts.Add(new RoleAccount(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetDecimal(2),
                reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                reader.GetBoolean(4),
                reader.IsDBNull(5) ? null : DateOnly.FromDateTime(reader.GetDateTime(5))));
        }
        return accounts;
    }

    /// <summary>
    /// Real transactions for one spend account, over the last <see cref="BleedLookbackDays"/>
    /// days. Only positive amounts count as spend — Plaid's sign convention has outflows
    /// positive and inflows (refunds, transfers in) negative, so including negatives here would
    /// understate real spend.
    ///
    /// Every transaction is first checked against every real transaction_tags rule (#2931) — a
    /// match (first rule wins, ties broken by rule creation order) pulls that transaction out of
    /// the merchant grouping entirely and into TaggedSpend instead, grouped/summed by the rule's
    /// own Tag, so a real recurring meaning (e.g. "Ronnie's medication (cash)") doesn't get
    /// buried inside its merchant's raw total. Untagged transactions are grouped/summed by
    /// merchant exactly as before.
    /// </summary>
    private static async Task<SpendAccountBleed> LoadMerchantBleedAsync(
        NpgsqlConnection connection, Guid accountId, string accountName, IReadOnlyList<TransactionTagRule> tagRules)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT COALESCE(NULLIF(merchant_name, ''), 'Unknown merchant') AS merchant,
                   name,
                   amount
            FROM transactions
            WHERE account_id = @accountId
              AND amount > 0
              AND date >= CURRENT_DATE - (@lookbackDays || ' days')::interval
            """, connection);
        command.Parameters.AddWithValue("accountId", accountId);
        command.Parameters.AddWithValue("lookbackDays", BleedLookbackDays);

        var merchantTotals = new Dictionary<string, (int Count, decimal Total)>();
        var tagTotals = new Dictionary<string, (int Count, decimal Total)>();
        (int Count, decimal Total) EmptyTally() => (0, 0m);
        decimal totalSpent = 0m;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var merchant = reader.GetString(0);
            var name = reader.IsDBNull(1) ? null : reader.GetString(1);
            var amount = reader.GetDecimal(2);
            totalSpent += amount;

            var matchedRule = tagRules.FirstOrDefault(rule => rule.Matches(merchant, name, amount));
            if (matchedRule is not null)
            {
                var existing = tagTotals.TryGetValue(matchedRule.Tag, out var found) ? found : EmptyTally();
                tagTotals[matchedRule.Tag] = (existing.Count + 1, existing.Total + amount);
            }
            else
            {
                var existing = merchantTotals.TryGetValue(merchant, out var found) ? found : EmptyTally();
                merchantTotals[merchant] = (existing.Count + 1, existing.Total + amount);
            }
        }

        var merchants = merchantTotals
            .Select(kv => new MerchantBleed(kv.Key, kv.Value.Count, kv.Value.Total))
            .OrderByDescending(m => m.TotalAmount)
            .ToList();
        var taggedSpend = tagTotals
            .Select(kv => new TaggedBleed(kv.Key, kv.Value.Count, kv.Value.Total))
            .OrderByDescending(t => t.TotalAmount)
            .ToList();

        return new SpendAccountBleed(accountId, accountName, merchants, taggedSpend, totalSpent);
    }

    private static DashboardResult Failure(string message) =>
        new(false, message, [], null, null, [], [], 0m, null, [], [], 0m, null);
}
