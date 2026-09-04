using Npgsql;

namespace ShanesSurvival.App.Data;

public enum DatabaseConnectionStatus
{
    /// <summary>No connection string has been entered in Settings yet.</summary>
    NotConfigured,

    /// <summary>Connected, and every table the schema requires is present.</summary>
    Connected,

    /// <summary>Could not open a connection at all — wrong credentials, host down, etc.</summary>
    Unreachable,

    /// <summary>Connected, but one or more required tables are missing — migrations/001_init.sql
    /// has not been run against this database yet.</summary>
    SchemaMissing,
}

public sealed record DatabaseConnectionResult(DatabaseConnectionStatus Status, string Message)
{
    public bool IsHealthy => Status == DatabaseConnectionStatus.Connected;
}

/// <summary>
/// Real startup connectivity + schema check. Never fails silently: every outcome — not
/// configured, unreachable, schema missing, or genuinely connected — is a distinct, explicit
/// result the UI shows plainly.
/// </summary>
public sealed class DatabaseConnectionTester
{
    private static readonly string[] RequiredTables =
    [
        "plaid_items",
        "accounts",
        "transactions",
        "debts",
        "survival_snapshots",
    ];

    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(8);

    public async Task<DatabaseConnectionResult> TestAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new DatabaseConnectionResult(
                DatabaseConnectionStatus.NotConfigured,
                "No Postgres connection string configured. Open Settings to add one.");
        }

        // Everything below, including parsing the connection string itself, can throw.
        // NpgsqlConnection's constructor parses the string eagerly (e.g. a URL-style
        // "postgresql://..." string throws ArgumentException right here, not on open),
        // so it must be inside this try, not before it.
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);

            using var timeoutCts = new CancellationTokenSource(ConnectTimeout);
            try
            {
                await connection.OpenAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                return new DatabaseConnectionResult(
                    DatabaseConnectionStatus.Unreachable,
                    $"Could not reach Postgres: timed out after {ConnectTimeout.TotalSeconds:0}s.");
            }

            var missingTables = new List<string>();
            foreach (var table in RequiredTables)
            {
                await using var command = new NpgsqlCommand("SELECT to_regclass(@table) IS NOT NULL", connection);
                command.Parameters.AddWithValue("table", table);
                var exists = (bool)(await command.ExecuteScalarAsync(timeoutCts.Token) ?? false);
                if (!exists)
                {
                    missingTables.Add(table);
                }
            }

            if (missingTables.Count > 0)
            {
                return new DatabaseConnectionResult(
                    DatabaseConnectionStatus.SchemaMissing,
                    $"Connected to Postgres, but schema is missing: {string.Join(", ", missingTables)}. " +
                    "Run migrations/001_init.sql against this database.");
            }

            return new DatabaseConnectionResult(
                DatabaseConnectionStatus.Connected,
                "Connected to Postgres. Schema is up to date.");
        }
        catch (Exception ex)
        {
            // ex.Message from Npgsql / ArgumentException does not include the password,
            // so this is safe to show. Covers malformed connection strings (e.g. a
            // "postgresql://..." URL instead of "Host=...;...") as well as any other
            // failure while connecting or querying.
            return new DatabaseConnectionResult(
                DatabaseConnectionStatus.Unreachable,
                $"Could not reach Postgres: {ex.Message}");
        }
    }
}
