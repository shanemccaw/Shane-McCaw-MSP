using System.IO;
using Npgsql;

namespace ShanesSurvival.App.Data;

public enum MigrationOutcome
{
    /// <summary>This run executed the file for the first time.</summary>
    Applied,

    /// <summary>schema_migrations already had a row for this file — skipped.</summary>
    AlreadyApplied,
}

public sealed record MigrationStepResult(string FileName, MigrationOutcome Outcome);

/// <summary>
/// Outcome of a migration run. <see cref="Success"/> is false only when something actually
/// went wrong (unreachable database, missing migrations folder, or a file failing partway
/// through) — never for "nothing new to apply", which is a normal, successful no-op.
/// </summary>
public sealed record MigrationRunResult(
    bool Success,
    IReadOnlyList<MigrationStepResult> Steps,
    string? FailedFileName,
    string? ErrorMessage);

/// <summary>
/// Applies every migrations/*.sql file, in filename order, against the configured Postgres
/// database — the real replacement for running `psql -f migrations/001_init.sql` by hand.
/// Tracks progress in a real schema_migrations table (filename, applied_at) so re-running is
/// always safe: already-applied files are skipped, never re-executed.
///
/// Each file is sent to Postgres as-is, exactly like `psql -f` would send it — so a file's own
/// BEGIN/COMMIT (as in 001_init.sql) still governs its own atomicity. The bookkeeping INSERT
/// into schema_migrations happens as a separate statement right after a file's script commits.
/// If the app were killed in the instant between those two statements, a non-idempotent future
/// migration could be re-attempted on the next run. 001_init.sql avoids that today by using
/// CREATE TABLE/INDEX IF NOT EXISTS throughout; later migrations should keep that convention.
/// </summary>
public sealed class MigrationRunner
{
    private const string MigrationsFolderName = "migrations";

    public async Task<MigrationRunResult> RunAsync(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return new MigrationRunResult(
                false, [], null,
                "No Postgres connection string configured. Open Settings to add one.");
        }

        string migrationsDir;
        try
        {
            migrationsDir = FindMigrationsDirectory();
        }
        catch (DirectoryNotFoundException ex)
        {
            return new MigrationRunResult(false, [], null, ex.Message);
        }

        var files = Directory.GetFiles(migrationsDir, "*.sql")
            .OrderBy(f => Path.GetFileName(f), StringComparer.Ordinal)
            .ToArray();

        var steps = new List<MigrationStepResult>();

        // Everything below, including opening the connection, can throw — same reasoning as
        // DatabaseConnectionTester: never let a real failure escape as an unhandled exception.
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();

            await using (var createTrackingTable = new NpgsqlCommand(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    filename    TEXT PRIMARY KEY,
                    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """, connection))
            {
                await createTrackingTable.ExecuteNonQueryAsync();
            }

            var alreadyApplied = new HashSet<string>(StringComparer.Ordinal);
            await using (var selectApplied = new NpgsqlCommand("SELECT filename FROM schema_migrations", connection))
            await using (var reader = await selectApplied.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    alreadyApplied.Add(reader.GetString(0));
                }
            }

            foreach (var file in files)
            {
                var fileName = Path.GetFileName(file);

                if (alreadyApplied.Contains(fileName))
                {
                    steps.Add(new MigrationStepResult(fileName, MigrationOutcome.AlreadyApplied));
                    continue;
                }

                try
                {
                    var sql = await File.ReadAllTextAsync(file);

                    await using (var runMigration = new NpgsqlCommand(sql, connection) { CommandTimeout = 120 })
                    {
                        await runMigration.ExecuteNonQueryAsync();
                    }

                    await using (var recordApplied = new NpgsqlCommand(
                        "INSERT INTO schema_migrations (filename) VALUES (@filename)", connection))
                    {
                        recordApplied.Parameters.AddWithValue("filename", fileName);
                        await recordApplied.ExecuteNonQueryAsync();
                    }

                    steps.Add(new MigrationStepResult(fileName, MigrationOutcome.Applied));
                }
                catch (Exception ex)
                {
                    // Stop at the first failure — don't attempt later files out of order on
                    // top of a database that may now be in a partially-migrated state.
                    return new MigrationRunResult(false, steps, fileName, ex.Message);
                }
            }

            return new MigrationRunResult(true, steps, null, null);
        }
        catch (Exception ex)
        {
            return new MigrationRunResult(false, steps, null, $"Could not reach Postgres: {ex.Message}");
        }
    }

    /// <summary>
    /// Walks up from the running app's own folder to find the repo's migrations/ folder, so
    /// this works whether run via `dotnet run` from the repo root (cwd = repo root) or by
    /// launching the built .exe directly (cwd = bin/Debug/net8.0-windows/).
    /// </summary>
    private static string FindMigrationsDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, MigrationsFolderName);
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            $"Could not find a '{MigrationsFolderName}' folder above {AppContext.BaseDirectory}.");
    }
}
