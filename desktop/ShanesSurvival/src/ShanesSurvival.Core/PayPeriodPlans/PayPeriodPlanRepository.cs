using Npgsql;

namespace ShanesSurvival.Core.PayPeriodPlans;

/// <summary>
/// Real read/write access to pay_period_plans/pay_period_plan_allocations
/// (migrations/004_pay_period_plans.sql). Never throws: every real failure becomes a Result the
/// caller (WPF Dashboard or an MCP tool) shows, same pattern as AccountRepository/
/// DashboardService/TransactionRepository. No programmatic money movement of any kind — every
/// method here only ever writes a plan/allocation row to this app's own Postgres database; a
/// real transfer still has to happen manually in Shane's own bank app, and
/// <see cref="MarkAllocationExecutedAsync"/> only records that it happened after the fact.
/// </summary>
public sealed class PayPeriodPlanRepository
{
    /// <summary>
    /// Creates a new plan, immediately Active. All-or-nothing: if any allocation names an
    /// account that doesn't exist, nothing is written and the real unmatched name(s) are
    /// reported, so a typo'd account name can't silently create a plan with fewer allocations
    /// than Shane asked for.
    /// </summary>
    public async Task<PlanWriteResult> CreateAsync(
        string? connectionString, decimal incomeAmount, DateOnly payDate, string? notes,
        IReadOnlyList<AllocationInput> allocations)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlanWriteResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }
        if (allocations.Count == 0)
        {
            return new PlanWriteResult(false, null, "A plan needs at least one allocation.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            var resolved = await ResolveAccountsAsync(connection, transaction, allocations);
            if (resolved.ErrorMessage is not null)
            {
                return new PlanWriteResult(false, null, resolved.ErrorMessage);
            }

            var planId = Guid.NewGuid();
            await using (var insertPlan = new NpgsqlCommand(
                """
                INSERT INTO pay_period_plans (id, pay_date, income_amount, status, notes)
                VALUES (@id, @payDate, @incomeAmount, @status, @notes)
                """, connection, transaction))
            {
                insertPlan.Parameters.AddWithValue("id", planId);
                insertPlan.Parameters.AddWithValue("payDate", payDate);
                insertPlan.Parameters.AddWithValue("incomeAmount", incomeAmount);
                insertPlan.Parameters.AddWithValue("status", PlanStatus.Active.ToDbValue());
                insertPlan.Parameters.AddWithValue("notes", (object?)notes ?? DBNull.Value);
                await insertPlan.ExecuteNonQueryAsync();
            }

            await InsertAllocationsAsync(connection, transaction, planId, resolved.Resolved);

            await transaction.CommitAsync();
            return new PlanWriteResult(true, planId, null);
        }
        catch (Exception ex)
        {
            return new PlanWriteResult(false, null, $"Could not create pay-period plan: {ex.Message}");
        }
    }

    /// <summary>
    /// Mid-cycle adjustment: replaces every NOT-yet-executed allocation on the plan with
    /// <paramref name="newAllocations"/>. Allocations already marked executed are left alone —
    /// revising a plan must never erase the record of a real transfer that already happened.
    /// </summary>
    public async Task<PlanWriteResult> ReviseAsync(
        string? connectionString, Guid planId, IReadOnlyList<AllocationInput> newAllocations)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlanWriteResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }
        if (newAllocations.Count == 0)
        {
            return new PlanWriteResult(false, null, "A revised plan needs at least one allocation.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            await using (var checkPlan = new NpgsqlCommand(
                "SELECT status FROM pay_period_plans WHERE id = @id", connection, transaction))
            {
                checkPlan.Parameters.AddWithValue("id", planId);
                var status = await checkPlan.ExecuteScalarAsync();
                if (status is null)
                {
                    return new PlanWriteResult(false, null, "No pay-period plan found with that id.");
                }
                if ((string)status == PlanStatus.Completed.ToDbValue())
                {
                    return new PlanWriteResult(false, null, "That plan is already completed and can't be revised.");
                }
            }

            var resolved = await ResolveAccountsAsync(connection, transaction, newAllocations);
            if (resolved.ErrorMessage is not null)
            {
                return new PlanWriteResult(false, null, resolved.ErrorMessage);
            }

            await using (var deleteUnexecuted = new NpgsqlCommand(
                "DELETE FROM pay_period_plan_allocations WHERE plan_id = @planId AND executed = false",
                connection, transaction))
            {
                deleteUnexecuted.Parameters.AddWithValue("planId", planId);
                await deleteUnexecuted.ExecuteNonQueryAsync();
            }

            await InsertAllocationsAsync(connection, transaction, planId, resolved.Resolved);

            await transaction.CommitAsync();
            return new PlanWriteResult(true, planId, null);
        }
        catch (Exception ex)
        {
            return new PlanWriteResult(false, null, $"Could not revise pay-period plan: {ex.Message}");
        }
    }

    /// <summary>
    /// Records that a real transfer Shane already made in his own bank app has happened.
    /// Idempotent — marking an already-executed allocation again is a safe no-op, not an error.
    /// Once every allocation on the owning plan is executed, the plan itself flips to Completed.
    /// </summary>
    public async Task<AllocationWriteResult> MarkAllocationExecutedAsync(string? connectionString, Guid allocationId)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new AllocationWriteResult(false, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();

            Guid planId;
            await using (var markExecuted = new NpgsqlCommand(
                """
                UPDATE pay_period_plan_allocations
                SET executed = true, executed_at = now()
                WHERE id = @id
                RETURNING plan_id
                """, connection, transaction))
            {
                markExecuted.Parameters.AddWithValue("id", allocationId);
                var result = await markExecuted.ExecuteScalarAsync();
                if (result is null)
                {
                    return new AllocationWriteResult(false, "No allocation found with that id.");
                }
                planId = (Guid)result;
            }

            await using (var remainingCheck = new NpgsqlCommand(
                "SELECT COUNT(*) FROM pay_period_plan_allocations WHERE plan_id = @planId AND executed = false",
                connection, transaction))
            {
                remainingCheck.Parameters.AddWithValue("planId", planId);
                var remaining = (long)(await remainingCheck.ExecuteScalarAsync() ?? 0L);
                if (remaining == 0)
                {
                    await using var completePlan = new NpgsqlCommand(
                        "UPDATE pay_period_plans SET status = @status WHERE id = @id AND status <> @status",
                        connection, transaction);
                    completePlan.Parameters.AddWithValue("status", PlanStatus.Completed.ToDbValue());
                    completePlan.Parameters.AddWithValue("id", planId);
                    await completePlan.ExecuteNonQueryAsync();
                }
            }

            await transaction.CommitAsync();
            return new AllocationWriteResult(true, null);
        }
        catch (Exception ex)
        {
            return new AllocationWriteResult(false, $"Could not mark allocation executed: {ex.Message}");
        }
    }

    /// <summary>
    /// The most recent plan that isn't Completed (Active, or the rarer Proposed), with every
    /// allocation's real current Plaid balance joined in so a progress check is grounded in
    /// what's actually landed. Success with a null Plan means "no active plan right now" — not
    /// an error.
    /// </summary>
    public async Task<PlanResult> GetActiveAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new PlanResult(false, null, "No Postgres connection string configured. Open Settings to add one.");
        }

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            Guid planId;
            DateOnly payDate;
            decimal incomeAmount;
            PlanStatus status;
            string? notes;
            DateTimeOffset createdAt;

            await using (var command = new NpgsqlCommand(
                """
                SELECT id, pay_date, income_amount, status, notes, created_at
                FROM pay_period_plans
                WHERE status <> 'completed'
                ORDER BY created_at DESC
                LIMIT 1
                """, connection))
            {
                await using var reader = await command.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                {
                    return new PlanResult(true, null, null);
                }

                planId = reader.GetGuid(0);
                payDate = DateOnly.FromDateTime(reader.GetDateTime(1));
                incomeAmount = reader.GetDecimal(2);
                status = PlanStatusExtensions.ParseDbValue(reader.GetString(3));
                notes = reader.IsDBNull(4) ? null : reader.GetString(4);
                createdAt = reader.GetFieldValue<DateTimeOffset>(5);
            }

            var allocations = new List<PlanAllocationRow>();
            await using (var command = new NpgsqlCommand(
                """
                SELECT a.id, a.account_id, acc.name, a.amount, a.reason, a.executed, a.executed_at,
                       acc.current_balance
                FROM pay_period_plan_allocations a
                JOIN accounts acc ON acc.id = a.account_id
                WHERE a.plan_id = @planId
                ORDER BY acc.name
                """, connection))
            {
                command.Parameters.AddWithValue("planId", planId);
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    allocations.Add(new PlanAllocationRow(
                        reader.GetGuid(0),
                        reader.GetGuid(1),
                        reader.GetString(2),
                        reader.GetDecimal(3),
                        reader.IsDBNull(4) ? null : reader.GetString(4),
                        reader.GetBoolean(5),
                        reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                        reader.IsDBNull(7) ? null : reader.GetDecimal(7)));
                }
            }

            return new PlanResult(true, new PayPeriodPlanRow(planId, payDate, incomeAmount, status, notes, createdAt, allocations), null);
        }
        catch (Exception ex)
        {
            return new PlanResult(false, null, $"Could not read the active pay-period plan: {ex.Message}");
        }
    }

    private sealed record ResolvedAllocations(IReadOnlyList<(Guid AccountId, decimal Amount, string? Reason)> Resolved, string? ErrorMessage);

    /// <summary>
    /// Resolves each allocation's account name to a real account id (case-insensitive, matching
    /// the same convention <c>recent_transactions</c> already uses), inside the same transaction
    /// as the write that will use it. Any unmatched name fails the whole batch rather than
    /// silently dropping an allocation.
    /// </summary>
    private static async Task<ResolvedAllocations> ResolveAccountsAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, IReadOnlyList<AllocationInput> allocations)
    {
        var resolved = new List<(Guid, decimal, string?)>();
        var notFound = new List<string>();

        foreach (var allocation in allocations)
        {
            await using var command = new NpgsqlCommand(
                "SELECT id FROM accounts WHERE lower(name) = lower(@name)", connection, transaction);
            command.Parameters.AddWithValue("name", allocation.AccountName);
            var id = await command.ExecuteScalarAsync();
            if (id is null)
            {
                notFound.Add(allocation.AccountName);
            }
            else
            {
                resolved.Add(((Guid)id, allocation.Amount, allocation.Reason));
            }
        }

        if (notFound.Count > 0)
        {
            return new ResolvedAllocations([], $"No account found named: {string.Join(", ", notFound)}. Use bill_status/spend_bleed/gate_status to see real account names.");
        }

        return new ResolvedAllocations(resolved, null);
    }

    private static async Task InsertAllocationsAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, Guid planId,
        IReadOnlyList<(Guid AccountId, decimal Amount, string? Reason)> allocations)
    {
        foreach (var (accountId, amount, reason) in allocations)
        {
            await using var command = new NpgsqlCommand(
                """
                INSERT INTO pay_period_plan_allocations (id, plan_id, account_id, amount, reason)
                VALUES (@id, @planId, @accountId, @amount, @reason)
                """, connection, transaction);
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("planId", planId);
            command.Parameters.AddWithValue("accountId", accountId);
            command.Parameters.AddWithValue("amount", amount);
            command.Parameters.AddWithValue("reason", (object?)reason ?? DBNull.Value);
            await command.ExecuteNonQueryAsync();
        }
    }
}
