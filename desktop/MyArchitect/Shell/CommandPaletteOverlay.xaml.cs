using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using UserControl = System.Windows.Controls.UserControl;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using MouseButtonEventArgs = System.Windows.Input.MouseButtonEventArgs;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Cursors = System.Windows.Input.Cursors;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using FontFamily = System.Windows.Media.FontFamily;

namespace MyArchitect.Shell;

/// <summary>
/// Command Palette — four prefixes (UI_RULES.md §5): <c>@</c> destination, <c>&gt;</c> action,
/// <c>#</c> record, <c>?</c> answer. Commands are recomputed live from
/// <see cref="ShellRegistry.GetPaletteCommands"/> on every open, never cached. Esc closes it —
/// the palette is frontmost in the shell's unwind order (SHELL.md: palette → gallery → peek).
/// </summary>
public partial class CommandPaletteOverlay : UserControl
{
    private ShellRegistry? _registry;

    public CommandPaletteOverlay()
    {
        InitializeComponent();
    }

    public void Initialize(ShellRegistry registry)
    {
        _registry = registry;
    }

    public void Open()
    {
        if (_registry == null) return;
        Visibility = Visibility.Visible;
        QueryBox.Text = string.Empty;
        Render();
        Focus();
        Keyboard.Focus(QueryBox);
    }

    public void Close()
    {
        Visibility = Visibility.Collapsed;
    }

    private void Root_MouseDown(object sender, MouseButtonEventArgs e) => Close();

    private void Panel_MouseDown(object sender, MouseButtonEventArgs e) => e.Handled = true;

    private void Root_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
            e.Handled = true;
        }
    }

    private void QueryBox_TextChanged(object sender, TextChangedEventArgs e) => Render();

    private static (PaletteType? Type, string Remainder) ParsePrefix(string text)
    {
        if (text.Length == 0) return (null, text);
        return text[0] switch
        {
            '@' => (PaletteType.Destination, text[1..]),
            '>' => (PaletteType.Action, text[1..]),
            '#' => (PaletteType.Record, text[1..]),
            '?' => (PaletteType.Answer, text[1..]),
            _ => (null, text),
        };
    }

    private void Render()
    {
        if (_registry == null) return;
        ResultsPanel.Children.Clear();
        var all = _registry.GetPaletteCommands(); // live, never cached (UI_RULES.md §5)
        var (prefixType, rest) = ParsePrefix(QueryBox.Text ?? string.Empty);

        IEnumerable<PaletteCommand> pool = prefixType.HasValue
            ? all.Where(c => c.Type == prefixType.Value)
            : all;

        List<PaletteCommand> results;
        if (string.IsNullOrWhiteSpace(rest))
        {
            // Empty state: destinations, then answers, then actions, then records — banded.
            results = pool
                .OrderBy(c => c.Type switch
                {
                    PaletteType.Destination => 0,
                    PaletteType.Answer => 1,
                    PaletteType.Action => 2,
                    PaletteType.Record => 3,
                    _ => 4,
                })
                .ToList();
        }
        else
        {
            results = CommandMatcher.Match(pool, rest);
        }

        if (results.Count == 0)
        {
            ResultsPanel.Children.Add(new TextBlock
            {
                Text = "No matches.",
                Foreground = Brush("#858585"),
                Margin = new Thickness(10),
            });
            return;
        }

        string? lastType = null;
        foreach (var cmd in results.Take(50))
        {
            var typeLabel = cmd.Type.ToString();
            if (typeLabel != lastType)
            {
                ResultsPanel.Children.Add(new TextBlock
                {
                    Text = typeLabel.ToUpperInvariant(),
                    FontSize = 9,
                    FontWeight = FontWeights.Bold,
                    Foreground = Brush("#858585"),
                    Margin = new Thickness(8, 8, 8, 2),
                });
                lastType = typeLabel;
            }
            ResultsPanel.Children.Add(BuildRow(cmd));
        }
    }

    private FrameworkElement BuildRow(PaletteCommand cmd)
    {
        var badge = new Border
        {
            Background = Brush("#333333"),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(4, 1, 4, 1),
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        badge.Child = new TextBlock
        {
            Text = Badge(cmd.Type),
            FontSize = 9,
            FontFamily = new FontFamily("Consolas"),
            Foreground = Brush("#AAAAAA"),
        };

        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock { Text = cmd.Name, Foreground = Brush("#E0E0E0"), FontSize = 12 });
        if (!string.IsNullOrEmpty(cmd.Sub))
        {
            text.Children.Add(new TextBlock { Text = cmd.Sub, Foreground = Brush("#858585"), FontSize = 10 });
        }

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(badge, 0);
        Grid.SetColumn(text, 1);
        grid.Children.Add(badge);
        grid.Children.Add(text);

        if (!string.IsNullOrEmpty(cmd.Live))
        {
            var live = new TextBlock
            {
                Text = cmd.Live,
                Foreground = Brush("#389BFF"),
                FontWeight = FontWeights.Bold,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(live, 2);
            grid.Children.Add(live);
        }

        var row = new Border
        {
            Padding = new Thickness(8, 6, 8, 6),
            CornerRadius = new CornerRadius(4),
            Cursor = Cursors.Hand,
            Child = grid,
        };
        row.MouseEnter += (_, _) => row.Background = Brush("#2D2D30");
        row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
        row.MouseLeftButtonUp += (_, _) =>
        {
            Close();
            cmd.Run();
        };
        return row;
    }

    private static string Badge(PaletteType type) => type switch
    {
        PaletteType.Destination => "GO",
        PaletteType.Action => "DO",
        PaletteType.Record => "REC",
        PaletteType.Answer => "NOW",
        _ => "?",
    };

    private static SolidColorBrush Brush(string hex) => (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
}
