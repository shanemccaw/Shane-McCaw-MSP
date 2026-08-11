using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace BuildConsole.Controls
{
    public partial class TerminalView : UserControl
    {
        public TerminalView() => InitializeComponent();

        /// <summary>Set the command input text (called from MainWindow menu actions).</summary>
        public void SetCommand(string command)
        {
            InputBox.Text = command;
            InputBox.CaretIndex = InputBox.Text.Length;
            InputBox.Focus();
        }

        // Quick-command chip → paste command into input field
        private void Chip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn)
            {
                InputBox.Text = btn.Tag?.ToString() ?? string.Empty;
                InputBox.CaretIndex = InputBox.Text.Length;
                InputBox.Focus();
            }
        }

        // Enter key in input box → append to output (UI-only, no real shell)
        private void InputBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return)
            {
                Send_Click(sender, e);
                e.Handled = true;
            }
        }

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            var cmd = InputBox.Text.Trim();
            if (string.IsNullOrEmpty(cmd)) return;

            // Append command to the output display (UI-only mock)
            OutputBox.AppendText($"\n> {cmd}\n[not connected — backend wiring pending]\n");
            OutputBox.ScrollToEnd();
            InputBox.Clear();
        }
    }
}
