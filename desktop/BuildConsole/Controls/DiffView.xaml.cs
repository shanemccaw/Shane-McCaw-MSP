using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Xml;
using ICSharpCode.AvalonEdit.Document;
using ICSharpCode.AvalonEdit.Editing;
using ICSharpCode.AvalonEdit.Highlighting;
using ICSharpCode.AvalonEdit.Highlighting.Xshd;
using ICSharpCode.AvalonEdit.Rendering;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Renders one <see cref="DiffTurn"/> (a code diff detected in the agent's output
    /// stream) as a genuine diff view using AvalonEdit — the same editor already proven
    /// for the SQL Runner (#939). Unlike a stack of grey prose paragraphs, this shows:
    ///   • per-line background coloring — green for added lines, red for removed;
    ///   • a diff-aware line-number gutter carrying the REAL old/new file line numbers
    ///     parsed from the unified-diff hunk header (removed lines show their old-file
    ///     number, added/context lines show their new-file number);
    ///   • real syntax highlighting for the underlying language, inferred from the file
    ///     path in the diff header and reusing AvalonEdit's built-in definitions plus
    ///     this app's own embedded SqlSyntax.xshd / JsonSyntax.xshd (#939).
    ///
    /// The diff prefixes (+ / - / space) are stripped from the editor document so the
    /// language highlighter sees clean code (a leading '+' would otherwise derail every
    /// C#/JS/etc. tokenizer); the add/remove signal is carried entirely by the row
    /// background + the gutter number color, exactly like the reference screenshot.
    ///
    /// Immutable input: the whole block was collected before the DiffTurn was created,
    /// so parsing + wiring happens once on load. Colors are literals mirroring the chat
    /// pane's palette (ChatPaneBrushes.xaml) — kept in code so this control is
    /// self-contained regardless of resource-merge order.
    /// </summary>
    public partial class DiffView : UserControl
    {
        /// <summary>Above this the body scrolls internally instead of making one transcript turn unboundedly tall.</summary>
        private const double MaxBodyHeight = 460;

        private bool _rendered;

        public DiffView()
        {
            InitializeComponent();
        }

        private void OnLoaded(object sender, RoutedEventArgs e) => TryRender();
        private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e) => TryRender();

        private void TryRender()
        {
            if (_rendered) return;
            if (DataContext is not DiffTurn turn) return;
            _rendered = true;
            try { Render(turn.RawDiff); }
            catch { /* rendering is best-effort — a malformed diff must never crash the watch window */ }
        }

        private void Render(string rawDiff)
        {
            var parsed = DiffParser.Parse(rawDiff);

            FileNameText.Text = string.IsNullOrEmpty(parsed.FilePath) ? "Code change" : parsed.FilePath;
            AddStatText.Text = $"+{parsed.Adds}";
            RemoveStatText.Text = $"−{parsed.Removes}"; // U+2212 minus, matching the header glyph

            // Clean code text (prefixes already stripped by the parser) for the highlighter.
            Editor.Document = new TextDocument(string.Join("\n", parsed.Rows.Select(r => r.Text)));
            Editor.Document.UndoStack.ClearAll();
            Editor.IsReadOnly = true;
            Editor.SyntaxHighlighting = ResolveHighlighting(parsed.FilePath);

            var textView = Editor.TextArea.TextView;
            textView.BackgroundRenderers.Add(new DiffBackgroundRenderer(parsed.Rows));

            var typeface = new Typeface(Editor.FontFamily, Editor.FontStyle, Editor.FontWeight, Editor.FontStretch);
            Editor.TextArea.LeftMargins.Insert(0, new DiffLineNumberMargin(parsed.Rows, typeface, Editor.FontSize));

            // Size the body to its content (capped) so the OUTER transcript scrolls, not
            // each diff — WordWrap is off, so DocumentHeight is width-independent/stable.
            Editor.UpdateLayout();
            double docHeight = textView.DocumentHeight;
            if (docHeight <= 0)
            {
                double lineH = textView.DefaultLineHeight > 0 ? textView.DefaultLineHeight : Editor.FontSize * 1.5;
                docHeight = Math.Max(1, parsed.Rows.Count) * lineH;
            }
            double chrome = Editor.Padding.Top + Editor.Padding.Bottom + 18; // padding + room for a horizontal scrollbar
            Editor.Height = Math.Min(docHeight + chrome, MaxBodyHeight);
        }

        // ── Language → highlighting definition ──────────────────────────────
        // Prefer an explicit mapping (so .ts/.tsx borrow JavaScript, and .sql/.json
        // reuse this app's own embedded definitions), then fall back to AvalonEdit's
        // own extension registry. Highlighting is purely cosmetic — any miss just
        // leaves the diff plain rather than failing.
        private static readonly Dictionary<string, IHighlightingDefinition?> EmbeddedCache = new();

        private static IHighlightingDefinition? ResolveHighlighting(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath)) return null;
            try
            {
                var ext = Path.GetExtension(filePath).ToLowerInvariant();
                var mgr = HighlightingManager.Instance;
                return ext switch
                {
                    ".cs" => mgr.GetDefinition("C#"),
                    ".js" or ".jsx" or ".mjs" or ".cjs" or ".ts" or ".tsx" => mgr.GetDefinition("JavaScript"),
                    ".json" => LoadEmbedded("JsonSyntax"),
                    ".sql" => LoadEmbedded("SqlSyntax"),
                    ".xml" or ".xaml" or ".csproj" or ".props" or ".targets" or ".svg" or ".config" or ".xsd" => mgr.GetDefinition("XML"),
                    ".html" or ".htm" or ".cshtml" => mgr.GetDefinition("HTML"),
                    ".css" => mgr.GetDefinition("CSS"),
                    ".py" => mgr.GetDefinition("Python"),
                    ".md" or ".markdown" => mgr.GetDefinition("MarkDown"),
                    ".ps1" or ".psm1" or ".psd1" => mgr.GetDefinition("PowerShell"),
                    ".java" => mgr.GetDefinition("Java"),
                    ".c" or ".cpp" or ".cc" or ".cxx" or ".h" or ".hpp" => mgr.GetDefinition("C++"),
                    ".vb" => mgr.GetDefinition("VB"),
                    ".php" => mgr.GetDefinition("PHP"),
                    _ => mgr.GetDefinitionByExtension(ext),
                };
            }
            catch { return null; }
        }

        /// <summary>Loads (and caches) an embedded *.xshd, the same mechanism SqlRunnerView uses (#939).</summary>
        private static IHighlightingDefinition? LoadEmbedded(string baseName)
        {
            if (EmbeddedCache.TryGetValue(baseName, out var cached)) return cached;
            IHighlightingDefinition? def = null;
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using var stream = asm.GetManifestResourceStream($"BuildConsole.Controls.{baseName}.xshd");
                if (stream != null)
                {
                    using var reader = new XmlTextReader(stream);
                    def = HighlightingLoader.Load(reader, HighlightingManager.Instance);
                }
            }
            catch { def = null; }
            EmbeddedCache[baseName] = def;
            return def;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Parser
        // ══════════════════════════════════════════════════════════════════════

        private enum DiffLineKind { Context, Add, Remove, Hunk }

        private sealed class DiffRow
        {
            public DiffLineKind Kind;
            public string Text = "";
            /// <summary>The file line number to show in the gutter (new-side for add/context, old-side for remove); null for a hunk-header separator row.</summary>
            public int? DisplayNumber;
        }

        private sealed class ParsedDiff
        {
            public readonly List<DiffRow> Rows = new();
            public string? FilePath;
            public int Adds;
            public int Removes;
        }

        private static class DiffParser
        {
            // "@@ -oldStart,oldCount +newStart,newCount @@ optional-context"
            private static readonly Regex HunkRegex =
                new(@"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", RegexOptions.Compiled);

            public static ParsedDiff Parse(string rawDiff)
            {
                var result = new ParsedDiff();
                int oldNo = 1, newNo = 1;
                bool inHunk = false;

                foreach (var raw in rawDiff.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
                {
                    var hunk = HunkRegex.Match(raw);
                    if (hunk.Success)
                    {
                        oldNo = int.Parse(hunk.Groups[1].Value, CultureInfo.InvariantCulture);
                        newNo = int.Parse(hunk.Groups[2].Value, CultureInfo.InvariantCulture);
                        inHunk = true;
                        result.Rows.Add(new DiffRow { Kind = DiffLineKind.Hunk, Text = raw, DisplayNumber = null });
                        continue;
                    }

                    // File/patch headers only appear before the first hunk; inside a hunk a
                    // leading '-'/'+' is always a real change (even "--- x" removing "-- x").
                    if (!inHunk && IsFileHeader(raw))
                    {
                        CaptureFilePath(result, raw);
                        continue;
                    }

                    if (raw.StartsWith("\\", StringComparison.Ordinal)) continue; // "\ No newline at end of file"

                    if (raw.Length > 0 && raw[0] == '+')
                    {
                        result.Rows.Add(new DiffRow { Kind = DiffLineKind.Add, Text = raw.Substring(1), DisplayNumber = newNo });
                        newNo++;
                        result.Adds++;
                    }
                    else if (raw.Length > 0 && raw[0] == '-')
                    {
                        result.Rows.Add(new DiffRow { Kind = DiffLineKind.Remove, Text = raw.Substring(1), DisplayNumber = oldNo });
                        oldNo++;
                        result.Removes++;
                    }
                    else
                    {
                        // Context line: a leading space is the unified-diff marker (strip it);
                        // a fenced snippet without prefixes is shown verbatim.
                        var text = raw.Length > 0 && raw[0] == ' ' ? raw.Substring(1) : raw;
                        result.Rows.Add(new DiffRow { Kind = DiffLineKind.Context, Text = text, DisplayNumber = newNo });
                        oldNo++;
                        newNo++;
                    }
                }

                return result;
            }

            private static bool IsFileHeader(string line) =>
                line.StartsWith("diff --git ", StringComparison.Ordinal)
                || line.StartsWith("index ", StringComparison.Ordinal)
                || line.StartsWith("--- ", StringComparison.Ordinal)
                || line.StartsWith("+++ ", StringComparison.Ordinal)
                || line.StartsWith("old mode ", StringComparison.Ordinal)
                || line.StartsWith("new mode ", StringComparison.Ordinal)
                || line.StartsWith("new file mode ", StringComparison.Ordinal)
                || line.StartsWith("deleted file mode ", StringComparison.Ordinal)
                || line.StartsWith("rename ", StringComparison.Ordinal)
                || line.StartsWith("similarity index ", StringComparison.Ordinal);

            /// <summary>Pulls a display path from a header line, preferring the new-side (+++ b/…) path.</summary>
            private static void CaptureFilePath(ParsedDiff result, string line)
            {
                string? candidate = null;
                if (line.StartsWith("+++ ", StringComparison.Ordinal))
                    candidate = StripPathPrefix(line.Substring(4).Trim());
                else if (line.StartsWith("--- ", StringComparison.Ordinal) && result.FilePath == null)
                    candidate = StripPathPrefix(line.Substring(4).Trim());
                else if (line.StartsWith("diff --git ", StringComparison.Ordinal) && result.FilePath == null)
                {
                    // "diff --git a/foo b/foo" → take the b/ path.
                    var parts = line.Substring("diff --git ".Length).Split(' ');
                    if (parts.Length >= 2) candidate = StripPathPrefix(parts[^1]);
                }

                if (!string.IsNullOrEmpty(candidate) && candidate != "/dev/null")
                    result.FilePath = candidate;
            }

            private static string StripPathPrefix(string path)
            {
                // Drop a trailing tab-and-timestamp some diff tools append, then a/ or b/.
                var tab = path.IndexOf('\t');
                if (tab >= 0) path = path.Substring(0, tab);
                if (path.StartsWith("a/", StringComparison.Ordinal) || path.StartsWith("b/", StringComparison.Ordinal))
                    path = path.Substring(2);
                return path;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Per-line background coloring (green add / red remove / blue hunk)
        // ══════════════════════════════════════════════════════════════════════

        private sealed class DiffBackgroundRenderer : IBackgroundRenderer
        {
            private readonly IReadOnlyList<DiffRow> _rows;

            // ~15% tints over the dark surface — green #34D399 (ChatPane.Success),
            // red #EF4444 (ChatPane danger family), hunk a ~10% blue (#2563EB).
            private static readonly Brush AddBrush = Freeze(Color.FromArgb(0x26, 0x34, 0xD3, 0x99));
            private static readonly Brush RemoveBrush = Freeze(Color.FromArgb(0x2B, 0xEF, 0x44, 0x44));
            private static readonly Brush HunkBrush = Freeze(Color.FromArgb(0x1A, 0x25, 0x63, 0xEB));

            public DiffBackgroundRenderer(IReadOnlyList<DiffRow> rows) => _rows = rows;

            public KnownLayer Layer => KnownLayer.Background;

            public void Draw(TextView textView, DrawingContext dc)
            {
                if (textView == null || !textView.VisualLinesValid) return;
                foreach (var vl in textView.VisualLines)
                {
                    int idx = vl.FirstDocumentLine.LineNumber - 1;
                    if (idx < 0 || idx >= _rows.Count) continue;
                    Brush? brush = _rows[idx].Kind switch
                    {
                        DiffLineKind.Add => AddBrush,
                        DiffLineKind.Remove => RemoveBrush,
                        DiffLineKind.Hunk => HunkBrush,
                        _ => null,
                    };
                    if (brush == null) continue;
                    double y = vl.VisualTop - textView.ScrollOffset.Y;
                    dc.DrawRectangle(brush, null, new Rect(0, y, textView.ActualWidth, vl.Height));
                }
            }

            private static Brush Freeze(Color c)
            {
                var b = new SolidColorBrush(c);
                b.Freeze();
                return b;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Diff-aware line-number gutter
        // ══════════════════════════════════════════════════════════════════════
        // Subclasses AvalonEdit's own LineNumberMargin purely to inherit its TextView
        // wiring + scroll-invalidation, then fully overrides rendering to draw the
        // REAL diff line numbers (new-side for add/context, old-side for remove; none
        // for a hunk-header row) instead of sequential document numbers.

        private sealed class DiffLineNumberMargin : LineNumberMargin
        {
            private readonly IReadOnlyList<DiffRow> _rows;
            private readonly Typeface _typeface;
            private readonly double _emSize;
            private readonly int _maxDigits;

            private static readonly Brush AddNo = Freeze(Color.FromRgb(0x6E, 0xE7, 0xB7));      // brighter green
            private static readonly Brush RemoveNo = Freeze(Color.FromRgb(0xF8, 0xA5, 0xA5));   // ChatPane.Danger-ish
            private static readonly Brush ContextNo = Freeze(Color.FromRgb(0x64, 0x74, 0x8B));  // ChatPane.Muted7

            public DiffLineNumberMargin(IReadOnlyList<DiffRow> rows, Typeface typeface, double emSize)
            {
                _rows = rows;
                _typeface = typeface;
                _emSize = emSize;
                _maxDigits = Math.Max(2, rows.Where(r => r.DisplayNumber.HasValue)
                                             .Select(r => r.DisplayNumber!.Value.ToString(CultureInfo.InvariantCulture).Length)
                                             .DefaultIfEmpty(2).Max());
            }

            protected override Size MeasureOverride(Size availableSize)
            {
                var ft = FormatText(new string('9', _maxDigits), ContextNo);
                return new Size(ft.Width + 12, 0);
            }

            protected override void OnRender(DrawingContext drawingContext)
            {
                var textView = this.TextView;
                double width = RenderSize.Width;
                if (textView == null || !textView.VisualLinesValid) return;

                foreach (var vl in textView.VisualLines)
                {
                    int idx = vl.FirstDocumentLine.LineNumber - 1;
                    if (idx < 0 || idx >= _rows.Count) continue;
                    var row = _rows[idx];
                    if (!row.DisplayNumber.HasValue) continue; // hunk separator: no number

                    var brush = row.Kind switch
                    {
                        DiffLineKind.Add => AddNo,
                        DiffLineKind.Remove => RemoveNo,
                        _ => ContextNo,
                    };
                    var ft = FormatText(row.DisplayNumber.Value.ToString(CultureInfo.InvariantCulture), brush);
                    double y = vl.GetTextLineVisualYPosition(vl.TextLines[0], VisualYPosition.TextTop) - textView.VerticalOffset;
                    drawingContext.DrawText(ft, new Point(width - ft.Width - 6, y));
                }
            }

            private FormattedText FormatText(string text, Brush brush)
            {
                double dpi = 1.0;
                try { dpi = VisualTreeHelper.GetDpi(this).PixelsPerDip; } catch { /* disconnected visual */ }
                return new FormattedText(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                                         _typeface, _emSize, brush, dpi);
            }

            private static Brush Freeze(Color c)
            {
                var b = new SolidColorBrush(c);
                b.Freeze();
                return b;
            }
        }
    }
}
