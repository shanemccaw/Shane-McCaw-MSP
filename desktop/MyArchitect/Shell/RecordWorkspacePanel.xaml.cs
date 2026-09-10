using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using UserControl = System.Windows.Controls.UserControl;
using Button = System.Windows.Controls.Button;
using TextBox = System.Windows.Controls.TextBox;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Cursors = System.Windows.Input.Cursors;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using FontFamily = System.Windows.Media.FontFamily;

namespace MyArchitect.Shell;

/// <summary>
/// The always-docked, full-panel right-panel record workspace (UI_RULES.md §3). Same field
/// shapes as AdminV2's Peek — facts/edits/actions/list — rendered at full panel size instead of
/// a small overlay. Confirm-armed actions arm in place with no confirm dialog; arming resets
/// whenever a different record is rendered or the panel is cleared.
/// </summary>
public partial class RecordWorkspacePanel : UserControl
{
    private RecordWorkspaceSpec? _current;
    private WorkspaceAction? _armedAction;

    public RecordWorkspacePanel()
    {
        InitializeComponent();
        Render(null);
    }

    public void Render(RecordWorkspaceSpec? spec)
    {
        _current = spec;
        _armedAction = null;
        BodyPanel.Children.Clear();

        if (spec == null)
        {
            EmptyState.Visibility = Visibility.Visible;
            EyebrowText.Text = string.Empty;
            TitleText.Text = string.Empty;
            SubText.Text = string.Empty;
            return;
        }

        EmptyState.Visibility = Visibility.Collapsed;
        EyebrowText.Text = (spec.Eyebrow ?? spec.Kind).ToUpperInvariant();
        TitleText.Text = spec.Title;
        SubText.Text = spec.Sub ?? string.Empty;
        SubText.Visibility = string.IsNullOrEmpty(spec.Sub) ? Visibility.Collapsed : Visibility.Visible;

        if (spec.Facts.Count > 0)
        {
            var factsWrap = new WrapPanel { Margin = new Thickness(0, 0, 0, 12) };
            foreach (var fact in spec.Facts)
            {
                factsWrap.Children.Add(BuildFact(fact));
            }
            BodyPanel.Children.Add(factsWrap);
        }

        foreach (var edit in spec.Edits)
        {
            BodyPanel.Children.Add(BuildEdit(edit));
        }

        if (spec.Body is { } body)
        {
            BodyPanel.Children.Add(new TextBlock
            {
                Text = body.Title.ToUpperInvariant(),
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = Brush("#858585"),
                Margin = new Thickness(0, 8, 0, 4),
            });
            BodyPanel.Children.Add(new TextBlock
            {
                Text = body.Content,
                FontSize = 11,
                Foreground = Brush("#D4D4D4"),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = new FontFamily("Consolas"),
            });
        }

        if (spec.List is { } list)
        {
            BodyPanel.Children.Add(new TextBlock
            {
                Text = list.Title.ToUpperInvariant(),
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = Brush("#858585"),
                Margin = new Thickness(0, 12, 0, 4),
            });
            foreach (var row in list.Rows)
            {
                BodyPanel.Children.Add(BuildListRow(row));
            }
        }

        if (spec.Actions.Count > 0)
        {
            var actionsPanel = new StackPanel { Margin = new Thickness(0, 16, 0, 0) };
            foreach (var action in spec.Actions)
            {
                actionsPanel.Children.Add(BuildAction(action));
            }
            BodyPanel.Children.Add(actionsPanel);
        }
    }

    private static SolidColorBrush Brush(string hex) => (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;

    private static FrameworkElement BuildFact(WorkspaceFact fact)
    {
        bool big = !fact.Prose && fact.Value.Length <= 4;
        var panel = new StackPanel { Margin = new Thickness(0, 0, 20, 10), MinWidth = 60 };
        panel.Children.Add(new TextBlock
        {
            Text = fact.Value,
            FontSize = big ? 19 : 12.5,
            FontWeight = big ? FontWeights.ExtraBold : FontWeights.SemiBold,
            Foreground = Brush("#FFFFFF"),
            TextWrapping = big ? TextWrapping.NoWrap : TextWrapping.Wrap,
            MaxWidth = big ? double.PositiveInfinity : 160,
        });
        panel.Children.Add(new TextBlock
        {
            Text = fact.Label,
            FontSize = 10,
            Foreground = Brush("#858585"),
            Margin = new Thickness(0, 2, 0, 0),
        });
        return panel;
    }

    private FrameworkElement BuildEdit(WorkspaceEdit edit)
    {
        var panel = new StackPanel { Margin = new Thickness(0, 0, 0, 10) };
        panel.Children.Add(new TextBlock { Text = edit.Label, FontSize = 10, Foreground = Brush("#858585") });

        if (edit.Options is { Count: > 0 } options)
        {
            var btn = new Button
            {
                Content = edit.Value,
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Background = Brush("#252526"),
                Foreground = Brush("#E0E0E0"),
                BorderBrush = Brush("#3E3E42"),
                Padding = new Thickness(8, 4, 8, 4),
                Margin = new Thickness(0, 2, 0, 0),
            };
            btn.Click += (_, _) =>
            {
                var idx = options.IndexOf(edit.Value);
                var next = options[(idx + 1) % options.Count];
                edit.OnChange(next);
                if (_current != null) Render(_current); // write-through, re-render from caller's updated spec
            };
            panel.Children.Add(btn);
        }
        else
        {
            var box = new TextBox
            {
                Text = edit.Value,
                Background = Brush("#252526"),
                Foreground = Brush("#E0E0E0"),
                BorderBrush = Brush("#3E3E42"),
                Padding = new Thickness(6, 4, 6, 4),
                Margin = new Thickness(0, 2, 0, 0),
            };
            box.LostFocus += (_, _) =>
            {
                if (box.Text != edit.Value) edit.OnChange(box.Text);
            };
            panel.Children.Add(box);
        }

        return panel;
    }

    private static FrameworkElement BuildListRow(WorkspaceListRow row)
    {
        var border = new Border
        {
            Background = Brush("#1E1E1E"),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 6, 8, 6),
            Margin = new Thickness(0, 0, 0, 4),
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel();
        left.Children.Add(new TextBlock { Text = row.Name, FontSize = 12, Foreground = Brush("#E0E0E0") });
        if (!string.IsNullOrEmpty(row.Sub))
        {
            left.Children.Add(new TextBlock { Text = row.Sub, FontSize = 10, Foreground = Brush("#858585") });
        }
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        if (!string.IsNullOrEmpty(row.Right))
        {
            var right = new TextBlock { Text = row.Right, FontSize = 11, Foreground = Brush("#389BFF"), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(right, 1);
            grid.Children.Add(right);
        }

        border.Child = grid;
        border.MouseLeftButtonUp += (_, _) => row.OnSelect();
        return border;
    }

    private FrameworkElement BuildAction(WorkspaceAction action)
    {
        var btn = new Button
        {
            Content = action.Label,
            Margin = new Thickness(0, 0, 0, 6),
            Padding = new Thickness(10, 6, 10, 6),
            Background = action.Danger ? Brush("#5A1D1D") : Brush("#0E639C"),
            Foreground = Brush("#FFFFFF"),
            BorderThickness = new Thickness(0),
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };

        btn.Click += (_, _) =>
        {
            if (!action.Confirm)
            {
                action.OnSelect();
                return;
            }

            if (_armedAction == action)
            {
                _armedAction = null;
                action.OnSelect();
                if (_current != null) Render(_current);
            }
            else
            {
                _armedAction = action;
                btn.Content = $"{action.Label} — press again";
            }
        };

        return btn;
    }
}
