using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace ShaneBuilder
{
    /// <summary>
    /// A single notification card shown inside <see cref="ToastHostWindow"/>. Carries its own
    /// auto-dismiss timer (paused while the mouse is over it so a longer message can be read/hovered),
    /// a soft fade+slide entrance and a fade+collapse exit, and raises <see cref="Dismissed"/> once it
    /// has finished animating out so the host can remove it.
    ///
    /// Purely presentational — no logging (none needed here per the engine's brief).
    /// </summary>
    public partial class ToastCard : UserControl
    {
        /// <summary>Raised (on the UI thread) once this card has fully animated out and should be removed.</summary>
        public event EventHandler? Dismissed;

        private readonly DispatcherTimer _timer;
        private readonly TimeSpan _duration;
        private readonly Action? _onClick;
        private readonly bool _persistent;
        private bool _closing;

        /// <param name="persistent">When true, this card never auto-dismisses: the countdown timer is
        /// never started at all (not "started with a very long duration"), so the only way it closes
        /// is the ✕ button (or an <paramref name="onClick"/> that dismisses itself). Foundation for
        /// #2026's persistent actionable notifications.</param>
        public ToastCard(string title, string message, ToastKind kind, TimeSpan duration, Action? onClick = null, bool persistent = false)
        {
            InitializeComponent();

            _duration = duration;
            _onClick = onClick;
            _persistent = persistent;

            // A card with a click action becomes a click target: hand cursor + a body-click handler
            // (the ✕ close button keeps its own handler; a click on it is excluded below). Foundation
            // for #2159's click-to-jump chat-response notification.
            if (_onClick != null)
            {
                CardRoot.Cursor = System.Windows.Input.Cursors.Hand;
                CardRoot.MouseLeftButtonUp += CardRoot_MouseLeftButtonUp;
            }

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

        // Kind → (accent brush, glyph). Glyphs are plain Unicode so they render reliably in Segoe UI
        // Symbol. Colours come from the #2147 token dictionary's Toast.* aliases (Themes/Colors.xaml).
        private static (Brush accent, string glyph) StyleFor(ToastKind kind) => kind switch
        {
            ToastKind.Success => (Res("Brush.Toast.Success"), "✓"), // ✓
            ToastKind.Warning => (Res("Brush.Toast.Warning"), "⚠"), // ⚠
            ToastKind.Error   => (Res("Brush.Toast.Error"),   "✕"), // ✕
            _                 => (Res("Brush.Toast.Info"),    "ℹ"), // ℹ
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

            if (!_persistent) _timer.Start();
        }

        // Pause the auto-dismiss countdown while hovered; restart it (full duration) on leave.
        // A persistent card's timer is never started in the first place (see OnLoaded), so these
        // must no-op for it too — otherwise hovering then leaving would start a countdown that
        // was never supposed to run at all.
        protected override void OnMouseEnter(MouseEventArgs e)
        {
            base.OnMouseEnter(e);
            if (!_closing && !_persistent) _timer.Stop();
        }

        protected override void OnMouseLeave(MouseEventArgs e)
        {
            base.OnMouseLeave(e);
            if (!_closing && !_persistent) { _timer.Interval = _duration; _timer.Start(); }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => BeginClose();

        // Body click (only wired when an onClick was supplied). Ignore clicks that originate on the ✕
        // close button (it has its own handler) so a dismiss-click doesn't also fire the action; then
        // invoke the action and animate the toast out.
        private void CardRoot_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (_closing || _onClick == null) return;
            if (IsWithinCloseButton(e.OriginalSource as DependencyObject)) return;

            try { _onClick(); }
            catch { /* a click handler must never crash the toast */ }
            BeginClose();
        }

        private bool IsWithinCloseButton(DependencyObject? source)
        {
            while (source != null)
            {
                if (ReferenceEquals(source, BtnClose)) return true;
                source = source is Visual || source is System.Windows.Media.Media3D.Visual3D
                    ? VisualTreeHelper.GetParent(source)
                    : LogicalTreeHelper.GetParent(source);
            }
            return false;
        }

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
