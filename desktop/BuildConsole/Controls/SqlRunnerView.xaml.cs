using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    public partial class SqlRunnerView : UserControl
    {
        public SqlRunnerView() => InitializeComponent();

        public void SetSqlQuery(string sql)
        {
            QueryEditor.Text = sql;
        }

        private void Connect_Click(object sender, RoutedEventArgs e)
        {
            // UI-only toggle — real connection wired later
            ConnDot.Fill    = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1));
            ConnStatus.Text = "Connected (mock)";
            ExecStatus.Text = "Connected — ready";
        }

        private void Execute_Click(object sender, RoutedEventArgs e)
        {
            // UI-only: show placeholder in status
            ExecStatus.Text    = "Query executed (mock) — backend wiring pending";
            RowCountLabel.Text = "0 rows";
        }
    }
}
