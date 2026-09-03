using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace BuildConsole.Services
{
    /// <summary>
    /// Renders markdown text into rich WPF UI elements (Headers, Indented Numbered & Bullet Lists,
    /// Code Blocks, Inline Badges, Blockquotes, and File/URL Hyperlinks).
    /// </summary>
    public static class MarkdownRenderer
    {
        private static readonly Regex HeaderRegex = new(@"^(#{1,6})\s+(.*)$", RegexOptions.Compiled);
        private static readonly Regex OrderedListRegex = new(@"^(\s*)(\d+)\.\s+(.*)$", RegexOptions.Compiled);
        private static readonly Regex UnorderedListRegex = new(@"^(\s*)(?:[\*\-\+]|\u2022)\s+(.*)$", RegexOptions.Compiled);
        private static readonly Regex TaskListRegex = new(@"^(\s*)(?:[\*\-\+]|\u2022)\s+\[([ xX])\]\s+(.*)$", RegexOptions.Compiled);
        private static readonly Regex BlockquoteRegex = new(@"^>\s*(.*)$", RegexOptions.Compiled);
        private static readonly Regex HorizontalRuleRegex = new(@"^\s*(?:---|\*\*\*|___)\s*$", RegexOptions.Compiled);
        // GFM pipe-table separator row: |---|:---:|---:| etc, one or more dash-cells, optional leading/trailing pipe.
        private static readonly Regex TableSeparatorRegex = new(@"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$", RegexOptions.Compiled);
        private static readonly Regex TableRowLineRegex = new(@"^\s*\|", RegexOptions.Compiled);
        private static readonly Regex FileRegex = new(@"(?:\w[\w\-\./\\]*)\.(?:sql|cs|ts|tsx|json|xaml|ps1|cmd|md)\b", RegexOptions.Compiled);
        private static readonly Regex UrlRegex = new(@"https?://[^\s\)\>\]]+", RegexOptions.Compiled);
        private static readonly Regex IssueRefRegex = new(@"(?:^|\s)#(\d+)\b", RegexOptions.Compiled);
        private static readonly Regex MarkdownLinkRegex = new(@"\[([^\]]+)\]\(([^)]+)\)", RegexOptions.Compiled);
        private static readonly Regex InlineCodeRegex = new(@"`([^`]+)`", RegexOptions.Compiled);
        private static readonly Regex BoldRegex = new(@"\*\*([^*]+)\*\*|__([^_]+)__", RegexOptions.Compiled);
        private static readonly Regex ItalicRegex = new(@"(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)", RegexOptions.Compiled);

        // Codepoints that are NEVER legitimate rendered content and show up as tofu boxes
        // in a text font: C0/C1 control chars (except tab/newline/CR), zero-width joiners/
        // spaces, BOM/word-joiner, the Unicode replacement + object-replacement chars, and
        // the Basic Multilingual Plane Private-Use-Area (U+E000-U+F8FF) that icon fonts map
        // their glyphs into. When claude.ai's message DOM leaks an icon-font glyph into the
        // scraped markdown (Git #2072) this strips it; real text, symbols and emoji (which
        // live outside this set) are untouched.
        private static readonly Regex UnrenderableGlyphRegex = new(
            @"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF\uFFFC\uFFFD\uE000-\uF8FF]",
            RegexOptions.Compiled);

        /// <summary>
        /// Removes codepoints that can only render as tofu boxes (icon-font Private-Use-Area
        /// glyphs, control/zero-width chars, replacement chars). Defense-in-depth for the
        /// scraped-glyph bug (Git #2072); safe on all real content.
        /// </summary>
        public static string StripUnrenderableGlyphs(string text) =>
            string.IsNullOrEmpty(text) ? (text ?? "") : UnrenderableGlyphRegex.Replace(text, "");

        public class RenderOptions
        {
            public Func<string, Brush>? GetBrush { get; set; }
            public Action<string>? OnFileClick { get; set; }
            public Action<string>? OnUrlClick { get; set; }
            public Action<int>? OnIssueClick { get; set; }
            public Action<string>? OnRunTest { get; set; }
            public double BaseFontSize { get; set; } = 13;
        }

        public static StackPanel Render(string? markdown, RenderOptions? options = null)
        {
            options ??= new RenderOptions();
            var getBrush = options.GetBrush ?? (key => (Brush)Application.Current.FindResource(key));

            var root = new StackPanel();
            if (string.IsNullOrWhiteSpace(markdown)) return root;

            // Strip icon-font / control glyphs that would otherwise render as tofu boxes (Git #2072).
            markdown = StripUnrenderableGlyphs(markdown);

            string[] lines = markdown.Replace("\r\n", "\n").Split('\n');
            int i = 0;

            while (i < lines.Length)
            {
                string line = lines[i];

                // 1. Code Block Fence (```)
                if (line.TrimStart().StartsWith("```"))
                {
                    string lang = line.TrimStart().Substring(3).Trim();
                    var codeLines = new List<string>();
                    i++;
                    while (i < lines.Length && !lines[i].TrimStart().StartsWith("```"))
                    {
                        codeLines.Add(lines[i]);
                        i++;
                    }
                    if (i < lines.Length && lines[i].TrimStart().StartsWith("```")) i++;

                    root.Children.Add(CreateCodeBlock(string.Join("\n", codeLines), lang, getBrush));
                    continue;
                }

                // 2. Horizontal Rule (---)
                if (HorizontalRuleRegex.IsMatch(line))
                {
                    root.Children.Add(new Border
                    {
                        Height = 1,
                        Background = getBrush("Surface0Brush"),
                        Margin = new Thickness(0, 10, 0, 10)
                    });
                    i++;
                    continue;
                }

                // 2.5. GFM Pipe Table (header row | header |, separator row |---|---|, data rows)
                // Real gap fixed by #2705: a header row must itself contain a pipe (a bare "---"
                // line is already consumed as a Horizontal Rule above) and be immediately followed
                // by a separator row matching GFM's `|---|:---:|---:|` syntax.
                if (line.Contains('|') && i + 1 < lines.Length &&
                    lines[i + 1].Contains('|') && TableSeparatorRegex.IsMatch(lines[i + 1]))
                {
                    var headerCells = SplitTableRow(line);
                    var alignments = ParseTableAlignments(lines[i + 1]);
                    i += 2;

                    var dataRows = new List<List<string>>();
                    while (i < lines.Length && lines[i].Contains('|') && !string.IsNullOrWhiteSpace(lines[i]))
                    {
                        dataRows.Add(SplitTableRow(lines[i]));
                        i++;
                    }

                    root.Children.Add(CreateTable(headerCells, alignments, dataRows, options, getBrush));
                    continue;
                }

                // 3. Headers (# H1, ## H2, ### H3, #### H4)
                var headerMatch = HeaderRegex.Match(line);
                if (headerMatch.Success)
                {
                    int level = headerMatch.Groups[1].Value.Length;
                    string headerText = headerMatch.Groups[2].Value.Trim();
                    root.Children.Add(CreateHeader(headerText, level, options, getBrush));
                    i++;
                    continue;
                }

                // 4. Blockquote (> quote)
                var bqMatch = BlockquoteRegex.Match(line);
                if (bqMatch.Success)
                {
                    var bqLines = new List<string> { bqMatch.Groups[1].Value };
                    i++;
                    while (i < lines.Length && lines[i].TrimStart().StartsWith(">"))
                    {
                        bqLines.Add(lines[i].TrimStart().Substring(1).TrimStart());
                        i++;
                    }
                    root.Children.Add(CreateBlockquote(string.Join("\n", bqLines), options, getBrush));
                    continue;
                }

                // 5. Task List Item (- [ ] or - [x])
                var taskMatch = TaskListRegex.Match(line);
                if (taskMatch.Success)
                {
                    int indentSpaces = taskMatch.Groups[1].Value.Length;
                    bool isChecked = taskMatch.Groups[2].Value.Trim().Equals("x", StringComparison.OrdinalIgnoreCase);
                    string itemText = taskMatch.Groups[3].Value.Trim();
                    root.Children.Add(CreateTaskItem(itemText, isChecked, indentSpaces, options, getBrush));
                    i++;
                    continue;
                }

                // 6. Ordered / Numbered List Item (1. item)
                var orderedMatch = OrderedListRegex.Match(line);
                if (orderedMatch.Success)
                {
                    int indentSpaces = orderedMatch.Groups[1].Value.Length;
                    string numberStr = orderedMatch.Groups[2].Value;
                    string itemText = orderedMatch.Groups[3].Value.Trim();
                    root.Children.Add(CreateOrderedListItem(numberStr, itemText, indentSpaces, options, getBrush));
                    i++;
                    continue;
                }

                // 7. Unordered / Bullet List Item (* item, - item)
                var unorderedMatch = UnorderedListRegex.Match(line);
                if (unorderedMatch.Success)
                {
                    int indentSpaces = unorderedMatch.Groups[1].Value.Length;
                    string itemText = unorderedMatch.Groups[2].Value.Trim();
                    root.Children.Add(CreateUnorderedListItem(itemText, indentSpaces, options, getBrush));
                    i++;
                    continue;
                }

                // 8. Empty Line
                if (string.IsNullOrWhiteSpace(line))
                {
                    root.Children.Add(new FrameworkElement { Height = 6 });
                    i++;
                    continue;
                }

                // 9. Standard Paragraph (collect consecutive text lines)
                var paraLines = new List<string> { line };
                i++;
                while (i < lines.Length &&
                       !string.IsNullOrWhiteSpace(lines[i]) &&
                       !lines[i].TrimStart().StartsWith("#") &&
                       !lines[i].TrimStart().StartsWith("```") &&
                       !lines[i].TrimStart().StartsWith(">") &&
                       !HorizontalRuleRegex.IsMatch(lines[i]) &&
                       !OrderedListRegex.IsMatch(lines[i]) &&
                       !UnorderedListRegex.IsMatch(lines[i]))
                {
                    paraLines.Add(lines[i]);
                    i++;
                }

                root.Children.Add(CreateParagraph(string.Join(" ", paraLines), options, getBrush));
            }

            return root;
        }

        private static FrameworkElement CreateHeader(string text, int level, RenderOptions options, Func<string, Brush> getBrush)
        {
            double size = level switch
            {
                1 => options.BaseFontSize + 5,
                2 => options.BaseFontSize + 3,
                3 => options.BaseFontSize + 1.5,
                _ => options.BaseFontSize + 0.5,
            };

            Brush brush = level switch
            {
                1 => getBrush("PeachBrush"),
                2 => getBrush("BlueBrush"),
                3 => getBrush("TextBrush"),
                _ => getBrush("Subtext1Brush")
            };

            var tb = new TextBlock
            {
                FontSize = size,
                FontWeight = level <= 2 ? FontWeights.Bold : FontWeights.SemiBold,
                Foreground = brush,
                Margin = level switch
                {
                    1 => new Thickness(0, 16, 0, 8),
                    2 => new Thickness(0, 14, 0, 6),
                    3 => new Thickness(0, 10, 0, 4),
                    _ => new Thickness(0, 6, 0, 3)
                },
                TextWrapping = TextWrapping.Wrap
            };

            PopulateInlines(tb, text, options, getBrush);

            if (level <= 2)
            {
                var panel = new StackPanel { Margin = tb.Margin };
                tb.Margin = new Thickness(0, 0, 0, 3);
                panel.Children.Add(tb);
                panel.Children.Add(new Border
                {
                    Height = 1,
                    Background = getBrush(level == 1 ? "Surface1Brush" : "Surface0Brush")
                });
                return panel;
            }

            return tb;
        }

        private static FrameworkElement CreateOrderedListItem(string number, string text, int indentSpaces, RenderOptions options, Func<string, Brush> getBrush)
        {
            double indent = Math.Max(0, (indentSpaces / 2) * 16) + 4;
            var grid = new Grid
            {
                Margin = new Thickness(indent, 2, 0, 2)
            };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var numBlock = new TextBlock
            {
                Text = $"{number}.",
                FontSize = options.BaseFontSize,
                FontWeight = FontWeights.Bold,
                Foreground = getBrush("PeachBrush"),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            Grid.SetColumn(numBlock, 0);
            grid.Children.Add(numBlock);

            var textBlock = new TextBlock
            {
                FontSize = options.BaseFontSize,
                Foreground = getBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19
            };
            PopulateInlines(textBlock, text, options, getBrush);
            Grid.SetColumn(textBlock, 1);
            grid.Children.Add(textBlock);

            return grid;
        }

        private static FrameworkElement CreateUnorderedListItem(string text, int indentSpaces, RenderOptions options, Func<string, Brush> getBrush)
        {
            int level = indentSpaces / 2;
            double indent = Math.Max(0, level * 16) + 4;
            string bullet = level switch
            {
                0 => "•",
                1 => "◦",
                _ => "▪"
            };

            var grid = new Grid
            {
                Margin = new Thickness(indent, 2, 0, 2)
            };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var bulletBlock = new TextBlock
            {
                Text = bullet,
                FontSize = options.BaseFontSize + 1,
                FontWeight = FontWeights.Bold,
                Foreground = getBrush("BlueBrush"),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            Grid.SetColumn(bulletBlock, 0);
            grid.Children.Add(bulletBlock);

            var textBlock = new TextBlock
            {
                FontSize = options.BaseFontSize,
                Foreground = getBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19
            };
            PopulateInlines(textBlock, text, options, getBrush);
            Grid.SetColumn(textBlock, 1);
            grid.Children.Add(textBlock);

            return grid;
        }

        private static FrameworkElement CreateTaskItem(string text, bool isChecked, int indentSpaces, RenderOptions options, Func<string, Brush> getBrush)
        {
            double indent = Math.Max(0, (indentSpaces / 2) * 16) + 4;
            var grid = new Grid
            {
                Margin = new Thickness(indent, 2, 0, 2)
            };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var iconBlock = new TextBlock
            {
                Text = isChecked ? "☑" : "☐",
                FontSize = options.BaseFontSize + 2,
                Foreground = isChecked ? getBrush("GreenBrush") : getBrush("Subtext0Brush"),
                HorizontalAlignment = HorizontalAlignment.Left
            };
            Grid.SetColumn(iconBlock, 0);
            grid.Children.Add(iconBlock);

            var textBlock = new TextBlock
            {
                FontSize = options.BaseFontSize,
                Foreground = isChecked ? getBrush("Subtext0Brush") : getBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19
            };
            if (isChecked)
            {
                textBlock.TextDecorations = TextDecorations.Strikethrough;
            }
            PopulateInlines(textBlock, text, options, getBrush);
            Grid.SetColumn(textBlock, 1);
            grid.Children.Add(textBlock);

            return grid;
        }

        private static FrameworkElement CreateBlockquote(string text, RenderOptions options, Func<string, Brush> getBrush)
        {
            bool isWarning = text.Contains("[!WARNING]") || text.Contains("[!CAUTION]") || text.Contains("[!IMPORTANT]");
            string cleanText = Regex.Replace(text, @"\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*", "");

            var border = new Border
            {
                BorderBrush = getBrush(isWarning ? "PeachBrush" : "BlueBrush"),
                BorderThickness = new Thickness(3, 0, 0, 0),
                Background = getBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(0, 4, 4, 0),
                Padding = new Thickness(10, 6, 10, 6),
                Margin = new Thickness(0, 6, 0, 6)
            };

            var tb = new TextBlock
            {
                FontSize = options.BaseFontSize,
                FontStyle = FontStyles.Italic,
                Foreground = getBrush("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                LineHeight = 19
            };
            PopulateInlines(tb, cleanText, options, getBrush);
            border.Child = tb;
            return border;
        }

        private static FrameworkElement CreateCodeBlock(string code, string lang, Func<string, Brush> getBrush)
        {
            var border = new Border
            {
                Background = getBrush("MantleBrush"),
                BorderBrush = getBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 8, 0, 8)
            };

            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            if (!string.IsNullOrEmpty(lang))
            {
                var langText = new TextBlock
                {
                    Text = lang.ToUpperInvariant(),
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = getBrush("Subtext0Brush"),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    Margin = new Thickness(0, 0, 0, 4)
                };
                Grid.SetRow(langText, 0);
                grid.Children.Add(langText);
            }

            var tb = new TextBox
            {
                Text = code,
                FontFamily = new FontFamily("Consolas, Cascadia Code, Courier New"),
                FontSize = 11.5,
                Foreground = getBrush("TextBrush"),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                IsReadOnly = true,
                TextWrapping = TextWrapping.NoWrap,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Padding = new Thickness(0)
            };
            Grid.SetRow(tb, 1);
            grid.Children.Add(tb);

            border.Child = grid;
            return border;
        }

        private enum TableAlign { Left, Center, Right }

        /// <summary>Splits one GFM table row into trimmed cell strings, honoring a leading/trailing
        /// pipe (both optional per spec) and an escaped <c>\|</c> inside a cell's content.</summary>
        private static List<string> SplitTableRow(string line)
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("|")) trimmed = trimmed.Substring(1);
            if (trimmed.EndsWith("|") && !trimmed.EndsWith("\\|")) trimmed = trimmed.Substring(0, trimmed.Length - 1);

            var cells = new List<string>();
            var current = new System.Text.StringBuilder();
            for (int c = 0; c < trimmed.Length; c++)
            {
                if (trimmed[c] == '\\' && c + 1 < trimmed.Length && trimmed[c + 1] == '|')
                {
                    current.Append('|');
                    c++;
                }
                else if (trimmed[c] == '|')
                {
                    cells.Add(current.ToString().Trim());
                    current.Clear();
                }
                else
                {
                    current.Append(trimmed[c]);
                }
            }
            cells.Add(current.ToString().Trim());
            return cells;
        }

        private static List<TableAlign> ParseTableAlignments(string separatorLine)
        {
            var result = new List<TableAlign>();
            foreach (var raw in SplitTableRow(separatorLine))
            {
                string cell = raw.Trim();
                bool left = cell.StartsWith(":");
                bool right = cell.EndsWith(":");
                result.Add(left && right ? TableAlign.Center : right ? TableAlign.Right : TableAlign.Left);
            }
            return result;
        }

        /// <summary>Renders a real bordered WPF table (Grid, header row visually distinct) for a
        /// GFM pipe table — #2705's fix for the shared renderer's previous total lack of table
        /// support (a table rendered as flat paragraph text, pipes and all).</summary>
        private static FrameworkElement CreateTable(List<string> headerCells, List<TableAlign> alignments,
            List<List<string>> dataRows, RenderOptions options, Func<string, Brush> getBrush)
        {
            int columnCount = headerCells.Count;

            var outerBorder = new Border
            {
                BorderBrush = getBrush("Surface1Brush"),
                BorderThickness = new Thickness(1, 1, 0, 0),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 8, 0, 8),
                ClipToBounds = true
            };

            var grid = new Grid();
            for (int c = 0; c < columnCount; c++)
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            int totalRows = 1 + dataRows.Count;
            for (int r = 0; r < totalRows; r++)
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            AddTableRow(grid, 0, headerCells, columnCount, alignments, isHeader: true, options, getBrush);
            for (int r = 0; r < dataRows.Count; r++)
                AddTableRow(grid, r + 1, dataRows[r], columnCount, alignments, isHeader: false, options, getBrush);

            outerBorder.Child = grid;
            return outerBorder;
        }

        private static void AddTableRow(Grid grid, int rowIndex, List<string> cells, int columnCount,
            List<TableAlign> alignments, bool isHeader, RenderOptions options, Func<string, Brush> getBrush)
        {
            for (int c = 0; c < columnCount; c++)
            {
                string cellText = c < cells.Count ? cells[c] : "";
                TableAlign align = c < alignments.Count ? alignments[c] : TableAlign.Left;

                var cellBorder = new Border
                {
                    BorderBrush = getBrush("Surface1Brush"),
                    BorderThickness = new Thickness(0, 0, 1, 1),
                    Background = isHeader ? getBrush("Surface0Brush") : Brushes.Transparent,
                    Padding = new Thickness(8, 5, 8, 5)
                };

                var tb = new TextBlock
                {
                    FontSize = options.BaseFontSize - (isHeader ? 0 : 0.5),
                    FontWeight = isHeader ? FontWeights.SemiBold : FontWeights.Normal,
                    Foreground = getBrush(isHeader ? "TextBrush" : "Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    TextAlignment = align switch
                    {
                        TableAlign.Center => TextAlignment.Center,
                        TableAlign.Right => TextAlignment.Right,
                        _ => TextAlignment.Left
                    }
                };
                PopulateInlines(tb, cellText, options, getBrush);
                cellBorder.Child = tb;

                Grid.SetRow(cellBorder, rowIndex);
                Grid.SetColumn(cellBorder, c);
                grid.Children.Add(cellBorder);
            }
        }

        private static FrameworkElement CreateParagraph(string text, RenderOptions options, Func<string, Brush> getBrush)
        {
            var tb = new TextBlock
            {
                FontSize = options.BaseFontSize,
                Foreground = getBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 3, 0, 3),
                LineHeight = 20
            };
            PopulateInlines(tb, text, options, getBrush);
            return tb;
        }

        /// <summary>
        /// Parses inline Markdown styling (bold, italic, inline code, links, files, #issues) into WPF Inlines.
        /// </summary>
        public static void PopulateInlines(TextBlock tb, string rawText, RenderOptions options, Func<string, Brush> getBrush)
        {
            if (string.IsNullOrEmpty(rawText)) return;

            // Extract tokens using unified match finding
            var tokens = TokenizeInline(rawText);
            foreach (var tok in tokens)
            {
                switch (tok.Kind)
                {
                    case TokenKind.Bold:
                        var boldRun = new Run(tok.Text) { FontWeight = FontWeights.Bold };
                        tb.Inlines.Add(boldRun);
                        break;

                    case TokenKind.Italic:
                        var italRun = new Run(tok.Text) { FontStyle = FontStyles.Italic };
                        tb.Inlines.Add(italRun);
                        break;

                    case TokenKind.InlineCode:
                        var codeSpan = new Span();
                        var border = new Border
                        {
                            Background = getBrush("Surface0Brush"),
                            BorderBrush = getBrush("Surface1Brush"),
                            BorderThickness = new Thickness(1),
                            CornerRadius = new CornerRadius(3),
                            Padding = new Thickness(4, 1, 4, 1),
                            Margin = new Thickness(2, 0, 2, 0),
                            Child = new TextBlock
                            {
                                Text = tok.Text,
                                FontFamily = new FontFamily("Consolas, Courier New"),
                                FontSize = options.BaseFontSize - 1,
                                Foreground = getBrush("PeachBrush"),
                                VerticalAlignment = VerticalAlignment.Center
                            }
                        };
                        codeSpan.Inlines.Add(new InlineUIContainer(border));
                        tb.Inlines.Add(codeSpan);
                        break;

                    case TokenKind.FileLink:
                        var fileLink = new Hyperlink(new Run(tok.Text))
                        {
                            Foreground = getBrush("BlueBrush"),
                            TextDecorations = TextDecorations.Underline,
                            Cursor = System.Windows.Input.Cursors.Hand
                        };
                        string filePath = tok.Text;
                        fileLink.Click += (s, e) => options.OnFileClick?.Invoke(filePath);
                        tb.Inlines.Add(fileLink);
                        break;

                    case TokenKind.UrlLink:
                        var urlLink = new Hyperlink(new Run(tok.Text))
                        {
                            Foreground = getBrush("BlueBrush"),
                            TextDecorations = TextDecorations.Underline,
                            Cursor = System.Windows.Input.Cursors.Hand
                        };
                        string url = tok.Text;
                        urlLink.Click += (s, e) => options.OnUrlClick?.Invoke(url);
                        tb.Inlines.Add(urlLink);
                        break;

                    case TokenKind.MarkdownLink:
                        var mdLink = new Hyperlink(new Run(tok.Text))
                        {
                            Foreground = getBrush("BlueBrush"),
                            TextDecorations = TextDecorations.Underline,
                            Cursor = System.Windows.Input.Cursors.Hand
                        };
                        string linkTarget = tok.Target ?? tok.Text;
                        mdLink.Click += (s, e) =>
                        {
                            if (linkTarget.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                                options.OnUrlClick?.Invoke(linkTarget);
                            else
                                options.OnFileClick?.Invoke(linkTarget);
                        };
                        tb.Inlines.Add(mdLink);
                        break;

                    case TokenKind.IssueRef:
                        if (int.TryParse(tok.Text, out var issueNum))
                        {
                            var issueLink = new Hyperlink(new Run($"#{tok.Text}"))
                            {
                                Foreground = getBrush("PeachBrush"),
                                FontWeight = FontWeights.SemiBold,
                                TextDecorations = null,
                                Cursor = System.Windows.Input.Cursors.Hand
                            };
                            issueLink.Click += (s, e) => options.OnIssueClick?.Invoke(issueNum);
                            tb.Inlines.Add(issueLink);
                        }
                        else
                        {
                            tb.Inlines.Add(new Run(tok.Text));
                        }
                        break;

                    default:
                        tb.Inlines.Add(new Run(tok.Text));
                        break;
                }
            }
        }

        private enum TokenKind
        {
            Plain,
            Bold,
            Italic,
            InlineCode,
            FileLink,
            UrlLink,
            MarkdownLink,
            IssueRef
        }

        private class InlineToken
        {
            public TokenKind Kind { get; set; }
            public string Text { get; set; } = "";
            public string? Target { get; set; }
            public int Index { get; set; }
            public int Length { get; set; }
        }

        private static List<InlineToken> TokenizeInline(string text)
        {
            var rawTokens = new List<InlineToken>();

            // 1. Markdown Links [label](url)
            foreach (Match m in MarkdownLinkRegex.Matches(text))
            {
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.MarkdownLink,
                    Text = m.Groups[1].Value,
                    Target = m.Groups[2].Value,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 2. Inline Code `code`
            foreach (Match m in InlineCodeRegex.Matches(text))
            {
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.InlineCode,
                    Text = m.Groups[1].Value,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 3. Bold **text**
            foreach (Match m in BoldRegex.Matches(text))
            {
                string val = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.Bold,
                    Text = val,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 4. Italic *text*
            foreach (Match m in ItalicRegex.Matches(text))
            {
                string val = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.Italic,
                    Text = val,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 5. File references (.cs, .ts, etc.)
            foreach (Match m in FileRegex.Matches(text))
            {
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.FileLink,
                    Text = m.Value,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 6. URLs (http/https)
            foreach (Match m in UrlRegex.Matches(text))
            {
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.UrlLink,
                    Text = m.Value,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // 7. Issue references (#123)
            foreach (Match m in IssueRefRegex.Matches(text))
            {
                rawTokens.Add(new InlineToken
                {
                    Kind = TokenKind.IssueRef,
                    Text = m.Groups[1].Value,
                    Index = m.Index,
                    Length = m.Length
                });
            }

            // Discard overlapping matches and build continuous stream
            var sorted = rawTokens.OrderBy(t => t.Index).ThenByDescending(t => t.Length).ToList();
            var nonOverlapping = new List<InlineToken>();
            int lastEnd = 0;

            foreach (var tok in sorted)
            {
                if (tok.Index >= lastEnd)
                {
                    nonOverlapping.Add(tok);
                    lastEnd = tok.Index + tok.Length;
                }
            }

            var result = new List<InlineToken>();
            int currentIndex = 0;

            foreach (var tok in nonOverlapping)
            {
                if (tok.Index > currentIndex)
                {
                    result.Add(new InlineToken
                    {
                        Kind = TokenKind.Plain,
                        Text = text.Substring(currentIndex, tok.Index - currentIndex)
                    });
                }
                result.Add(tok);
                currentIndex = tok.Index + tok.Length;
            }

            if (currentIndex < text.Length)
            {
                result.Add(new InlineToken
                {
                    Kind = TokenKind.Plain,
                    Text = text.Substring(currentIndex)
                });
            }

            return result;
        }
    }
}
