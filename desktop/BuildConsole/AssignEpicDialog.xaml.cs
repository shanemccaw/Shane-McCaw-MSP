using System.Collections.Generic;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>Git #828 — Shane: "I need a way to assign a chat to an epic in the WPF app." Simple picker; the real assignment call happens in LeftSidebar's context menu handler via BuildTrackerApiClient.LinkChatToEpicAsync.</summary>
    public partial class AssignEpicDialog : Window
    {
        public int? SelectedEpicId { get; private set; }

        public AssignEpicDialog(string chatTitle, List<BoardEpic> epics)
        {
            InitializeComponent();
            TitleText.Text = $"Assign \"{chatTitle}\" to epic:";
            EpicList.ItemsSource = epics;
            EpicList.DisplayMemberPath = "Title";
        }

        private void Assign_Click(object sender, RoutedEventArgs e)
        {
            if (EpicList.SelectedItem is BoardEpic epic)
            {
                SelectedEpicId = epic.Id;
                DialogResult = true;
            }
        }

        private void EpicList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (EpicList.SelectedItem is BoardEpic epic)
            {
                SelectedEpicId = epic.Id;
                DialogResult = true;
            }
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}
