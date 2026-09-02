using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Data;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public partial class ChatMappingsDocumentView : UserControl, INotifyPropertyChanged
    {
        private BuildTrackerApiClient? _api;
        private List<ChatMappingItem> _allChats = new();
        private ObservableCollection<ChatMappingItem> _filteredChats = new();

        public ObservableCollection<ChatMappingItem> FilteredChats => _filteredChats;

        private ObservableCollection<EpicComboItem> _epicsList = new();
        public ObservableCollection<EpicComboItem> EpicsList => _epicsList;

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

        public ChatMappingsDocumentView()
        {
            InitializeComponent();
            DataContext = this;
            MappingsGrid.ItemsSource = _filteredChats;
        }

        public void Initialize(BuildTrackerApiClient? api)
        {
            _api = api;
            _ = LoadDataAsync();
        }

        private async void BtnReload_Click(object sender, RoutedEventArgs e)
        {
            await LoadDataAsync();
        }

        private async Task LoadDataAsync()
        {
            if (_api == null) return;

            TxtStatus.Text = "Loading...";
            BtnReload.IsEnabled = false;

            try
            {
                // 1. Fetch epics
                var epicsRes = await LocalSqlExecutor.ExecuteAsync(_api, "SELECT id, github_number, title FROM bt_epics ORDER BY title;");
                var epics = new List<EpicComboItem> { new EpicComboItem { Id = null, DisplayName = "(Unlinked / None)" } };
                if (epicsRes != null && epicsRes.Count > 0 && epicsRes[0].Rows != null)
                {
                    foreach (var row in epicsRes[0].Rows)
                    {
                        int id = GetInt(row, "id");
                        int? gh = GetNullableInt(row, "github_number");
                        string title = GetStr(row, "title");
                        string name = gh.HasValue ? $"{gh} — {title}" : title;
                        epics.Add(new EpicComboItem { Id = id, DisplayName = name });
                    }
                }

                _epicsList.Clear();
                foreach (var ep in epics) _epicsList.Add(ep);

                // 2. Fetch chats
                var chatsRes = await LocalSqlExecutor.ExecuteAsync(_api, @"
                    SELECT c.id, c.conversation_id, c.title, c.epic_id, c.category, c.account,
                           (SELECT string_agg(cast(issue_number as text), ', ') FROM bt_chat_issues ci WHERE ci.chat_id = c.id) as associated_issues
                    FROM bt_chats c
                    ORDER BY c.updated_at DESC;");

                _allChats.Clear();
                if (chatsRes != null && chatsRes.Count > 0 && chatsRes[0].Rows != null)
                {
                    foreach (var row in chatsRes[0].Rows)
                    {
                        var item = new ChatMappingItem
                        {
                            Id = GetInt(row, "id"),
                            ConversationId = GetStr(row, "conversation_id"),
                            Title = GetStr(row, "title"),
                            EpicId = GetNullableInt(row, "epic_id"),
                            Category = GetNullableStr(row, "category"),
                            AssociatedIssuesString = GetNullableStr(row, "associated_issues") ?? "",
                            // Git #1480 — a row from before the migration has no account column;
                            // defaults "primary" the same way BoardChat.Account already does.
                            Account = GetNullableStr(row, "account") ?? "primary"
                        };
                        item.LastSavedEpicId = item.EpicId;
                        item.LastSavedTitle = item.Title;
                        item.LastSavedCategory = item.Category;
                        item.LastSavedAssociatedIssuesString = item.AssociatedIssuesString;
                        item.LastSavedAccount = item.Account;
                        // Link the EpicComboItem reference so the editable ComboBox shows the correct display name
                        item.LinkedEpic = _epicsList.FirstOrDefault(ep => ep.Id == item.EpicId);
                        _allChats.Add(item);
                    }
                }

                ApplyFilter();
                TxtStatus.Text = $"Loaded {_allChats.Count} chats successfully.";
            }
            catch (Exception ex)
            {
                TxtStatus.Text = $"Error: {ex.Message}";
                ToastEngine.Error("Chat Mappings", $"Failed to load mappings: {ex.Message}");
            }
            finally
            {
                BtnReload.IsEnabled = true;
            }
        }

        private void ApplyFilter()
        {
            string filter = (TxtFilter.Text ?? "").Trim();
            _filteredChats.Clear();
            foreach (var c in _allChats)
            {
                if (string.IsNullOrEmpty(filter) ||
                    c.Title.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                    c.ConversationId.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                    c.AssociatedIssuesString.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                    (c.Category != null && c.Category.Contains(filter, StringComparison.OrdinalIgnoreCase)))
                {
                    _filteredChats.Add(c);
                }
            }
        }

        private void TxtFilter_TextChanged(object sender, TextChangedEventArgs e)
        {
            ApplyFilter();
        }

        private void BtnOpenClaude_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.DataContext is ChatMappingItem item)
            {
                // Request MainWindow to open this chat
                if (Application.Current.MainWindow is MainWindow mw)
                {
                    // Find or create chat
                    var boardChat = new BoardChat
                    {
                        ConversationId = item.ConversationId,
                        Title = item.Title,
                        EpicId = item.EpicId,
                        ClaudeUrl = item.ClaudeUrl
                    };
                    mw.OpenChatTab(boardChat, null);
                }
            }
        }

        private void EpicComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (sender is ComboBox cb && cb.DataContext is ChatMappingItem item)
            {
                item.EpicId = cb.SelectedValue as int?;
            }
        }

        private async void EpicComboBox_DropDownClosed(object sender, EventArgs e)
        {
            await SaveEpicChangeAsync(sender as ComboBox);
        }

        private async void EpicComboBox_LostFocus(object sender, RoutedEventArgs e)
        {
            await SaveEpicChangeAsync(sender as ComboBox);
        }

        private async Task SaveEpicChangeAsync(ComboBox? cb)
        {
            if (_api == null || cb == null) return;
            if (cb.DataContext is ChatMappingItem item)
            {
                var selected = cb.SelectedItem as EpicComboItem;
                int? newEpicId = selected?.Id;
                if (item.EpicId == newEpicId && item.LastSavedEpicId == newEpicId) return;

                item.EpicId = newEpicId;
                item.LinkedEpic = selected;
                item.LastSavedEpicId = newEpicId;
                TxtStatus.Text = "Saving epic association...";

                try
                {
                    string sqlVal = newEpicId.HasValue ? newEpicId.Value.ToString() : "NULL";
                    await LocalSqlExecutor.ExecuteAsync(_api, $"UPDATE bt_chats SET epic_id = {sqlVal}, updated_at = now() WHERE id = {item.Id}");
                    TxtStatus.Text = "Epic saved.";
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Save failed: {ex.Message}";
                    ToastEngine.Error("Save Epic", $"Failed to update: {ex.Message}");
                }
            }
        }

        private async void TitleTextBox_LostFocus(object sender, RoutedEventArgs e)
        {
            if (_api == null) return;
            if (sender is TextBox tb && tb.DataContext is ChatMappingItem item)
            {
                string text = (tb.Text ?? "").Trim();
                if (item.LastSavedTitle == text) return;
                if (string.IsNullOrEmpty(text)) return; // never save a blanked-out title

                item.Title = text;
                TxtStatus.Text = "Saving title...";

                try
                {
                    await LocalSqlExecutor.ExecuteAsync(_api, $"UPDATE bt_chats SET title = '{text.Replace("'", "''")}', updated_at = now() WHERE id = {item.Id}");
                    item.LastSavedTitle = text;
                    TxtStatus.Text = "Title saved.";
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Save failed: {ex.Message}";
                    ToastEngine.Error("Save Title", $"Failed to update: {ex.Message}");
                }
            }
        }

        private async void AccountComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_api == null) return;
            if (sender is ComboBox cb && cb.DataContext is ChatMappingItem item)
            {
                string account = (cb.SelectedValue as string) ?? "primary";
                item.Account = account;
                if (item.LastSavedAccount == account) return;

                TxtStatus.Text = "Saving account...";
                try
                {
                    await LocalSqlExecutor.ExecuteAsync(_api, $"UPDATE bt_chats SET account = '{account}', updated_at = now() WHERE id = {item.Id}");
                    item.LastSavedAccount = account;
                    TxtStatus.Text = "Account saved.";
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Save failed: {ex.Message}";
                    ToastEngine.Error("Save Account", $"Failed to update: {ex.Message}");
                }
            }
        }

        /// <summary>
        /// Shane: "Just give me a button I can click save next to the filter." Explicit,
        /// unconditional backstop for every field this view lets Shane edit — per-cell
        /// LostFocus saves are the normal path, but a DataGrid row losing keyboard focus
        /// while switching tabs/panes doesn't always fire it reliably. Walks every loaded
        /// chat, compares each editable field to what was last actually written
        /// (LastSaved*), and batches ONE combined SQL statement covering every genuinely
        /// changed field on every row — not just the row currently selected/focused.
        /// </summary>
        private async void BtnSaveAll_Click(object sender, RoutedEventArgs e)
        {
            if (_api == null) return;

            var sql = new StringBuilder();
            var touched = new List<ChatMappingItem>();

            foreach (var item in _allChats)
            {
                bool changed = false;

                if (item.Title != item.LastSavedTitle && !string.IsNullOrWhiteSpace(item.Title))
                {
                    sql.Append($"UPDATE bt_chats SET title = '{item.Title.Trim().Replace("'", "''")}', updated_at = now() WHERE id = {item.Id};");
                    changed = true;
                }
                if (item.Category != item.LastSavedCategory)
                {
                    string val = string.IsNullOrWhiteSpace(item.Category) ? "NULL" : $"'{item.Category!.Trim().Replace("'", "''")}'";
                    sql.Append($"UPDATE bt_chats SET category = {val}, updated_at = now() WHERE id = {item.Id};");
                    changed = true;
                }
                if (item.EpicId != item.LastSavedEpicId)
                {
                    string val = item.EpicId.HasValue ? item.EpicId.Value.ToString() : "NULL";
                    sql.Append($"UPDATE bt_chats SET epic_id = {val}, updated_at = now() WHERE id = {item.Id};");
                    changed = true;
                }
                if (item.Account != item.LastSavedAccount)
                {
                    sql.Append($"UPDATE bt_chats SET account = '{item.Account}', updated_at = now() WHERE id = {item.Id};");
                    changed = true;
                }
                if (item.AssociatedIssuesString != item.LastSavedAssociatedIssuesString)
                {
                    sql.Append($"DELETE FROM bt_chat_issues WHERE chat_id = {item.Id};");
                    var numbers = (item.AssociatedIssuesString ?? "").Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var numStr in numbers)
                    {
                        if (int.TryParse(numStr, out var num))
                            sql.Append($"INSERT INTO bt_chat_issues (chat_id, issue_number, associated_at) VALUES ({item.Id}, {num}, now()) ON CONFLICT DO NOTHING;");
                    }
                    changed = true;
                }

                if (changed) touched.Add(item);
            }

            if (touched.Count == 0)
            {
                TxtStatus.Text = "Nothing to save — no changes since last save.";
                return;
            }

            BtnSaveAll.IsEnabled = false;
            TxtStatus.Text = $"Saving {touched.Count} changed row(s)...";
            try
            {
                await LocalSqlExecutor.ExecuteAsync(_api, sql.ToString());
                foreach (var item in touched)
                {
                    item.LastSavedTitle = item.Title;
                    item.LastSavedCategory = item.Category;
                    item.LastSavedEpicId = item.EpicId;
                    item.LastSavedAccount = item.Account;
                    item.LastSavedAssociatedIssuesString = item.AssociatedIssuesString;
                }
                TxtStatus.Text = $"Saved {touched.Count} changed row(s).";
                ToastEngine.Success("Chat Mappings", $"Saved {touched.Count} changed row(s).");
                if (Application.Current.MainWindow is MainWindow mw)
                {
                    mw.LeftSidebar.PopulateChatsTree();
                }
            }
            catch (Exception ex)
            {
                TxtStatus.Text = $"Save failed: {ex.Message}";
                ToastEngine.Error("Save Changes", $"Failed to save: {ex.Message}");
            }
            finally
            {
                BtnSaveAll.IsEnabled = true;
            }
        }

        private async void IssuesTextBox_LostFocus(object sender, RoutedEventArgs e)
        {
            if (_api == null) return;
            if (sender is TextBox tb && tb.DataContext is ChatMappingItem item)
            {
                string text = (tb.Text ?? "").Trim();
                if (item.AssociatedIssuesString == text) return;

                item.AssociatedIssuesString = text;
                TxtStatus.Text = "Saving associated issues...";

                try
                {
                    var sqlBatch = new StringBuilder();
                    sqlBatch.Append($"DELETE FROM bt_chat_issues WHERE chat_id = {item.Id};");

                    var numbers = text.Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var numStr in numbers)
                    {
                        if (int.TryParse(numStr, out var num))
                        {
                            sqlBatch.Append($"INSERT INTO bt_chat_issues (chat_id, issue_number, associated_at) VALUES ({item.Id}, {num}, now()) ON CONFLICT DO NOTHING;");
                        }
                    }

                    await LocalSqlExecutor.ExecuteAsync(_api, sqlBatch.ToString());
                    item.LastSavedAssociatedIssuesString = text;
                    TxtStatus.Text = "Issues saved.";
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Save failed: {ex.Message}";
                    ToastEngine.Error("Save Issues", $"Failed to update: {ex.Message}");
                }
            }
        }

        private async void CategoryTextBox_LostFocus(object sender, RoutedEventArgs e)
        {
            if (_api == null) return;
            if (sender is TextBox tb && tb.DataContext is ChatMappingItem item)
            {
                string? text = (tb.Text ?? "").Trim();
                if (string.IsNullOrEmpty(text)) text = null;
                if (item.Category == text) return;

                item.Category = text;
                TxtStatus.Text = "Saving category...";

                try
                {
                    string sqlVal = text == null ? "NULL" : $"'{text.Replace("'", "''")}'";
                    await LocalSqlExecutor.ExecuteAsync(_api, $"UPDATE bt_chats SET category = {sqlVal}, updated_at = now() WHERE id = {item.Id}");
                    item.LastSavedCategory = text;
                    TxtStatus.Text = "Category saved.";
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Save failed: {ex.Message}";
                    ToastEngine.Error("Save Category", $"Failed to update: {ex.Message}");
                }
            }
        }

        private async void BtnDeleteChat_Click(object sender, RoutedEventArgs e)
        {
            if (_api == null) return;
            if (sender is Button btn && btn.DataContext is ChatMappingItem item)
            {
                var result = MessageBox.Show(
                    $"Are you sure you want to delete the mapping for chat \"{item.Title}\"?\nThis will remove it from the database entirely.", 
                    "Confirm Delete", 
                    MessageBoxButton.YesNo, 
                    MessageBoxImage.Warning);
                if (result != MessageBoxResult.Yes) return;

                TxtStatus.Text = "Deleting chat mapping...";

                try
                {
                    await LocalSqlExecutor.ExecuteAsync(_api, $"DELETE FROM bt_chat_issues WHERE chat_id = {item.Id}; DELETE FROM bt_chats WHERE id = {item.Id};");
                    _allChats.Remove(item);
                    ApplyFilter();
                    TxtStatus.Text = "Chat mapping deleted successfully.";
                    ToastEngine.Success("Delete Chat", $"Deleted chat \"{item.Title}\".");
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        mw.LeftSidebar.PopulateChatsTree();
                    }
                }
                catch (Exception ex)
                {
                    TxtStatus.Text = $"Delete failed: {ex.Message}";
                    ToastEngine.Error("Delete Chat", $"Failed to delete chat: {ex.Message}");
                }
            }
        }

        // Helpers for json row parsing
        private static int GetInt(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.Number ? val.GetInt32() : 0;
        }

        private static int? GetNullableInt(Dictionary<string, JsonElement> row, string field)
        {
            if (row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.Number) return val.GetInt32();
            return null;
        }

        private static string GetStr(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.String ? val.GetString() ?? "" : "";
        }

        private static string? GetNullableStr(Dictionary<string, JsonElement> row, string field)
        {
            if (row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.String) return val.GetString();
            return null;
        }
    }

    public class ChatMappingItem : INotifyPropertyChanged
    {
        public int Id { get; set; }
        public string ConversationId { get; set; } = string.Empty;

        private string _title = string.Empty;
        public string Title
        {
            get => _title;
            set { _title = value; OnPropertyChanged(nameof(Title)); }
        }
        /// <summary>What's actually in the DB right now — set on load and after every
        /// successful save (individual LostFocus or the bulk Save Changes button), so
        /// each save path can tell a genuinely-changed field from an untouched one.</summary>
        public string LastSavedTitle { get; set; } = string.Empty;

        public int? LastSavedEpicId { get; set; }

        private int? _epicId;
        public int? EpicId
        {
            get => _epicId;
            set { _epicId = value; OnPropertyChanged(nameof(EpicId)); }
        }

        private EpicComboItem? _linkedEpic;
        /// <summary>The full EpicComboItem bound to the editable ComboBox SelectedItem so the display name shows correctly.</summary>
        public EpicComboItem? LinkedEpic
        {
            get => _linkedEpic;
            set { _linkedEpic = value; EpicId = value?.Id; OnPropertyChanged(nameof(LinkedEpic)); }
        }

        private string _associatedIssuesString = string.Empty;
        public string AssociatedIssuesString
        {
            get => _associatedIssuesString;
            set { _associatedIssuesString = value; OnPropertyChanged(nameof(AssociatedIssuesString)); }
        }
        public string LastSavedAssociatedIssuesString { get; set; } = string.Empty;

        private string? _category;
        public string? Category
        {
            get => _category;
            set { _category = value; OnPropertyChanged(nameof(Category)); }
        }
        public string? LastSavedCategory { get; set; }

        /// <summary>Shane, 2026-08-30 — "select which account the link belongs to... Primary
        /// or Secondary." Real bt_chats.account column (Git #1480); defaults "primary" the
        /// same way BoardChat.Account already does for a pre-#1480 row.</summary>
        private string _account = "primary";
        public string Account
        {
            get => _account;
            set { _account = value; OnPropertyChanged(nameof(Account)); }
        }
        public string LastSavedAccount { get; set; } = "primary";

        public string ClaudeUrl => $"https://claude.ai/chat/{ConversationId}";
        public string DisplayUrl => $"claude.ai/chat/{(ConversationId.Length >= 8 ? ConversationId.Substring(0, 8) : ConversationId)}...";

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged(string name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    public class EpicComboItem
    {
        public int? Id { get; set; }
        public string DisplayName { get; set; } = string.Empty;
    }
}
