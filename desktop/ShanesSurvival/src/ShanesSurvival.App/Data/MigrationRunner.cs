using System.IO;
using System.Text.RegularExpressions;
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

        var duplicateNumberError = FindDuplicateMigrationNumberError(migrationsDir);
        if (duplicateNumberError is not null)
        {
            return new MigrationRunResult(false, [], null, duplicateNumberError);
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

            // Fail closed, loudly, before applying anything if the ledger references a filename
            // that no longer exists in either directory (Git #3140) -- almost always an
            // already-applied migration that got renamed, which would otherwise silently
            // re-run under its new name in the loop below.
            var orphanError = FindOrphanLedgerFilenamesError(migrationsDir, alreadyApplied, files);
            if (orphanError is not null)
            {
                return new MigrationRunResult(false, steps, null, orphanError);
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

    private static readonly Regex NumberPrefix = new(@"^(\d+)_", RegexOptions.Compiled);

    /// <summary>
    /// Guards the migration number space this directory shares with web/shanes-life/migrations
    /// (Git #3118). One Postgres database, two runners each reading their own directory but
    /// writing to the same schema_migrations ledger -- neither runner can execute the other's
    /// files, but nothing previously stopped the same leading number being reused across both
    /// directories, which makes apply order on a fresh database ambiguous. Returns null when
    /// the number spaces don't collide (including when web/shanes-life/migrations can't be
    /// found at all -- that's not this check's job to flag); otherwise a real error message
    /// naming the colliding files.
    ///
    /// Deliberately does NOT flag two files sharing a number within THIS SAME directory (e.g.
    /// 010_debt_is_critical.sql / 010_expected_events.sql) -- that's an existing, already-applied,
    /// single-runner ordering quirk, not the cross-directory ambiguity this guards against.
    /// </summary>
    private static string? FindDuplicateMigrationNumberError(string ownMigrationsDir)
    {
        var otherMigrationsDir = FindSiblingMigrationsDirectory(ownMigrationsDir);
        if (otherMigrationsDir is null)
        {
            return null; // sibling directory not present in this checkout -- nothing to compare against
        }

        var ownNumbers = ExtractNumbers(ownMigrationsDir);
        var otherNumbers = ExtractNumbers(otherMigrationsDir);

        var collisions = ownNumbers.Keys
            .Where(otherNumbers.ContainsKey)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        if (collisions.Length == 0)
        {
            return null;
        }

        var detail = string.Join("\n", collisions.Select(n =>
            $"  {n}: {ownNumbers[n]} (desktop/ShanesSurvival/migrations) AND {otherNumbers[n]} (web/shanes-life/migrations)"));

        return "Migration number collision across desktop/ShanesSurvival/migrations and " +
            "web/shanes-life/migrations -- the same leading number was used in both directories, " +
            "which makes apply order ambiguous on a fresh database (Git #3118):\n" + detail +
            "\nRename the newer file to the next free number across BOTH directories before proceeding.";
    }

    /// <summary>
    /// web/shanes-life/migrations lives at &lt;repo root&gt;/web/shanes-life/migrations. Repo root
    /// is three levels above desktop/ShanesSurvival/migrations. Returns null if the sibling
    /// directory isn't present in this checkout (e.g. a partial worktree).
    /// </summary>
    private static string? FindSiblingMigrationsDirectory(string ownMigrationsDir)
    {
        var repoRoot = new DirectoryInfo(ownMigrationsDir).Parent?.Parent?.Parent;
        var otherMigrationsDir = repoRoot is null
            ? null
            : Path.Combine(repoRoot.FullName, "web", "shanes-life", "migrations");

        return otherMigrationsDir is not null && Directory.Exists(otherMigrationsDir)
            ? otherMigrationsDir
            : null;
    }

    /// <summary>
    /// Returns a real, actionable error message if schema_migrations holds a row for a filename
    /// that no longer exists in either migrations directory (Git #3140) -- almost always an
    /// already-applied migration that was renamed. Without this, the renamed file would silently
    /// re-execute under its new name, safe only if the migration happens to be idempotent. Null
    /// when the ledger and the two directories agree.
    /// </summary>
    private static string? FindOrphanLedgerFilenamesError(
        string ownMigrationsDir, IReadOnlySet<string> ledgerFilenames, IReadOnlyCollection<string> ownFiles)
    {
        var onDisk = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in ownFiles) onDisk.Add(Path.GetFileName(file));

        var siblingDir = FindSiblingMigrationsDirectory(ownMigrationsDir);
        if (siblingDir is not null)
        {
            foreach (var file in Directory.GetFiles(siblingDir, "*.sql")) onDisk.Add(Path.GetFileName(file));
        }

        var orphans = ledgerFilenames.Where(f => !onDisk.Contains(f)).OrderBy(f => f, StringComparer.Ordinal).ToArray();
        if (orphans.Length == 0)
        {
            return null;
        }

        var detail = string.Join("\n", orphans.Select(f => $"  {f}"));
        return $"schema_migrations holds {(orphans.Length == 1 ? "a row" : "rows")} for " +
            $"{(orphans.Length == 1 ? "a file" : "files")} that no longer exist in either migrations " +
            $"directory (Git #3140):\n{detail}\n" +
            "This almost always means an already-applied migration was renamed. Renaming re-runs " +
            "the identical SQL under the new name on every environment that already ran it -- safe " +
            "only if the migration is purely idempotent. Either rename it back, or if the rename is " +
            "intentional, fix up the ledger by hand first:\n" +
            "  UPDATE schema_migrations SET filename = '<new filename>' WHERE filename = '<old filename>';";
    }

    private static Dictionary<string, string> ExtractNumbers(string dir)
    {
        var byNumber = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in Directory.GetFiles(dir, "*.sql"))
        {
            var fileName = Path.GetFileName(file);
            var match = NumberPrefix.Match(fileName);
            if (!match.Success)
            {
                continue; // unnumbered file -- not this check's concern
            }
            // Only the first file at a given number is recorded here; duplicates WITHIN this
            // one directory are an accepted existing quirk (see doc comment above), not flagged.
            byNumber.TryAdd(match.Groups[1].Value, fileName);
        }
        return byNumber;
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
