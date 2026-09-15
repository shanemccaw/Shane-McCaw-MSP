using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace BuildConsole
{
    /// <summary>
    /// Git #4198 — Ctrl+Shift+W native WPF element picker. Mirrors
    /// TestModeDiagnosticsPanel's WebView2 DOM inspector hover-highlight-and-click
    /// pattern (see its BugSubmittedFromDomInspector handler in MainWindow.TestMode.cs),
    /// applied to BuildConsole's own visual tree via VisualTreeHelper.HitTest instead
    /// of a DOM. v1 scope is the active Window only (see issue #4198's "Real scope").
    /// </summary>
    public partial class MainWindow
    {
        private bool _isElementPickerMode;

        /// <summary>Toggle native-UI Element Picker mode on or off (Ctrl+Shift+W).</summary>
        public void ToggleElementPickerMode()
        {
            if (_isElementPickerMode)
                ExitElementPickerMode(showToast: false);
            else
                EnterElementPickerMode();
        }

        private void MenuToggleElementPicker_Click(object sender, RoutedEventArgs e) => ToggleElementPickerMode();

        private void EnterElementPickerMode()
        {
            _isElementPickerMode = true;
            Cursor = Cursors.Cross;
            ToastEngine.Info("Element Picker", "Hover to highlight, click to copy an identifier. Esc to cancel. (Ctrl+Shift+W)");
        }

        private void ExitElementPickerMode(bool showToast)
        {
            _isElementPickerMode = false;
            Cursor = Cursors.Arrow;
            ElementPickerLayer.HideHighlight();
            if (showToast)
                ToastEngine.Warning("Element Picker", "Cancelled — nothing copied.");
        }

        private void Window_PreviewMouseMove(object sender, MouseEventArgs e)
        {
            if (!_isElementPickerMode) return;

            var target = HitTestElement(e.GetPosition(this));
            if (target == null)
            {
                ElementPickerLayer.HideHighlight();
                return;
            }

            Point topLeft = target.TranslatePoint(new Point(0, 0), this);
            var bounds = new Rect(topLeft, new Size(target.ActualWidth, target.ActualHeight));
            ElementPickerLayer.ShowHighlight(bounds, GetElementIdentifier(target));
        }

        private void Window_PreviewMouseLeftButtonDown_ElementPicker(object sender, MouseButtonEventArgs e)
        {
            if (!_isElementPickerMode) return;

            // Swallow the real click — this press is picking an element, not interacting
            // with whatever is underneath it.
            e.Handled = true;

            var target = HitTestElement(e.GetPosition(this));
            if (target == null)
            {
                ExitElementPickerMode(showToast: true);
                return;
            }

            string identifier = GetElementIdentifier(target);
            Clipboard.SetText(identifier);
            ToastEngine.Success("Element Picker", $"Copied \"{identifier}\" to clipboard.");
            ExitElementPickerMode(showToast: false);
        }

        /// <summary>
        /// Hit-tests the real WPF visual tree at <paramref name="point"/> (Window-relative)
        /// and walks up to the nearest FrameworkElement — VisualTreeHelper.HitTest can land
        /// on a bare Visual/drawing primitive (a Glyphs run, a Path fill) with no Name or
        /// ActualWidth of its own to report.
        /// </summary>
        private FrameworkElement? HitTestElement(Point point)
        {
            DependencyObject? node = VisualTreeHelper.HitTest(this, point)?.VisualHit;
            while (node != null && node is not FrameworkElement)
                node = VisualTreeHelper.GetParent(node);
            return node as FrameworkElement;
        }

        /// <summary>
        /// Same "TypeName [x:Name]" convention as WpfTesterWindow's BuildTreeItem/InspectElement
        /// (Git #3914). When the element has no x:Name, falls back to a short ancestor-path
        /// (e.g. "Grid > StackPanel > TextBlock") so an unnamed element is still identifiable
        /// rather than reporting a bare, contextless type name.
        /// </summary>
        private static string GetElementIdentifier(DependencyObject node)
        {
            string typeName = node.GetType().Name;
            if (node is FrameworkElement named && !string.IsNullOrEmpty(named.Name))
                return $"{typeName} [{named.Name}]";

            var chain = new List<string> { typeName };
            DependencyObject? parent = VisualTreeHelper.GetParent(node);
            while (parent != null && chain.Count < 4)
            {
                chain.Insert(0, parent.GetType().Name);
                if (parent is FrameworkElement namedParent && !string.IsNullOrEmpty(namedParent.Name))
                    break;
                parent = VisualTreeHelper.GetParent(parent);
            }
            return string.Join(" > ", chain);
        }
    }
}
