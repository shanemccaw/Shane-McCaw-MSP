using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Xml;
using BuildConsole.Services;
using ICSharpCode.AvalonEdit.Highlighting;
using ICSharpCode.AvalonEdit.Highlighting.Xshd;

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
    public partial class SqlDocumentView : UserControl
    {
        private BuildTrackerApiClient? _api;

        /// <summary>Git #940 — the last full statement list for Send to Chat and JSON view.</summary>
        private System.Collections.Generic.List<SqlStatementResult>? _lastStatements;
        private System.Collections.Generic.List<DataTable> _lastResultTables = new();
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

        /// <summary>Raised when the user clicks the inline close button.</summary>
        public event EventHandler? CloseRequested;

        /// <summary>Shows or hides the inline Close button.</summary>
        public bool IsInline
        {
            get => CloseInlineBtn.Visibility == Visibility.Visible;
            set => CloseInlineBtn.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        }

        private void CloseInline_Click(object sender, RoutedEventArgs e)
        {
            CloseRequested?.Invoke(this, EventArgs.Empty);
        }

        public SqlDocumentView()
        {
            InitializeComponent();
            LoadSqlHighlighting();
            // Placeholder starter text preserved from the old EditorTextBox (Git #939).
            QueryEditor.Text = "-- Write your SQL query here\nSELECT *\nFROM public.users\nLIMIT 100;";
        }

        /// <summary>
        /// Git #939 — applies the embedded SQL highlighting definition (SqlSyntax.xshd,
        /// dark-theme colors matching DarkTheme.xaml) to the AvalonEdit editor. Loading
        /// is best-effort: highlighting is purely cosmetic, so a missing/bad definition
        /// leaves the editor plain rather than crashing the SQL Runner.
        /// </summary>
        private void LoadSqlHighlighting()
        {
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using var stream = asm.GetManifestResourceStream("BuildConsole.Controls.SqlSyntax.xshd");
                if (stream == null) return;
                using var reader = new XmlTextReader(stream);
                QueryEditor.SyntaxHighlighting = HighlightingLoader.Load(reader, HighlightingManager.Instance);
            }
            catch
            {
                // Cosmetic only — never let a highlighting problem break the editor.
            }
        }

        public void Initialize(BuildTrackerApiClient? api)
        {
            _api = api;
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
                // Git #939 — rewrite bare INSERT/UPDATE/DELETE statements to RETURNING *
                // so the affected rows come back as a real result set (below).
                var toRun = AddReturningToWrites(query);
                var statements = await LocalSqlExecutor.ExecuteAsync(_api, toRun);
                RenderResults(statements);
            }
            catch (Exception ex)
            {
                ExecStatus.Text = $"Execute failed: {ex.Message}";
                ResultsStack.Children.Clear();
                RowCountLabel.Text = "Error";
                _lastResultTables.Clear();
                _lastStatements = null;
                CopyTableBtn.IsEnabled = false;
                CopyJsonBtn.IsEnabled = false;
                SendToChatButton.IsEnabled = false;
            }
        }

        /// <summary>
        /// Shows every statement that returned rows as its own labeled DataGrid,
        /// plus a summary covering all statement outcomes. Also populates the JSON
        /// view and enables the copy buttons.
        /// </summary>
        private void RenderResults(System.Collections.Generic.List<SqlStatementResult> statements)
        {
            _lastStatements = statements;
            _lastResultTables.Clear();
            ResultsStack.Children.Clear();
            JsonView.Text = "";

            var failed = statements.Count(s => !s.Success);
            var succeeded = statements.Count - failed;
            var totalMs = statements.Sum(s => s.ExecutionMs);

            if (statements.Count == 0)
            {
                ExecStatus.Text = "No statements found.";
                RowCountLabel.Text = "0 rows";
                CopyTableBtn.IsEnabled = false;
                CopyJsonBtn.IsEnabled = false;
                SendToChatButton.IsEnabled = false;
                return;
            }

            if (failed > 0)
            {
                var firstError = statements.First(s => !s.Success);
                ExecStatus.Text = $"{succeeded}/{statements.Count} statement(s) succeeded, {failed} failed ({totalMs}ms). First error: {firstError.Error}";
            }
            else
            {
                ExecStatus.Text = $"{succeeded} statement{(succeeded == 1 ? "" : "s")} succeeded ({totalMs}ms).";
            }

            // Build pretty JSON for the JSON view (all statements)
            var jsonOpts = new JsonSerializerOptions { WriteIndented = true };
            JsonView.Text = JsonSerializer.Serialize(statements, jsonOpts);

            int totalRows = 0;

            for (int i = 0; i < statements.Count; i++)
            {
                var stmt = statements[i];
                int stmtNum = stmt.StatementIndex >= 0 ? stmt.StatementIndex + 1 : i + 1;

                if (stmt.Success && stmt.Fields.Count > 0)
                {
                    // Statement returned rows (SELECT, RETURNING, etc.)
                    var table = new DataTable();
                    foreach (var field in stmt.Fields) table.Columns.Add(field, typeof(string));
                    foreach (var row in stmt.Rows)
                    {
                        var dr = table.NewRow();
                        foreach (var field in stmt.Fields)
                            dr[field] = row.TryGetValue(field, out var value) ? JsonElementToDisplayString(value) : "";
                        table.Rows.Add(dr);
                    }
                    _lastResultTables.Add(table);
                    totalRows += table.Rows.Count;

                    var label = new TextBlock
                    {
                        Text = $"Statement {stmtNum}  —  {table.Rows.Count} row{(table.Rows.Count == 1 ? "" : "s")}  ({stmt.ExecutionMs}ms)",
                        FontSize = 11,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("Subtext1Brush"),
                        Margin = new Thickness(6, i == 0 ? 6 : 14, 6, 4),
                    };
                    ResultsStack.Children.Add(label);

                    var grid = new DataGrid
                    {
                        IsReadOnly = true,
                        AutoGenerateColumns = true,
                        BorderThickness = new Thickness(0),
                        Margin = new Thickness(0, 0, 0, 0),
                        MaxHeight = statements.Count > 1 ? 320 : double.PositiveInfinity,
                        ItemsSource = table.DefaultView,
                    };
                    // Right-click context menu
                    var ctxMenu = new ContextMenu();
                    var copyCell = new MenuItem { Header = "Copy Cell" };
                    copyCell.Click += (s, e) =>
                    {
                        if (grid.CurrentCell.Item is DataRowView rv && grid.CurrentCell.Column != null)
                        {
                            var field = BoundFieldName(grid.CurrentCell.Column);
                            if (field != null) Clipboard.SetText(rv[field]?.ToString() ?? "");
                        }
                    };
                    var copyRow = new MenuItem { Header = "Copy Row" };
                    copyRow.Click += (s, e) =>
                    {
                        if (grid.SelectedItem is DataRowView rv)
                            Clipboard.SetText(string.Join(",", rv.Row.ItemArray.Select(v => EscapeCsvCell(v?.ToString() ?? ""))));
                    };
                    var copyAll = new MenuItem { Header = "Copy All as CSV" };
                    copyAll.Click += (s, e) => Clipboard.SetText(BuildCsv(table));
                    ctxMenu.Items.Add(copyCell);
                    ctxMenu.Items.Add(copyRow);
                    ctxMenu.Items.Add(new Separator());
                    ctxMenu.Items.Add(copyAll);
                    grid.ContextMenu = ctxMenu;
                    grid.PreviewMouseRightButtonDown += ResultsGrid_PreviewMouseRightButtonDown;
                    ResultsStack.Children.Add(grid);
                }
                else if (stmt.Success)
                {
                    // Non-SELECT statement that succeeded (UPDATE, INSERT, DELETE, CREATE, etc.)
                    var statusBorder = new Border
                    {
                        Background = (Brush)FindResource("MantleBrush"),
                        BorderBrush = (Brush)FindResource("Surface0Brush"),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(6),
                        Padding = new Thickness(12, 8, 12, 8),
                        Margin = new Thickness(6, i == 0 ? 6 : 10, 6, 6)
                    };
                    var sp = new StackPanel();
                    var row1 = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
                    row1.Children.Add(new TextBlock { Text = "✅ ", FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
                    row1.Children.Add(new TextBlock
                    {
                        Text = $"Statement {stmtNum}: OK",
                        FontWeight = FontWeights.Bold,
                        FontSize = 12,
                        Foreground = (Brush)FindResource("GreenBrush"),
                        VerticalAlignment = VerticalAlignment.Center
                    });

                    string details = stmt.RowCount > 0
                        ? $" — {stmt.RowCount} row{(stmt.RowCount == 1 ? "" : "s")} affected ({stmt.ExecutionMs}ms)"
                        : $" — ({stmt.ExecutionMs}ms)";

                    row1.Children.Add(new TextBlock
                    {
                        Text = details,
                        FontSize = 12,
                        Foreground = (Brush)FindResource("Subtext0Brush"),
                        VerticalAlignment = VerticalAlignment.Center
                    });
                    sp.Children.Add(row1);

                    if (!string.IsNullOrWhiteSpace(stmt.StatementText))
                    {
                        sp.Children.Add(new TextBlock
                        {
                            Text = stmt.StatementText.Trim(),
                            FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                            FontSize = 11,
                            Foreground = (Brush)FindResource("Subtext1Brush"),
                            TextWrapping = TextWrapping.Wrap
                        });
                    }

                    statusBorder.Child = sp;
                    ResultsStack.Children.Add(statusBorder);
                }
                else
                {
                    // Statement failed
                    var errorBorder = new Border
                    {
                        Background = (Brush)FindResource("MantleBrush"),
                        BorderBrush = (Brush)FindResource("RedBrush"),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(6),
                        Padding = new Thickness(12, 8, 12, 8),
                        Margin = new Thickness(6, i == 0 ? 6 : 10, 6, 6)
                    };
                    var sp = new StackPanel();
                    var row1 = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
                    row1.Children.Add(new TextBlock { Text = "❌ ", FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
                    row1.Children.Add(new TextBlock
                    {
                        Text = $"Statement {stmtNum}: Failed ({stmt.ExecutionMs}ms)",
                        FontWeight = FontWeights.Bold,
                        FontSize = 12,
                        Foreground = (Brush)FindResource("RedBrush"),
                        VerticalAlignment = VerticalAlignment.Center
                    });
                    sp.Children.Add(row1);

                    sp.Children.Add(new TextBlock
                    {
                        Text = stmt.Error ?? "Execution error",
                        FontSize = 11.5,
                        Foreground = (Brush)FindResource("RedBrush"),
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 0, 0, 4)
                    });

                    if (!string.IsNullOrWhiteSpace(stmt.StatementText))
                    {
                        sp.Children.Add(new TextBlock
                        {
                            Text = stmt.StatementText.Trim(),
                            FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                            FontSize = 11,
                            Foreground = (Brush)FindResource("Subtext1Brush"),
                            TextWrapping = TextWrapping.Wrap
                        });
                    }

                    errorBorder.Child = sp;
                    ResultsStack.Children.Add(errorBorder);
                }
            }

            if (totalRows > 0)
            {
                RowCountLabel.Text = _lastResultTables.Count > 1
                    ? $"{totalRows} rows ({_lastResultTables.Count} result sets)"
                    : $"{totalRows} row{(totalRows == 1 ? "" : "s")}";
            }
            else if (failed > 0)
            {
                RowCountLabel.Text = $"{failed} error{(failed == 1 ? "" : "s")}";
            }
            else
            {
                RowCountLabel.Text = $"{statements.Count} OK";
            }

            bool hasData = _lastResultTables.Any(t => t.Rows.Count > 0);
            CopyTableBtn.IsEnabled = hasData;
            CopyJsonBtn.IsEnabled = statements.Count > 0;
            SendToChatButton.IsEnabled = statements.Any(s => s.Success);

            // Cache for Send-to-Chat
            _lastResultQuery = QueryEditor.Text.Trim();
        }

        // ── View toggle handlers ────────────────────────────────────────────────
        private void ViewTableBtn_Click(object sender, RoutedEventArgs e)
        {
            ViewTableBtn.IsChecked = true;
            ViewJsonBtn.IsChecked = false;
            TableScrollView.Visibility = Visibility.Visible;
            JsonView.Visibility = Visibility.Collapsed;
        }

        private void ViewJsonBtn_Click(object sender, RoutedEventArgs e)
        {
            ViewJsonBtn.IsChecked = true;
            ViewTableBtn.IsChecked = false;
            JsonView.Visibility = Visibility.Visible;
            TableScrollView.Visibility = Visibility.Collapsed;
        }

        // ── Copy button handlers ────────────────────────────────────────────────
        private void CopyTableBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_lastResultTables.Count == 0) return;
            if (_lastResultTables.Count == 1)
            {
                Clipboard.SetText(BuildCsv(_lastResultTables[0]));
            }
            else
            {
                var sb = new StringBuilder();
                for (int i = 0; i < _lastResultTables.Count; i++)
                {
                    sb.AppendLine($"-- Statement {i + 1}");
                    sb.AppendLine(BuildCsv(_lastResultTables[i]));
                    sb.AppendLine();
                }
                Clipboard.SetText(sb.ToString().TrimEnd());
            }
            ExecStatus.Text = "Copied CSV to clipboard.";
        }

        private void CopyJsonBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_lastStatements == null || _lastStatements.Count == 0) return;
            Clipboard.SetText(JsonView.Text);
            ExecStatus.Text = "Copied JSON to clipboard.";
        }

        /// <summary>
        /// Git #940 — "Send to Chat": format the current result set as a readable
        /// markdown table (with row count + originating query for context, capped
        /// at the first <see cref="MaxSendRows"/> rows with a truncation note) and
        /// hand it to MainWindow to inject into the active Claude.ai chat tab via
        /// #937's shared path. Never presses Enter — Shane reviews and sends.
        /// </summary>
        /// <summary>Git #940 — MainWindow calls this back after a send attempt to report the outcome inline (reuses the ExecStatus strip).</summary>
        public void ShowSendStatus(string message) => ExecStatus.Text = message;

        private void SendToChat_Click(object sender, RoutedEventArgs e)
        {
            var table = _lastResultTables.FirstOrDefault(t => t.Rows.Count > 0);
            if (table != null)
            {
                var text = BuildMarkdownForChat(table, _lastResultQuery);
                ActivityLog.Log("sql-runner.send-to-chat", $"send-clicked: {table.Rows.Count} row(s), {table.Columns.Count} col(s)");
                SendToChatRequested?.Invoke(this, text);
            }
            else if (_lastStatements != null && _lastStatements.Count > 0)
            {
                var text = BuildNonSelectMarkdownForChat(_lastStatements, _lastResultQuery);
                ActivityLog.Log("sql-runner.send-to-chat", $"send-clicked: {_lastStatements.Count} statement(s)");
                SendToChatRequested?.Invoke(this, text);
            }
            else
            {
                ExecStatus.Text = "Nothing to send — run a query first.";
            }
        }

        private static string BuildNonSelectMarkdownForChat(List<SqlStatementResult> statements, string query)
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"SQL Runner execution result — {statements.Count} statement{(statements.Count == 1 ? "" : "s")}:");
            sb.AppendLine();

            foreach (var s in statements)
            {
                int idx = s.StatementIndex >= 0 ? s.StatementIndex + 1 : 1;
                if (s.Success)
                {
                    string info = s.RowCount > 0 ? $"{s.RowCount} row(s) affected" : "OK";
                    sb.AppendLine($"- ✅ **Statement {idx}**: {info} ({s.ExecutionMs}ms)");
                }
                else
                {
                    sb.AppendLine($"- ❌ **Statement {idx}**: Failed — {s.Error} ({s.ExecutionMs}ms)");
                }
            }

            return sb.ToString().TrimEnd();
        }

        /// <summary>
        /// Git #940 — renders a DataTable as a GitHub-flavored markdown table:
        /// a context header (row count), then a header row, a separator row, and up to
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

        // ── Git #945 — ResultsGrid right-click menu (Copy Cell, Copy Row, Copy All as CSV) ──
        // WPF's DataGrid doesn't move CurrentCell/SelectedItem on a right-click by
        // itself (only left-click does), so a right-click on a cell that wasn't
        // already the active selection would otherwise let "Copy Cell"/"Copy Row"
        // silently act on stale selection. Moving selection to the clicked cell
        // here, before the context menu opens, makes both act on what Shane
        // actually right-clicked.
        private void ResultsGrid_PreviewMouseRightButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (sender is not DataGrid targetGrid) return;
            var source = e.OriginalSource as DependencyObject;
            while (source != null && source is not DataGridCell) source = VisualTreeHelper.GetParent(source);
            if (source is not DataGridCell cell) return;

            var row = FindVisualParent<DataGridRow>(cell);
            if (row == null) return;

            cell.Focus();
            targetGrid.SelectedItem = row.Item;
            targetGrid.CurrentCell = new DataGridCellInfo(row.Item, cell.Column);
        }

        private static T? FindVisualParent<T>(DependencyObject child) where T : DependencyObject
        {
            var parent = VisualTreeHelper.GetParent(child);
            while (parent != null && parent is not T) parent = VisualTreeHelper.GetParent(parent);
            return parent as T;
        }

        /// <summary>Resolves the DataTable field name an auto-generated DataGrid column is bound to, so a cell/row value can be read straight from the backing DataRowView.</summary>
        private static string? BoundFieldName(DataGridColumn column) =>
            (column as DataGridBoundColumn)?.Binding is Binding binding ? binding.Path.Path : null;

        // CopyCell_Click / CopyRow_Click are now wired inline per-DataGrid in RenderResults.

        private void CopyAllCsv_Click(object sender, RoutedEventArgs e)
        {
            if (_lastResultTables.Count == 0) return;
            Clipboard.SetText(BuildCsv(_lastResultTables[0]));
        }

        private static string BuildCsv(DataTable table)
        {
            var cols = table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList();
            var sb = new StringBuilder();
            sb.AppendLine(string.Join(",", cols.Select(EscapeCsvCell)));
            foreach (DataRow row in table.Rows)
                sb.AppendLine(string.Join(",", cols.Select(c => EscapeCsvCell(row[c]?.ToString() ?? ""))));
            return sb.ToString().TrimEnd();
        }

        /// <summary>RFC 4180 field quoting — quotes (doubling embedded quotes) any field containing a comma, quote, or newline.</summary>
        private static string EscapeCsvCell(string value) =>
            value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0
                ? "\"" + value.Replace("\"", "\"\"") + "\""
                : value;

        // ── Auto-RETURNING * (Git #939) ────────────────────────────────────────
        // A plain INSERT/UPDATE/DELETE with no RETURNING clause returns zero fields
        // from the driver, so RenderResults' "Fields.Count > 0" path never fires and
        // Shane only ever saw the summary line ("N statement(s) succeeded"), never the
        // rows he actually changed. Appending " RETURNING *" makes Postgres hand the
        // affected rows back as a real result set, which then renders through the exact
        // same ResultsGrid already used for SELECT.
        //
        // This is done per-statement, client-side, before the script is sent — so the
        // script is first split the same way the server splits it (a faithful C# port
        // of api-server/src/lib/sql-statement-splitter.ts) to avoid shredding string
        // literals, dollar-quoted bodies, or comments. Only the qualifying statements
        // are rewritten; SELECT/DDL/etc. and any statement that already carries its own
        // RETURNING clause are left byte-for-byte alone. The rejoined script re-splits
        // identically on the server.

        private static readonly Regex LeadingDmlRegex =
            new(@"^(insert|update|delete)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex ReturningRegex =
            new(@"\breturning\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex LeadingCommentOrSpaceRegex =
            new(@"\A(\s+|--[^\n]*|/\*.*?\*/)", RegexOptions.Singleline | RegexOptions.Compiled);

        /// <summary>
        /// For each INSERT/UPDATE/DELETE statement in <paramref name="script"/> that
        /// doesn't already have a RETURNING clause, appends " RETURNING *". Every other
        /// statement is returned unchanged.
        /// </summary>
        private static string AddReturningToWrites(string script)
        {
            var statements = SplitSqlStatements(script);
            if (statements.Count == 0) return script;
            for (var i = 0; i < statements.Count; i++)
                statements[i] = MaybeAppendReturning(statements[i]);
            return string.Join("\n", statements);
        }

        private static string MaybeAppendReturning(string statement)
        {
            // Skip leading whitespace / -- and /* */ comments to reach the first keyword.
            var body = statement;
            while (true)
            {
                var m = LeadingCommentOrSpaceRegex.Match(body);
                if (!m.Success || m.Length == 0) break;
                body = body.Substring(m.Length);
            }

            if (!LeadingDmlRegex.IsMatch(body)) return statement;    // not INSERT/UPDATE/DELETE
            if (ReturningRegex.IsMatch(statement)) return statement; // already has RETURNING

            var trimmed = statement.TrimEnd();
            if (trimmed.EndsWith(";"))
            {
                var withoutSemi = trimmed.Substring(0, trimmed.Length - 1).TrimEnd();
                return withoutSemi + " RETURNING *;";
            }
            return trimmed + " RETURNING *";
        }

        // ── SQL statement splitter (C# port of sql-statement-splitter.ts) ──────────
        // Splits a multi-statement script on top-level semicolons only, skipping any
        // that live inside single-quoted strings, double-quoted identifiers, dollar-
        // quoted blocks, -- line comments or /* */ (nestable) block comments. Comment-
        // /whitespace-only segments are dropped; a trailing statement with no final
        // semicolon is still returned; each returned statement is trimmed and keeps its
        // own terminating ';' when it had one. Kept behavior-identical to the server.

        private static string? MatchDollarTag(string sql, int start)
        {
            // sql[start] is known to be '$'. Empty tag ($$) is valid.
            var i = start + 1;
            if (i < sql.Length && sql[i] == '$') return "$$";
            if (i >= sql.Length || !(char.IsLetter(sql[i]) || sql[i] == '_')) return null;
            i++;
            while (i < sql.Length && (char.IsLetterOrDigit(sql[i]) || sql[i] == '_')) i++;
            if (i >= sql.Length || sql[i] != '$') return null;
            return sql.Substring(start, i - start + 1);
        }

        private static List<string> SplitSqlStatements(string input)
        {
            var statements = new List<string>();
            var current = new StringBuilder();
            var hasContent = false;
            var n = input.Length;
            var i = 0;

            void Flush()
            {
                var trimmed = current.ToString().Trim();
                if (hasContent && trimmed.Length > 0) statements.Add(trimmed);
                current.Clear();
                hasContent = false;
            }

            while (i < n)
            {
                var ch = input[i];
                var next = i + 1 < n ? input[i + 1] : '\0';

                // -- line comment
                if (ch == '-' && next == '-')
                {
                    var j = i;
                    while (j < n && input[j] != '\n') j++;
                    current.Append(input, i, j - i);
                    i = j;
                    continue;
                }

                // /* block comment */ (nestable)
                if (ch == '/' && next == '*')
                {
                    var depth = 1;
                    current.Append("/*");
                    var j = i + 2;
                    while (j < n && depth > 0)
                    {
                        if (j + 1 < n && input[j] == '/' && input[j + 1] == '*') { depth++; current.Append("/*"); j += 2; }
                        else if (j + 1 < n && input[j] == '*' && input[j + 1] == '/') { depth--; current.Append("*/"); j += 2; }
                        else { current.Append(input[j]); j++; }
                    }
                    i = j;
                    continue;
                }

                // '...' single-quoted string literal ('' escapes a quote)
                if (ch == '\'')
                {
                    current.Append('\'');
                    var j = i + 1;
                    while (j < n)
                    {
                        if (input[j] == '\'' && j + 1 < n && input[j + 1] == '\'') { current.Append("''"); j += 2; }
                        else if (input[j] == '\'') { current.Append('\''); j++; break; }
                        else { current.Append(input[j]); j++; }
                    }
                    hasContent = true;
                    i = j;
                    continue;
                }

                // "..." double-quoted identifier ("" escapes a quote)
                if (ch == '"')
                {
                    current.Append('"');
                    var j = i + 1;
                    while (j < n)
                    {
                        if (input[j] == '"' && j + 1 < n && input[j + 1] == '"') { current.Append("\"\""); j += 2; }
                        else if (input[j] == '"') { current.Append('"'); j++; break; }
                        else { current.Append(input[j]); j++; }
                    }
                    hasContent = true;
                    i = j;
                    continue;
                }

                // $tag$ ... $tag$ dollar-quoted block
                if (ch == '$')
                {
                    var tag = MatchDollarTag(input, i);
                    if (tag != null)
                    {
                        current.Append(tag);
                        var j = i + tag.Length;
                        var close = input.IndexOf(tag, j, StringComparison.Ordinal);
                        if (close == -1)
                        {
                            current.Append(input, j, n - j);
                            j = n;
                        }
                        else
                        {
                            current.Append(input, j, close + tag.Length - j);
                            j = close + tag.Length;
                        }
                        hasContent = true;
                        i = j;
                        continue;
                    }
                }

                // ; top-level statement terminator
                if (ch == ';')
                {
                    current.Append(';');
                    i++;
                    Flush();
                    continue;
                }

                current.Append(ch);
                if (!char.IsWhiteSpace(ch)) hasContent = true;
                i++;
            }

            // Trailing statement with no final semicolon.
            Flush();

            return statements;
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
