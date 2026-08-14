using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace BuildConsole
{
    /// <summary>
    /// A single notification card shown inside <see cref="ToastHostWindow"/>. Carries its own
    /// auto-dismiss timer (paused while the mouse is over it so Shane can read/hover a longer
    /// message), a soft fade+slide entrance and a fade+collapse exit, and raises
    /// <see cref="Dismissed"/> once it has finished animating out so the host can remove it.
    ///
    /// Purely presentational — no logging (none needed here per the engine's brief).
    /// </summary>
    public partial class ToastCard : UserControl
    {
        /// <summary>Raised (on the UI thread) once this card has fully animated out and should be removed.</summary>
        public event EventHandler? Dismissed;

        private readonly DispatcherTimer _timer;
        private readonly TimeSpan _duration;
        private bool _closing;

        public ToastCard(string title, string message, ToastKind kind, TimeSpan duration)
        {
            InitializeComponent();

            _duration = duration;

            var (accent, glyph) = StyleFor(kind);
            AccentBar.Background = accent;
            IconText.Text = glyph;
            IconText.Foreground = accent;

            bool hasTitle = !string.IsNullOrWhiteSpace(title);
            TitleText.Text = hasTitle ? title : "";
            TitleText.Visibility = hasTitle ? Visibility.Visible : Visibility.Collapsed;
            MessageText.Text = message ?? "";
            MessageText.Visibility = string.IsNullOrWhiteSpace(message) ? Visibility.Collapsed : Visibility.Visible;

            _timer = new DispatcherTimer { Interval = duration };
            _timer.Tick += (_, _) => BeginClose();

            Loaded += OnLoaded;
        }

        // Kind → (accent brush, glyph). Glyphs are plain Unicode already used elsewhere in the app
        // (DeviceCodeWindow uses ✓ / ⚠ / ✕), so they render reliably in Segoe UI Symbol.
        private static (Brush accent, string glyph) StyleFor(ToastKind kind) => kind switch
        {
            ToastKind.Success => (Res("GreenBrush"), "✓"), // ✓
            ToastKind.Warning => (Res("PeachBrush"), "⚠"), // ⚠
            ToastKind.Error   => (Res("RedBrush"),   "✕"), // ✕
            _                 => (Res("BlueBrush"),  "ℹ"), // ℹ
        };

        private static Brush Res(string key)
        {
            try { return (Brush)Application.Current.FindResource(key); }
            catch { return Brushes.SteelBlue; }
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            // Entrance: fade in while sliding down a few px.
            var slide = new TranslateTransform(0, -8);
            CardRoot.RenderTransform = slide;
            slide.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(-8, 0, TimeSpan.FromMilliseconds(180))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            CardRoot.BeginAnimation(OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));

            _timer.Start();
        }

        // Pause the auto-dismiss countdown while hovered; restart it (full duration) on leave.
        protected override void OnMouseEnter(MouseEventArgs e)
        {
            base.OnMouseEnter(e);
            if (!_closing) _timer.Stop();
        }

        protected override void OnMouseLeave(MouseEventArgs e)
        {
            base.OnMouseLeave(e);
            if (!_closing) { _timer.Interval = _duration; _timer.Start(); }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => BeginClose();

        /// <summary>Starts the exit animation; safe to call more than once. Raises <see cref="Dismissed"/> when done.</summary>
        public void BeginClose()
        {
            if (_closing) return;
            _closing = true;
            _timer.Stop();

            // Exit: fade out, then collapse the height so the cards below slide up smoothly.
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
