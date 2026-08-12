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
        }

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
