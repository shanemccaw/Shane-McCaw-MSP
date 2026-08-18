using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Reusable document backdrop watermark & empty state illustration featuring
    /// Donald the Sailor Duck in his sailboat with continuous gentle wave motion.
    /// </summary>
    public partial class SailorDuckWatermarkControl : UserControl
    {
        private static readonly Random Rng = new();

        public static readonly DependencyProperty CustomTextProperty =
            DependencyProperty.Register(
                nameof(CustomText),
                typeof(string),
                typeof(SailorDuckWatermarkControl),
                new PropertyMetadata("Ahoy! Smooth sailing on the codebase! ⛵", OnCustomTextChanged));

        public static readonly DependencyProperty WatermarkOpacityProperty =
            DependencyProperty.Register(
                nameof(WatermarkOpacity),
                typeof(double),
                typeof(SailorDuckWatermarkControl),
                new PropertyMetadata(1.0, OnWatermarkOpacityChanged));

        public static readonly DependencyProperty ShowQuipProperty =
            DependencyProperty.Register(
                nameof(ShowQuip),
                typeof(bool),
                typeof(SailorDuckWatermarkControl),
                new PropertyMetadata(true, OnShowQuipChanged));

        public static readonly DependencyProperty MascotSizeProperty =
            DependencyProperty.Register(
                nameof(MascotSize),
                typeof(double),
                typeof(SailorDuckWatermarkControl),
                new PropertyMetadata(260.0, OnMascotSizeChanged));

        public string CustomText
        {
            get => (string)GetValue(CustomTextProperty);
            set => SetValue(CustomTextProperty, value);
        }

        public double WatermarkOpacity
        {
            get => (double)GetValue(WatermarkOpacityProperty);
            set => SetValue(WatermarkOpacityProperty, value);
        }

        public bool ShowQuip
        {
            get => (bool)GetValue(ShowQuipProperty);
            set => SetValue(ShowQuipProperty, value);
        }

        public double MascotSize
        {
            get => (double)GetValue(MascotSizeProperty);
            set => SetValue(MascotSizeProperty, value);
        }

        public SailorDuckWatermarkControl()
        {
            InitializeComponent();
            Loaded += SailorDuckWatermarkControl_Loaded;
        }

        private void SailorDuckWatermarkControl_Loaded(object sender, RoutedEventArgs e)
        {
            RenderMascot();
        }

        private static void OnCustomTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            if (d is SailorDuckWatermarkControl ctrl && e.NewValue is string s)
            {
                ctrl.QuipText.Text = s;
            }
        }

        private static void OnWatermarkOpacityChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            if (d is SailorDuckWatermarkControl ctrl && e.NewValue is double op)
            {
                ctrl.RootGrid.Opacity = op;
            }
        }

        private static void OnShowQuipChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            if (d is SailorDuckWatermarkControl ctrl && e.NewValue is bool show)
            {
                ctrl.QuipBadge.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            }
        }

        private static void OnMascotSizeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            if (d is SailorDuckWatermarkControl ctrl && e.NewValue is double size)
            {
                ctrl.MascotContainer.Width = size;
                ctrl.MascotContainer.Height = size;
                ctrl.RenderMascot();
            }
        }

        private void RenderMascot()
        {
            MascotContainer.Child = null;

            double size = MascotSize > 0 ? MascotSize : 260;
            MascotContainer.Width = size;
            MascotContainer.Height = size;

            var mascot = SailorDuckMascotLayer.CreateSailorDuckInSailboat(
                size, size,
                showSpeechBubble: false,
                isDroppingAnchor: true);

            // Ambient gentle wave bob & tilt
            var bobTransform = new TranslateTransform();
            var tiltTransform = new RotateTransform(0, size / 2, size * 0.85);

            var group = new TransformGroup();
            group.Children.Add(bobTransform);
            group.Children.Add(tiltTransform);
            mascot.RenderTransform = group;

            var bobAnim = new DoubleAnimation(-6, 6, TimeSpan.FromSeconds(1.2 + Rng.NextDouble() * 0.4))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            bobTransform.BeginAnimation(TranslateTransform.YProperty, bobAnim);

            var tiltAnim = new DoubleAnimation(-4, 4, TimeSpan.FromSeconds(1.6 + Rng.NextDouble() * 0.5))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            tiltTransform.BeginAnimation(RotateTransform.AngleProperty, tiltAnim);

            MascotContainer.Child = mascot;
            RootGrid.Opacity = WatermarkOpacity;
            QuipBadge.Visibility = ShowQuip ? Visibility.Visible : Visibility.Collapsed;
            QuipText.Text = CustomText;
        }
    }
}
