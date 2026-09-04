using Npgsql;

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
public sealed class DashboardService
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
                    account.IsGate, shortfall, warning));
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

            var spendAccounts = await LoadRoleAccountsAsync(connection, "spend");
            var spendBleed = new List<SpendAccountBleed>();
            foreach (var account in spendAccounts)
            {
                spendBleed.Add(await LoadMerchantBleedAsync(connection, account.Id, account.Name));
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

    private sealed record RoleAccount(Guid Id, string Name, decimal? CurrentBalance, decimal? TargetAmount, bool IsGate);

    private static async Task<List<RoleAccount>> LoadRoleAccountsAsync(NpgsqlConnection connection, string role)
    {
        var accounts = new List<RoleAccount>();
        await using var command = new NpgsqlCommand(
            "SELECT id, name, current_balance, target_amount, is_gate FROM accounts WHERE role = @role ORDER BY name",
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
                reader.GetBoolean(4)));
        }
        return accounts;
    }

    /// <summary>
    /// Real transactions for one spend account, over the last <see cref="BleedLookbackDays"/>
    /// days, grouped/summed by merchant so a pattern (many small charges at one merchant) is
    /// visible at a glance. Only positive amounts count as spend — Plaid's sign convention has
    /// outflows positive and inflows (refunds, transfers in) negative, so including negatives
    /// here would understate real spend.
    /// </summary>
    private static async Task<SpendAccountBleed> LoadMerchantBleedAsync(NpgsqlConnection connection, Guid accountId, string accountName)
    {
        var merchants = new List<MerchantBleed>();
        await using var command = new NpgsqlCommand(
            """
            SELECT COALESCE(NULLIF(merchant_name, ''), 'Unknown merchant') AS merchant,
                   COUNT(*) AS tx_count,
                   SUM(amount) AS total_amount
            FROM transactions
            WHERE account_id = @accountId
              AND amount > 0
              AND date >= CURRENT_DATE - (@lookbackDays || ' days')::interval
            GROUP BY merchant
            ORDER BY total_amount DESC
            """, connection);
        command.Parameters.AddWithValue("accountId", accountId);
        command.Parameters.AddWithValue("lookbackDays", BleedLookbackDays);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            merchants.Add(new MerchantBleed(reader.GetString(0), (int)reader.GetInt64(1), reader.GetDecimal(2)));
        }

        return new SpendAccountBleed(accountId, accountName, merchants, merchants.Sum(m => m.TotalAmount));
    }

    private static DashboardResult Failure(string message) =>
        new(false, message, [], null, null, [], [], 0m, null, [], [], 0m, null);
}
