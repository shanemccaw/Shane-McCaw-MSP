using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ShaneBuilder.Services;

/// <summary>Git #2203 — one real <c>.sql</c> file on disk, for the Command Center's SQL
/// category's "repo files" list.</summary>
public sealed class RepoSqlFile
{
    public string Group { get; init; } = "";
    public string Name { get; init; } = "";
    public string FullPath { get; init; } = "";
}

/// <summary>Git #2203 — real, on-disk enumeration of this repo's own <c>.sql</c> files (never a
/// fixture list). "Migrations" is the real, well-known <c>lib/db/migrations/manual/</c>
/// directory CLAUDE.md's own manual-migration convention writes to; "Queries / Reports" is
/// whatever one-off <c>.sql</c> files genuinely exist under <c>scripts/</c> and <c>docs/</c> —
/// this repo has no dedicated queries/reports folder, so those two real locations are grouped
/// together rather than inventing a directory structure that doesn't exist.</summary>
public static class RepoSqlFileScanner
{
    public static List<RepoSqlFile> Scan(string repoRoot)
    {
        var result = new List<RepoSqlFile>();
        if (string.IsNullOrWhiteSpace(repoRoot) || !Directory.Exists(repoRoot)) return result;

        AddGroup(result, repoRoot, "Migrations", Path.Combine(repoRoot, "lib", "db", "migrations", "manual"));
        AddGroup(result, repoRoot, "Queries / Reports", Path.Combine(repoRoot, "scripts"), recursive: false);
        AddGroup(result, repoRoot, "Queries / Reports", Path.Combine(repoRoot, "docs"), recursive: false);

        return result.OrderBy(f => f.Group).ThenByDescending(f => f.Name).ToList();
    }

    private static void AddGroup(List<RepoSqlFile> result, string repoRoot, string group, string dir, bool recursive = true)
    {
        if (!Directory.Exists(dir)) return;
        try
        {
            var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            foreach (var file in Directory.EnumerateFiles(dir, "*.sql", opt))
            {
                result.Add(new RepoSqlFile
                {
                    Group = group,
                    Name = Path.GetRelativePath(repoRoot, file).Replace('\\', '/'),
                    FullPath = file
                });
            }
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[sql-files] couldn't scan {dir}: {ex.Message}");
        }
    }
}
