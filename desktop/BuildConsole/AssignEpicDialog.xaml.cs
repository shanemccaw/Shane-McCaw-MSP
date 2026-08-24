using System.Collections.Generic;
using System.Windows;

namespace BuildConsole
{
    public class LinkCandidate
    {
        public int Number { get; set; }
        public string Title { get; set; } = "";
        public string DisplayText => $"#{Number} — {Title}";
    }

    /// <summary>Generalized picker dialog to assign/link a chat to any epic, issue, or milestone.</summary>
    public partial class AssignEpicDialog : Window
    {
        public int? SelectedEpicId { get; private set; }

        public AssignEpicDialog(string chatTitle, List<LinkCandidate> candidates, string labelType = "issue/epic/milestone")
        {
            InitializeComponent();
            TitleText.Text = $"Link \"{chatTitle}\" to {labelType}:";
            EpicList.ItemsSource = candidates;
            EpicList.DisplayMemberPath = "DisplayText";
        }

        private void Assign_Click(object sender, RoutedEventArgs e)
        {
            if (EpicList.SelectedItem is LinkCandidate candidate)
            {
                SelectedEpicId = candidate.Number;
                DialogResult = true;
            }
        }

        private void EpicList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (EpicList.SelectedItem is LinkCandidate candidate)
            {
                SelectedEpicId = candidate.Number;
                DialogResult = true;
            }
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}
