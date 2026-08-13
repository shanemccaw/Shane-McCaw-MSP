using System;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Shane: "the browser extension SQL runner worked... and so does the
    /// console floaty." Real execution — POST /api/simulator/sql/execute,
    /// the exact same endpoint the browser extension's floaty SQL Runner
    /// already uses (its own doc comment: "no restrictions, by his own
    /// explicit choice after being walked through the risk. Development
    /// server, not production."). CLAUDE.md's "no direct database access"
    /// rule is about Claude Code sessions specifically — this app is
    /// Shane's own, talking to the same already-approved real dev DB path.
    /// </summary>
    public partial class SqlRunnerView : UserControl
    {
        private BuildTrackerApiClient? _api;

        /// <summary>Git #940 — the last successfully-rendered result set + the query that produced it, so "Send to Chat" can format exactly what's on screen.</summary>
        private DataTable? _lastResultTable;
        private string _lastResultQuery = "";

        /// <summary>Git #940 — cap the markdown table so a huge result set never dumps an unbounded block into a chat composer.</summary>
        private const int MaxSendRows = 200;

        /// <summary>
        /// Git #940 — raised when "Send to Chat" is clicked with a formatted,
        /// ready-to-inject markdown block. MainWindow owns the WebView2 panes, so
        /// it handles the actual active-chat detection + composer injection (the
        /// shared #937 path) and reports back via <see cref="ShowSendStatus"/>.
        /// </summary>
        public event EventHandler<string>? SendToChatRequested;

        public SqlRunnerView() => InitializeComponent();

        public void Initialize(BuildTrackerApiClient api)
        {
            _api = api;
            if (api.IsConfigured)
            {
                ConnDot.Fill    = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1));
                ConnStatus.Text = "Ready";
            }
        }

        public void SetSqlQuery(string sql)
        {
            QueryEditor.Text = sql;
        }

        public async void LoadFromGitHub(string path)
        {
            if (_api == null || !_api.IsConfigured)
            {
                ExecStatus.Text = "Not connected — see Settings.";
                return;
            }
            ExecStatus.Text = $"Loading {path}…";
            try
            {
                var content = await _api.GetFileContentAsync(path);
                QueryEditor.Text = content;
                ExecStatus.Text = $"Loaded {path} — review it, then Execute (F5) to run it for real.";
            }
            catch (Exception ex)
            {
                ExecStatus.Text = $"Couldn't load {path}: {ex.Message}";
            }
        }

        private void Connect_Click(object sender, RoutedEventArgs e)
        {
            if (_api == null || !_api.IsConfigured)
            {
                ConnDot.Fill    = new SolidColorBrush(Color.FromRgb(0xE5, 0xA3, 0xA3));
                ConnStatus.Text = "Not connected — see Settings";
                return;
            }
            // There's no separate "connect" step — every Execute call is its
            // own real round trip to the dev api-server's pooled connection
            // (same as the browser extension). This just confirms config is present.
            ConnDot.Fill    = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1));
            ConnStatus.Text = "Ready";
            ExecStatus.Text = $"Connected to {_api.ConfiguredApiBaseUrl}";
        }

        private async void Execute_Click(object sender, RoutedEventArgs e)
        {
            if (_api == null || !_api.IsConfigured)
            {
                ExecStatus.Text = "Not connected — see Settings.";
                return;
            }
            var query = QueryEditor.Text.Trim();
            if (string.IsNullOrEmpty(query))
            {
                ExecStatus.Text = "Nothing to execute.";
                return;
            }

            ExecStatus.Text = "Executing…";
            try
            {
                var statements = await _api.ExecuteSqlAsync(query);
                RenderResults(statements);
            }
            catch (Exception ex)
            {
                ExecStatus.Text = $"Execute failed: {ex.Message}";
                ResultsGrid.ItemsSource = null;
                RowCountLabel.Text = "Error";
                _lastResultTable = null;
                SendToChatButton.IsEnabled = false;
            }
        }

        /// <summary>
        /// SSMS-style: one entry per statement in the script. Shows the LAST
        /// statement that actually returned rows (the common case — a script
        /// ending in a SELECT to eyeball the result), with a summary line
        /// covering every statement's own success/failure so a mid-script
        /// failure isn't silently hidden by a later one succeeding.
        /// </summary>
        private void RenderResults(System.Collections.Generic.List<SqlStatementResult> statements)
        {
            var failed = statements.Count(s => !s.Success);
            var succeeded = statements.Count - failed;
            var totalMs = statements.Sum(s => s.ExecutionMs);

            if (statements.Count == 0)
            {
                ExecStatus.Text = "No statements found.";
                ResultsGrid.ItemsSource = null;
                RowCountLabel.Text = "0 rows";
                _lastResultTable = null;
                SendToChatButton.IsEnabled = false;
                return;
            }

            if (failed > 0)
            {
                var firstError = statements.First(s => !s.Success);
                ExecStatus.Text = $"{succeeded}/{statements.Count} statement(s) succeeded, {failed} failed ({totalMs}ms). First error (statement {firstError.StatementIndex + 1}): {firstError.Error}";
            }
            else
            {
                ExecStatus.Text = $"{succeeded} statement(s) succeeded ({totalMs}ms).";
            }

            var withRows = statements.LastOrDefault(s => s.Success && s.Fields.Count > 0);
            if (withRows == null)
            {
                ResultsGrid.ItemsSource = null;
                RowCountLabel.Text = failed > 0 ? "See status above" : "No rows returned";
                _lastResultTable = null;
                SendToChatButton.IsEnabled = false;
                return;
            }

            var table = new DataTable();
            foreach (var field in withRows.Fields) table.Columns.Add(field, typeof(string));
            foreach (var row in withRows.Rows)
            {
                var dr = table.NewRow();
                foreach (var field in withRows.Fields)
                {
                    dr[field] = row.TryGetValue(field, out var value) ? JsonElementToDisplayString(value) : "";
                }
                table.Rows.Add(dr);
            }

            ResultsGrid.Columns.Clear();
            ResultsGrid.AutoGenerateColumns = true;
            ResultsGrid.ItemsSource = table.DefaultView;
            RowCountLabel.Text = $"{withRows.RowCount} row{(withRows.RowCount == 1 ? "" : "s")}";

            // Git #940 — cache exactly what's on screen and light up "Send to Chat"
            // only when there are real rows to send.
            _lastResultTable = table;
            _lastResultQuery = QueryEditor.Text.Trim();
            SendToChatButton.IsEnabled = table.Rows.Count > 0;
        }

        /// <summary>Git #940 — MainWindow calls this back after a send attempt to report the outcome inline (reuses the ExecStatus strip).</summary>
        public void ShowSendStatus(string message) => ExecStatus.Text = message;

        /// <summary>
        /// Git #940 — "Send to Chat": format the current result set as a readable
        /// markdown table (with row count + originating query for context, capped
        /// at the first <see cref="MaxSendRows"/> rows with a truncation note) and
        /// hand it to MainWindow to inject into the active Claude.ai chat tab via
        /// #937's shared path. Never presses Enter — Shane reviews and sends.
        /// </summary>
        private void SendToChat_Click(object sender, RoutedEventArgs e)
        {
            var table = _lastResultTable;
            if (table == null || table.Rows.Count == 0)
            {
                ExecStatus.Text = "Nothing to send — run a query that returns rows first.";
                return;
            }

            var text = BuildMarkdownForChat(table, _lastResultQuery);
            ActivityLog.Log("sql-runner.send-to-chat", $"send-clicked: {table.Rows.Count} row(s), {table.Columns.Count} col(s)");
            SendToChatRequested?.Invoke(this, text);
        }

        /// <summary>
        /// Git #940 — renders a DataTable as a GitHub-flavored markdown table:
        /// a context header (row count + the originating query in a fenced sql
        /// block), then a header row, a separator row, and up to
        /// <see cref="MaxSendRows"/> data rows with a truncation note if capped.
        /// Pipe/newline characters inside cells are escaped so they don't break
        /// the table layout in the chat.
        /// </summary>
        private static string BuildMarkdownForChat(DataTable table, string query)
        {
            var cols = table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList();
            int total = table.Rows.Count;
            int shown = Math.Min(total, MaxSendRows);

            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"SQL Runner result — {total} row{(total == 1 ? "" : "s")}"
                          + (total > shown ? $" (showing first {shown})" : "") + ":");
            sb.AppendLine();
            if (!string.IsNullOrWhiteSpace(query))
            {
                sb.AppendLine("```sql");
                sb.AppendLine(query);
                sb.AppendLine("```");
                sb.AppendLine();
            }

            sb.AppendLine("| " + string.Join(" | ", cols.Select(EscapeCell)) + " |");
            sb.AppendLine("| " + string.Join(" | ", cols.Select(_ => "---")) + " |");
            for (int i = 0; i < shown; i++)
            {
                var row = table.Rows[i];
                sb.AppendLine("| " + string.Join(" | ", cols.Select(c => EscapeCell(row[c]?.ToString() ?? ""))) + " |");
            }

            if (total > shown)
            {
                sb.AppendLine();
                sb.AppendLine($"_…truncated — {total - shown} more row{(total - shown == 1 ? "" : "s")} not shown (capped at {MaxSendRows})._");
            }

            return sb.ToString().TrimEnd();
        }

        /// <summary>Escapes markdown-table-breaking characters in a cell value.</summary>
        private static string EscapeCell(string value) =>
            value.Replace("\\", "\\\\")
                 .Replace("|", "\\|")
                 .Replace("\r\n", " ")
                 .Replace("\n", " ")
                 .Replace("\r", " ");

        private static string JsonElementToDisplayString(JsonElement el) => el.ValueKind switch
        {
            JsonValueKind.Null => "NULL",
            JsonValueKind.String => el.GetString() ?? "",
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => el.GetRawText(),
        };
    }
}
