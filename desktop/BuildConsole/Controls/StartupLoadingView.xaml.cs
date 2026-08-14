using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// The animated startup loading screen (see the XAML header). It renders the
    /// running-character animation plus an HONEST, live list of the real startup
    /// connections it's waiting on — one row per <see cref="StartupConnectionStatus"/>,
    /// each row's dot/detail/timing updated as that connection settles. MainWindow
    /// owns the <see cref="StartupConnectivityService"/>; this view is purely the
    /// presentation and calls back via <see cref="DismissRequested"/> once its
    /// fade-out completes so MainWindow can drop it from the visual tree.
    /// </summary>
    public partial class StartupLoadingView : UserControl
    {
        // Catppuccin Mocha, frozen once — same palette as Themes/DarkTheme.xaml.
        private static readonly SolidColorBrush Grey   = Frozen(0x58, 0x5B, 0x70); // Surface2
        private static readonly SolidColorBrush Peach  = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush Green  = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush Yellow = Frozen(0xF9, 0xE2, 0xAF);
        private static readonly SolidColorBrush Red    = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush Text   = Frozen(0xCD, 0xD6, 0xF4);
        private static readonly SolidColorBrush Subtext = Frozen(0xA6, 0xAD, 0xC8); // Subtext1

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var br = new SolidColorBrush(Color.FromRgb(r, g, b));
            br.Freeze();
            return br;
        }

        private sealed class Row
        {
            public Ellipse Dot = null!;
            public TextBlock Label = null!;
            public TextBlock Detail = null!;
            public TextBlock Elapsed = null!;
            public Storyboard? Pulse;
        }

        private readonly Dictionary<string, Row> _rows = new();
        private DispatcherTimer? _phraseTimer;
        private int _phraseIndex;
        private bool _dismissed;

        // Same playful register as BuildWatch's #1004 easter-egg phrases.
        private static readonly string[] Phrases =
        {
            "Warming up the flux capacitor…",
            "Reticulating splines…",
            "Herding llamas…",
            "Teaching the hamsters to run…",
            "Untangling the git history…",
            "Polishing the pixels…",
            "Waking the dev server…",
            "Counting the deploys…",
            "Bribing the rate limiter…",
        };

        private readonly Random _rng = new();

        /// <summary>Raised once the fade-out has fully completed — MainWindow removes/collapses the overlay.</summary>
        public event Action? DismissRequested;

        public StartupLoadingView()
        {
            InitializeComponent();
            Loaded += (_, _) => StartPhraseTimer();
        }

        /// <summary>Builds one row per connection. Call on the UI thread before probes report in (order preserved).</summary>
        public void Initialize(IReadOnlyList<StartupConnectionStatus> connections)
        {
            ConnectionList.Children.Clear();
            _rows.Clear();

            foreach (var c in connections)
            {
                var grid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(18) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(126) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var dot = new Ellipse
                {
                    Width = 9,
                    Height = 9,
                    Fill = Grey,
                    VerticalAlignment = VerticalAlignment.Center
                };
                Grid.SetColumn(dot, 0);

                var label = new TextBlock
                {
                    Text = c.Label,
                    Foreground = Text,
                    FontSize = 12,
                    VerticalAlignment = VerticalAlignment.Center
                };
                Grid.SetColumn(label, 1);

                var detail = new TextBlock
                {
                    Text = "waiting…",
                    Foreground = Subtext,
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(4, 0, 8, 0)
                };
                Grid.SetColumn(detail, 2);

                var elapsed = new TextBlock
                {
                    Text = "",
                    Foreground = Subtext,
                    FontSize = 10,
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Right
                };
                Grid.SetColumn(elapsed, 3);

                grid.Children.Add(dot);
                grid.Children.Add(label);
                grid.Children.Add(detail);
                grid.Children.Add(elapsed);
                ConnectionList.Children.Add(grid);

                _rows[c.Key] = new Row { Dot = dot, Label = label, Detail = detail, Elapsed = elapsed };
            }
        }

        /// <summary>Repaints a single connection row for its current state. Safe to call from any thread — marshals onto the UI thread.</summary>
        public void UpdateConnection(StartupConnectionStatus c)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => UpdateConnection(c)));
                return;
            }
            if (!_rows.TryGetValue(c.Key, out var row)) return;

            var (brush, pulse, muted) = c.State switch
            {
                StartupConnectionState.Pending    => (Grey, false, false),
                StartupConnectionState.Connecting => (Peach, true, false),
                StartupConnectionState.Success    => (Green, false, false),
                StartupConnectionState.Degraded   => (Yellow, false, false),
                StartupConnectionState.Failed     => (Red, false, false),
                StartupConnectionState.TimedOut   => (Red, false, false),
                StartupConnectionState.Skipped    => (Grey, false, true),
                _                                  => (Grey, false, false),
            };

            row.Dot.Fill = brush;
            row.Label.Opacity = muted ? 0.5 : 1.0;

            if (pulse)
                StartPulse(row);
            else
                StopPulse(row);

            row.Detail.Text = string.IsNullOrEmpty(c.Detail)
                ? StateWord(c.State)
                : c.Detail;

            row.Elapsed.Text = c.Elapsed.HasValue && c.State != StartupConnectionState.Skipped
                ? FormatElapsed(c.Elapsed.Value)
                : "";
        }

        private static string StateWord(StartupConnectionState s) => s switch
        {
            StartupConnectionState.Connecting => "connecting…",
            StartupConnectionState.Success    => "ok",
            StartupConnectionState.Degraded   => "degraded",
            StartupConnectionState.Failed     => "failed",
            StartupConnectionState.TimedOut   => "timed out",
            StartupConnectionState.Skipped    => "skipped",
            _                                 => "waiting…",
        };

        private static string FormatElapsed(TimeSpan t) =>
            t.TotalMilliseconds < 1000 ? $"{t.TotalMilliseconds:F0} ms" : $"{t.TotalSeconds:F1} s";

        private void StartPulse(Row row)
        {
            if (row.Pulse != null) return;
            var anim = new DoubleAnimation
            {
                From = 1.0,
                To = 0.3,
                Duration = TimeSpan.FromMilliseconds(600),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            var sb = new Storyboard();
            sb.Children.Add(anim);
            Storyboard.SetTarget(anim, row.Dot);
            Storyboard.SetTargetProperty(anim, new PropertyPath(UIElement.OpacityProperty));
            row.Pulse = sb;
            sb.Begin();
        }

        private void StopPulse(Row row)
        {
            if (row.Pulse == null) return;
            row.Pulse.Stop();
            row.Pulse = null;
            row.Dot.Opacity = 1.0;
        }

        private void StartPhraseTimer()
        {
            _phraseIndex = _rng.Next(Phrases.Length);
            PhraseText.Text = Phrases[_phraseIndex];
            _phraseTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.4) };
            _phraseTimer.Tick += (_, _) =>
            {
                _phraseIndex = (_phraseIndex + 1) % Phrases.Length;
                PhraseText.Text = Phrases[_phraseIndex];
            };
            _phraseTimer.Start();
        }

        /// <summary>
        /// All real connections have settled — show a brief "Ready!" beat, then fade
        /// the whole overlay out and raise <see cref="DismissRequested"/> exactly once.
        /// Safe to call from any thread.
        /// </summary>
        public void FadeOutAndDismiss()
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(FadeOutAndDismiss));
                return;
            }
            if (_dismissed) return;
            _dismissed = true;

            _phraseTimer?.Stop();
            PhraseText.Text = "Ready — let's go!";

            var fade = new DoubleAnimation
            {
                From = 1.0,
                To = 0.0,
                // A short beat so "Ready!" is readable, then a smooth fade.
                BeginTime = TimeSpan.FromMilliseconds(450),
                Duration = TimeSpan.FromMilliseconds(500),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
            };
            fade.Completed += (_, _) => DismissRequested?.Invoke();
            BeginAnimation(UIElement.OpacityProperty, fade);
        }
    }
}
