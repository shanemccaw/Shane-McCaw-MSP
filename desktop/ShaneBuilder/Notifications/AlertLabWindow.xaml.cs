using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2201 — readme-phase2.md Step 11's QA harness: fire any of the 5 seeded alert kinds or 9
    /// party events on demand, plus the last 6 real/synthetic alerts from AlertCenter's history.
    /// Positioned under the bell button by the caller (MainWindow), like a lightweight popup.
    /// </summary>
    public partial class AlertLabWindow : Window
    {
        private int _fireCounter;

        public AlertLabWindow()
        {
            InitializeComponent();
            BuildAlertButtons();
            BuildPartyButtons();
            RenderHistory();
            AlertCenter.AlertsChanged += OnAlertsChanged;
            Closed += (_, _) => AlertCenter.AlertsChanged -= OnAlertsChanged;
        }

        private void OnAlertsChanged() => Dispatcher.BeginInvoke(new Action(RenderHistory));

        private void BuildAlertButtons()
        {
            foreach (var kv in AlertCatalog.Seeds)
            {
                var seed = kv.Value;
                AlertsPanel.Children.Add(MakeRow(seed.Title, seed.ToneRgb, () => FireSeededAlert(seed)));
            }
        }

        private void BuildPartyButtons()
        {
            foreach (var evt in AlertCatalog.PartyEvents)
            {
                var tone = evt.Mood == Mood.Evil ? "226,89,63" : "127,176,138";
                PartiesPanel.Children.Add(MakeRow($"{evt.Label}  ·  T{evt.Tier}", tone, () => FireParty(evt)));
            }
        }

        private Border MakeRow(string label, string toneRgb, Action onClick)
        {
            var dot = new Border
            {
                Width = 6, Height = 6, CornerRadius = new CornerRadius(99), Margin = new Thickness(0, 0, 8, 0),
                Background = ToneBrush(toneRgb), VerticalAlignment = VerticalAlignment.Center,
            };
            var text = new TextBlock
            {
                Text = label, FontSize = 11, FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("Brush.Text.Primary"), VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            var stack = new StackPanel { Orientation = Orientation.Horizontal };
            stack.Children.Add(dot);
            stack.Children.Add(text);

            var row = new Border
            {
                Padding = new Thickness(7, 6, 7, 6), CornerRadius = new CornerRadius(6),
                Cursor = Cursors.Hand, Child = stack, Background = Brushes.Transparent,
            };
            row.MouseEnter += (_, _) => row.Background = (Brush)FindResource("Brush.Bg.Chip");
            row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
            row.MouseLeftButtonUp += (_, _) => { onClick(); Hide(); };
            return row;
        }

        private static Brush ToneBrush(string rgb)
        {
            var parts = rgb.Split(',').Select(byte.Parse).ToArray();
            return new SolidColorBrush(Color.FromRgb(parts[0], parts[1], parts[2]));
        }

        private void FireSeededAlert(AlertSeed seed)
        {
            _fireCounter++;
            var id = $"lab-{_fireCounter}-{DateTime.Now.Ticks}";

            AlertAction? primary = null;
            AlertAction? secondary = null;
            Func<string, Task>? onReply = null;

            switch (seed.Kind)
            {
                case AlertKind.Crash:
                    primary = new AlertAction("Open the error in the Log Viewer", () =>
                    { AlertActions.OpenLogAt?.Invoke("api", new[] { LogLevel.Error, LogLevel.Fatal }, ""); return Task.CompletedTask; });
                    secondary = new AlertAction("Restart API Server", () => Task.CompletedTask);
                    break;
                case AlertKind.BuildFailed:
                    primary = new AlertAction("Open the build log at the failure", () =>
                    { AlertActions.OpenLogAt?.Invoke("build", new[] { LogLevel.Error, LogLevel.Fatal }, "MSB"); return Task.CompletedTask; });
                    secondary = new AlertAction("Requeue the build", () => Task.CompletedTask);
                    break;
                case AlertKind.ClaudeWaiting:
                    secondary = new AlertAction("Open the chat", () => Task.CompletedTask);
                    onReply = text => { AlertActions.AppendToComposer?.Invoke(text); return Task.CompletedTask; };
                    break;
                case AlertKind.IssueBlocked:
                    primary = new AlertAction("Open in the Git panel", () =>
                    { AlertActions.OpenIssueInGitPanel?.Invoke(0); return Task.CompletedTask; });
                    secondary = new AlertAction("Show the blocker", () => Task.CompletedTask);
                    break;
                case AlertKind.WorktreeDirty:
                    primary = new AlertAction("Fix Git", () => { AlertActions.OpenGitDoctor?.Invoke(); return Task.CompletedTask; });
                    secondary = new AlertAction("Show git status", () => Task.CompletedTask);
                    break;
            }

            var alert = AlertWatchers.BuildFromSeed(id, seed, seed.MetaTemplate, seed.EvidenceTemplate, primary, secondary, onReply);
            AlertCenter.PublishAlert(alert);
        }

        private void FireParty(PartyEventDef evt)
        {
            AlertCenter.Celebrate(new Celebration(evt.Id, evt.Tier, evt.Mood, evt.Shape, evt.Text) { Label = evt.Label });
        }

        private void RenderHistory()
        {
            HistoryPanel.Children.Clear();
            var history = AlertCenter.History.Take(6).ToList();
            HistoryEmptyText.Visibility = history.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            foreach (var a in history)
            {
                var dot = new Border
                {
                    Width = 5, Height = 5, CornerRadius = new CornerRadius(99), Margin = new Thickness(0, 0, 7, 0),
                    Background = ToneBrush(AlertCatalog.ToneRgb(a.Kind)), VerticalAlignment = VerticalAlignment.Center,
                };
                var title = new TextBlock
                {
                    Text = a.Title, FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Muted"),
                    TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center,
                    Width = 190,
                };
                var at = new TextBlock
                {
                    Text = a.At.ToString("HH:mm"), FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim"),
                    HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center,
                };
                var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 2, 6, 2) };
                row.Children.Add(dot);
                row.Children.Add(title);
                row.Children.Add(at);
                HistoryPanel.Children.Add(row);
            }
        }

        public void ShowNear(Point screenTopLeft)
        {
            Left = screenTopLeft.X;
            Top = screenTopLeft.Y;
            RenderHistory();
            Show();
            Activate();
        }

        private void Window_Deactivated(object sender, EventArgs e) => Hide();
    }
}
