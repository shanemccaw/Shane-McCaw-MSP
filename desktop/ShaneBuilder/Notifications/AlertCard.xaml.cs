using System;
using System.Globalization;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2201 — readme-phase2.md Step 11, Channel 1. One live <see cref="Alert"/> rendered in the
    /// bottom-right stack. Entrance/exit animation mirrors ToastCard's own (fade+slide in, fade+collapse
    /// out) — the mockup's own <c>omCardIn</c> keyframe is the same shape (opacity 0→1, translateX
    /// 26px→0), ported here as a WPF Storyboard rather than a CSS keyframe.
    /// </summary>
    public partial class AlertCard : UserControl
    {
        public event EventHandler? Dismissed;

        public Alert Model { get; }
        private bool _closing;

        public AlertCard(Alert alert)
        {
            InitializeComponent();
            Model = alert;

            var accent = ToneBrush(AlertCatalog.ToneRgb(alert.Kind));
            SeverityRail.Background = accent;
            IconText.Foreground = accent;
            IconText.Text = GlyphFor(alert.Kind);

            TitleText.Text = alert.Title;
            MetaText.Text = alert.Meta;
            EvidenceText.Text = alert.Evidence;
            EvidenceText.FontFamily = alert.Kind == AlertKind.ClaudeWaiting
                ? (FontFamily)FindResource("FontFamily.Sans")
                : (FontFamily)FindResource("FontFamily.Monospace");

            if (alert.WantsReply)
            {
                ReplyPanel.Visibility = Visibility.Visible;
                ActionsPanel.Visibility = alert.Secondary != null ? Visibility.Visible : Visibility.Collapsed;
                BtnPrimary.Visibility = Visibility.Collapsed;
            }
            else
            {
                ReplyPanel.Visibility = Visibility.Collapsed;
            }

            if (alert.Primary != null && !alert.WantsReply)
            {
                BtnPrimary.Content = alert.Primary.Label;
                BtnPrimary.Background = accent;
                BtnPrimary.Foreground = Brushes.Black;
                BtnPrimary.Visibility = Visibility.Visible;
            }
            else
            {
                BtnPrimary.Visibility = Visibility.Collapsed;
            }

            if (alert.Secondary != null)
            {
                BtnSecondary.Content = alert.Secondary.Label;
                BtnSecondary.Visibility = Visibility.Visible;
            }
            else
            {
                BtnSecondary.Visibility = Visibility.Collapsed;
            }

            Loaded += (_, _) => AnimateIn();
        }

        private static string GlyphFor(AlertKind kind) => kind switch
        {
            AlertKind.Crash => "⚠",
            AlertKind.BuildFailed => "⚠",
            AlertKind.ClaudeWaiting => "💬",
            AlertKind.IssueBlocked => "⊘",
            AlertKind.WorktreeDirty => "⌥",
            _ => "⚠",
        };

        private static Brush ToneBrush(string rgb)
        {
            var parts = rgb.Split(',');
            if (parts.Length == 3
                && byte.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var r)
                && byte.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var g)
                && byte.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var b))
                return new SolidColorBrush(Color.FromRgb(r, g, b));
            return Brushes.SteelBlue;
        }

        private void AnimateIn()
        {
            EnterTransform.BeginAnimation(TranslateTransform.XProperty,
                new DoubleAnimation(26, 0, TimeSpan.FromMilliseconds(220)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
            CardRoot.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220)));
        }

        private async void BtnPrimary_Click(object sender, RoutedEventArgs e)
        {
            if (Model.Primary != null)
            {
                try { await Model.Primary.Invoke(); } catch { /* an action must never crash the card */ }
            }
            BeginClose();
        }

        private async void BtnSecondary_Click(object sender, RoutedEventArgs e)
        {
            if (Model.Secondary != null)
            {
                try { await Model.Secondary.Invoke(); } catch { }
            }
            // Secondary actions (e.g. "Show the blocker") are informational — they don't dismiss
            // the card, matching the mockup's onSecondary (only onPrimary/onDismiss remove the alert).
        }

        private async void BtnSendReply_Click(object sender, RoutedEventArgs e) => await SendReplyAsync();

        private async void ReplyBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) await SendReplyAsync();
        }

        private async Task SendReplyAsync()
        {
            var text = ReplyBox.Text?.Trim();
            if (string.IsNullOrEmpty(text) || Model.OnReply == null) return;
            try { await Model.OnReply(text); } catch { }
            BeginClose();
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => BeginClose();

        public void BeginClose()
        {
            if (_closing) return;
            _closing = true;

            var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(160));
            fade.Completed += (_, _) => Dismissed?.Invoke(this, EventArgs.Empty);
            CardRoot.BeginAnimation(OpacityProperty, fade);

            double h = CardRoot.ActualHeight;
            if (h > 0)
            {
                CardRoot.Height = h;
                CardRoot.BeginAnimation(HeightProperty,
                    new DoubleAnimation(h, 0, TimeSpan.FromMilliseconds(180))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(60),
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
                    });
            }
        }
    }
}
