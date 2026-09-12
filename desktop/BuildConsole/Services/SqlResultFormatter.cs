using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3828 — real CSV/JSON rendering of a <see cref="LocalSqlExecutor"/> result set,
    /// shared between the Command Center palette's SQL results panel and (via the
    /// delegated escaping below) the existing SQL Runner floaty
    /// (<see cref="BuildConsole.Controls.SqlDocumentView"/>). Operates directly on
    /// <see cref="SqlStatementResult"/> — no DataTable dependency — since the palette has
    /// no DataGrid to feed.
    /// </summary>
    public static class SqlResultFormatter
    {
        /// <summary>Same shape as the SQL Runner's own JSON view (<c>JsonView.Text</c>) — the raw statement list, indented.</summary>
        public static string ToJson(List<SqlStatementResult> statements)
            => JsonSerializer.Serialize(statements, new JsonSerializerOptions { WriteIndented = true });

        /// <summary>
        /// CSV for every statement that returned rows, in order — multiple result sets get a
        /// <c>-- Statement N</c> header between them, same convention as the SQL Runner's own
        /// "Copy Table" button (<c>SqlDocumentView.CopyTableBtn_Click</c>).
        /// </summary>
        public static string ToCsv(List<SqlStatementResult> statements)
        {
            var withRows = statements.Where(s => s.Success && s.Fields.Count > 0).ToList();
            if (withRows.Count == 0) return "";

            var sb = new StringBuilder();
            for (int i = 0; i < withRows.Count; i++)
            {
                if (withRows.Count > 1)
                {
                    int stmtNum = withRows[i].StatementIndex >= 0 ? withRows[i].StatementIndex + 1 : i + 1;
                    sb.AppendLine($"-- Statement {stmtNum}");
                }
                sb.AppendLine(BuildCsvForStatement(withRows[i]));
                if (i < withRows.Count - 1) sb.AppendLine();
            }
            return sb.ToString().TrimEnd();
        }

        /// <summary>True if any statement in the set actually returned rows (i.e. there's real CSV/table content to show, not just an OK/error summary).</summary>
        public static bool HasRows(List<SqlStatementResult> statements)
            => statements.Any(s => s.Success && s.Fields.Count > 0);

        private static string BuildCsvForStatement(SqlStatementResult stmt)
        {
            var sb = new StringBuilder();
            sb.AppendLine(string.Join(",", stmt.Fields.Select(EscapeCsvCell)));
            foreach (var row in stmt.Rows)
            {
                sb.AppendLine(string.Join(",", stmt.Fields.Select(f =>
                    EscapeCsvCell(row.TryGetValue(f, out var v) ? JsonElementToDisplayString(v) : ""))));
            }
            return sb.ToString().TrimEnd();
        }

        /// <summary>RFC 4180 field quoting — same rule as <c>SqlDocumentView.EscapeCsvCell</c>, kept in exact sync since both render the same real query results.</summary>
        public static string EscapeCsvCell(string value) =>
            value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0
                ? "\"" + value.Replace("\"", "\"\"") + "\""
                : value;

        public static string JsonElementToDisplayString(JsonElement el) => el.ValueKind switch
        {
            JsonValueKind.Null => "NULL",
            JsonValueKind.String => el.GetString() ?? "",
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => el.GetRawText(),
        };

        /// <summary>
        /// Human summary line for statements that didn't return rows (OK / affected-row-count / error),
        /// same wording style as the SQL Runner's own status strip.
        /// </summary>
        public static string SummaryLine(List<SqlStatementResult> statements)
        {
            int failed = statements.Count(s => !s.Success);
            int succeeded = statements.Count - failed;
            int totalMs = statements.Sum(s => s.ExecutionMs);
            if (statements.Count == 0) return "No statements found.";
            if (failed > 0)
            {
                var firstError = statements.First(s => !s.Success);
                return $"{succeeded}/{statements.Count} statement(s) succeeded, {failed} failed ({totalMs}ms). First error: {firstError.Error}";
            }
            int totalRows = statements.Sum(s => s.RowCount);
            return $"{succeeded} statement{(succeeded == 1 ? "" : "s")} succeeded — {totalRows} row{(totalRows == 1 ? "" : "s")} ({totalMs}ms).";
        }
    }
}
