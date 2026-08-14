using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Pause-on-unset prompt floaty (Epic #803, extends #953/#961). When a manifest step is about to
    /// resolve a <c>{{NAME}}</c> whose stored Test Environment Variable is still <c>&lt;unset&gt;</c>/
    /// needsReview, <see cref="TestRunVariables.PrepareAsync"/> pauses the run and awaits this window
    /// (via the <see cref="TestRunVariables.OnMissingVariable"/> bridge) for the real value. Same
    /// always-on-top, non-blocking shape as <see cref="DeviceCodeWindow"/> / the #937 Sticky Notes /
    /// #973 LinkedIn floaties — never a modal, so the rest of the app stays live while it's up.
    ///
    /// <see cref="Result"/> completes with the entered value when Shane clicks Save &amp; Continue (or
    /// presses Enter), or with <c>null</c> when he dismisses it (Dismiss / Esc / close) — the caller
    /// turns <c>null</c> into a clear per-step failure naming the variable, never a hang.
    /// </summary>
    public partial class MissingVariableWindow : Window
    {
        private readonly TaskCompletionSource<string?> _tcs =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private bool _completed;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        /// <summary>Completes with the real value Shane entered, or <c>null</c> if he dismissed the prompt.</summary>
        public Task<string?> Result => _tcs.Task;

        public MissingVariableWindow(TestRunVariables.MissingVariablePrompt prompt)
        {
            InitializeComponent();

            string name = prompt?.Name ?? "";
            NameText.Text = "{{" + name + "}}";

            // Park near the top-right of the primary work area so it doesn't sit over the editor.
            WindowStartupLocation = WindowStartupLocation.Manual;
            Loaded += (_, _) =>
            {
                try
                {
                    var wa = SystemParameters.WorkArea;
                    Left = wa.Right - ActualWidth - 24;
                    Top = wa.Top + 24;
                }
                catch { WindowStartupLocation = WindowStartupLocation.CenterScreen; }
                ForceTopmost();
                try { ValueBox.Focus(); Keyboard.Focus(ValueBox); } catch { /* best-effort */ }
            };

            // Same reason as DeviceCodeWindow: Topmost="True" alone doesn't reliably stick against the
            // maximized Test Runner window (a separate top-level, un-owned here). Re-assert HWND_TOPMOST
            // on every deactivation without stealing focus (SWP_NOACTIVATE).
            Deactivated += (_, _) => ForceTopmost();
        }

        private void ForceTopmost()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero)
                    SetWindowPos(hwnd, HwndTopmost, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
            }
            catch { /* best-effort */ }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void ValueBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) { e.Handled = true; TrySubmit(); }
            else if (e.Key == Key.Escape) { e.Handled = true; Close(); }
        }

        private void BtnSubmit_Click(object sender, RoutedEventArgs e) => TrySubmit();

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void TrySubmit()
        {
            string value = ValueBox.Text ?? "";
            if (string.IsNullOrWhiteSpace(value)
                || string.Equals(value.Trim(), TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal))
            {
                // Don't accept an empty value or the literal <unset> placeholder — that's not a real value.
                HintText.Foreground = (Brush)FindResource("RedBrush");
                HintText.Text = "Enter a real value (not blank or \"" + TestManifestVariableScanner.AutoDefaultValue + "\"), or press Dismiss to fail this step.";
                try { ValueBox.Focus(); } catch { }
                return;
            }
            Complete(value);
            Close();
        }

        /// <summary>A close by any path (Dismiss, Esc, the window X, or Alt+F4) that hasn't already
        /// submitted resolves the wait as a dismissal (null) — so the awaiting run never hangs.</summary>
        protected override void OnClosed(EventArgs e)
        {
            Complete(null);
            base.OnClosed(e);
        }

        private void Complete(string? value)
        {
            if (_completed) return;
            _completed = true;
            _tcs.TrySetResult(value);
        }
    }
}
