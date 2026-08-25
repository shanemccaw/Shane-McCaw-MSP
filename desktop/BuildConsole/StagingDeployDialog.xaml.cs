using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// The deliberate, manual confirmation for a "Deploy to Staging" action. It is intentionally a
    /// modal, click-through gate (Staging is a real, human-only deploy target, not something an agent
    /// or a timer ever triggers) and doubles as the one place Shane can hand pending schema migration
    /// SQL into the deploy — that SQL goes through #911's existing hard-filtered, transactional
    /// apply mechanism, never a raw ad-hoc query. Shows the real SSH host and Staging URL it will act
    /// against so there's no ambiguity about the target.
    /// </summary>
    public partial class StagingDeployDialog : Window
    {
        /// <summary>The pending migration SQL Shane entered, trimmed; null when blank (a code-only deploy).</summary>
        public string? SchemaSql { get; private set; }

        public StagingDeployDialog()
        {
            InitializeComponent();

            var settings = BuildConsoleSettings.Load();
            var stagingUrl = BuildTrackerConfig.Load().GetBaseUrl(TargetEnvironment.Staging);

            SshHostText.Text = string.IsNullOrWhiteSpace(settings.SshHost)
                ? "(SSH not configured — the server-side git pull will be used)"
                : (string.IsNullOrWhiteSpace(settings.SshUser) ? settings.SshHost : $"{settings.SshUser}@{settings.SshHost}");
            StagingUrlText.Text = string.IsNullOrWhiteSpace(stagingUrl) ? "(not configured)" : stagingUrl;

            SchemaSqlBox.Focus();
        }

        private void BtnDeploy_Click(object sender, RoutedEventArgs e)
        {
            var sql = SchemaSqlBox.Text?.Trim();
            SchemaSql = string.IsNullOrWhiteSpace(sql) ? null : sql;
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
