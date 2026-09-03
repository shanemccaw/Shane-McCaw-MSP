using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2383 (Feature #2382 "I have a thought", item 1) — topbar quick capture. The whole point is
/// that this never breaks flow: it opens as a lightweight popup anchored to the topbar pill (not a
/// tab, not a modal dialog), Enter files the thought and clears the box without closing the popup
/// so a run of thoughts can be captured back-to-back, and Esc (or a click anywhere else, via the
/// Popup's own StaysOpen="False") closes it and leaves whatever tab/chat was active exactly as it
/// was. Persistence is <see cref="QuickThoughtStore"/>; this file is purely the UI glue.
/// </summary>
public partial class MainWindow
{
    private void QuickThoughtPopup_Opened(object sender, EventArgs e)
    {
        QuickThoughtInput.Text = string.Empty;
        QuickThoughtSavedFlag.Visibility = Visibility.Collapsed;
        RenderQuickThoughts();

        // Focus after the popup has actually laid out, same pattern the Command Palette uses for
        // its own input — focusing immediately on Opened can lose the keyboard focus race.
        Dispatcher.BeginInvoke(new Action(() =>
        {
            QuickThoughtInput.Focus();
            Keyboard.Focus(QuickThoughtInput);
        }), DispatcherPriority.Input);
    }

    private void QuickThoughtInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        QuickThoughtPlaceholder.Visibility = string.IsNullOrEmpty(QuickThoughtInput.Text)
            ? Visibility.Visible : Visibility.Collapsed;
    }

    private void QuickThoughtInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            SaveQuickThought();
        }
        else if (e.Key == Key.Escape)
        {
            e.Handled = true;
            QuickThoughtPopup.IsOpen = false;
        }
    }

    private void SaveQuickThought()
    {
        var text = QuickThoughtInput.Text;
        if (string.IsNullOrWhiteSpace(text)) return;

        QuickThoughtStore.Add(text);

        // Files and clears — the composer stays put, the popup stays open, nothing else on
        // screen moves. That's "saves without breaking flow."
        QuickThoughtInput.Text = string.Empty;
        RenderQuickThoughts();

        QuickThoughtSavedFlag.Visibility = Visibility.Visible;
        QuickThoughtInput.Focus();
    }

    private void RenderQuickThoughts()
    {
        QuickThoughtRecentList.Children.Clear();
        var thoughts = QuickThoughtStore.GetAll();
        QuickThoughtEmptyLabel.Visibility = thoughts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        foreach (var thought in thoughts.Take(10))
        {
            var row = new StackPanel { Margin = new Thickness(2, 0, 2, 6) };
            row.Children.Add(new TextBlock
            {
                Text = thought.Text,
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 11,
                Foreground = (Brush)FindResource("Brush.Text.Heading")
            });
            row.Children.Add(new TextBlock
            {
                Text = thought.CapturedAtUtc.ToLocalTime().ToString("MMM d, h:mm tt"),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 9,
                Foreground = (Brush)FindResource("Brush.Text.Dim"),
                Margin = new Thickness(0, 2, 0, 0)
            });
            QuickThoughtRecentList.Children.Add(row);
        }
    }
}
