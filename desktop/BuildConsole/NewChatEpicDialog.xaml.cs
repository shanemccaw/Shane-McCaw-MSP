using System.Windows;
using System.Windows.Input;

namespace BuildConsole
{
    public partial class NewChatEpicDialog : Window
    {
        public int? EpicNumber
        {
            get
            {
                if (int.TryParse(EpicNumberBox.Text.Trim(), out var num)) return num;
                return null;
            }
        }

        public NewChatEpicDialog()
        {
            InitializeComponent();
            Loaded += (s, e) =>
            {
                EpicNumberBox.Focus();
            };
        }

        private void EpicNumberBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                Ok_Click(sender, e);
            }
            else if (e.Key == Key.Escape)
            {
                DialogResult = false;
                Close();
            }
        }

        private void Ok_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(EpicNumberBox.Text) || !int.TryParse(EpicNumberBox.Text.Trim(), out _))
            {
                EpicNumberBox.Focus();
                EpicNumberBox.SelectAll();
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
