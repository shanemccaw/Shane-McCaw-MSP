using System;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Code-behind for the non-modal element-picker highlight overlay (Git #4198).
    /// Purely presentational — MainWindow.ElementPicker.cs owns the hit-testing,
    /// hotkey, and clipboard logic and just calls ShowHighlight/HideHighlight here.
    /// </summary>
    public partial class ElementPickerLayer : UserControl
    {
        public ElementPickerLayer()
        {
            InitializeComponent();
        }

        public void ShowHighlight(Rect bounds, string label)
        {
            Canvas.SetLeft(HighlightBorder, bounds.X);
            Canvas.SetTop(HighlightBorder, bounds.Y);
            HighlightBorder.Width = Math.Max(0, bounds.Width);
            HighlightBorder.Height = Math.Max(0, bounds.Height);
            HighlightBorder.Visibility = Visibility.Visible;

            LabelText.Text = label;
            // Prefer sitting just above the highlighted element; drop below it instead
            // when there's no room above (element is flush with the window top).
            double labelTop = bounds.Y - 22 >= 0 ? bounds.Y - 22 : bounds.Y + bounds.Height + 2;
            Canvas.SetLeft(LabelBackground, Math.Max(0, bounds.X));
            Canvas.SetTop(LabelBackground, labelTop);
            LabelBackground.Visibility = Visibility.Visible;
        }

        public void HideHighlight()
        {
            HighlightBorder.Visibility = Visibility.Collapsed;
            LabelBackground.Visibility = Visibility.Collapsed;
        }
    }
}
