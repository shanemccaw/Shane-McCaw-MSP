using System.Windows;
using System.Windows.Input;

namespace BuildConsole
{
    public partial class RenameTabDialog : Window
    {
        public string NewTabName => TabNameBox.Text.Trim();

        public RenameTabDialog(string currentName)
        {
            InitializeComponent();
            TabNameBox.Text = currentName ?? "";
            Loaded += (s, e) =>
            {
                TabNameBox.Focus();
                TabNameBox.SelectAll();
            };
        }

        private void TabNameBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                Save_Click(sender, e);
            }
            else if (e.Key == Key.Escape)
            {
                DialogResult = false;
                Close();
            }
        }

        private void Save_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(TabNameBox.Text))
            {
                TabNameBox.Focus();
                return;
            }
            DialogResult = true;
            Close();
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }
    }
}
