using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;

namespace BuildConsole.Controls
{
    // Spawns critters onto a Canvas (stage) with simple entrance/float animations and TTL.
    public class CritterSpawner
    {
        private readonly Canvas _stage;
        private readonly Random _rng = new();
        private readonly int _maxConcurrent = 6;

        public CritterSpawner(Canvas stage)
        {
            _stage = stage ?? throw new ArgumentNullException(nameof(stage));
        }

        public void SpawnForEvent(bool success)
        {
            if (_stage.ActualWidth < 80 || _stage.ActualHeight < 30) return;
            var cat = success ? CritterCategory.Positive : CritterCategory.Negative;
            int count = success ? (_rng.Next(2, 4)) : (_rng.Next(1, 3));
            SpawnMany(cat, count);
        }

        private void SpawnMany(CritterCategory category, int count)
        {
            var pool = CritterRegistry.All.Where(c => c.Category == category).ToList();
            if (!pool.Any()) return;
            for (int i = 0; i < count; i++)
            {
                if (_stage.Children.Count > _maxConcurrent) break;
                var pick = WeightedPick(pool);
                var canvas = pick.Factory();
                canvas.Width = canvas.Width * pick.Scale;
                canvas.Height = canvas.Height * pick.Scale;
                // wrap for easy transform
                var wrapper = new Canvas { Width = canvas.Width, Height = canvas.Height, ClipToBounds = false };
                wrapper.Children.Add(canvas);

                double x = 40 + _rng.NextDouble() * Math.Max(0, _stage.ActualWidth - 80);
                double y = _stage.ActualHeight - canvas.Height - 18 - _rng.Next(0, 40);
                Canvas.SetLeft(wrapper, x);
                Canvas.SetTop(wrapper, y);
                _stage.Children.Add(wrapper);

                // entrance animation: small pop & float
                var pop = new DoubleAnimation(0.6, 1.0, TimeSpan.FromSeconds(0.36)) { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.35 } };
                wrapper.RenderTransformOrigin = new Point(0.5, 0.5);
                var scale = new System.Windows.Media.ScaleTransform(0.8, 0.8);
                wrapper.RenderTransform = scale;
                scale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleXProperty, pop);
                scale.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleYProperty, pop);

                // float up slightly and wobble
                var translate = new System.Windows.Media.TranslateTransform();
                wrapper.RenderTransform = new System.Windows.Media.TransformGroup { Children = { scale, translate } };
                var floatAnim = new DoubleAnimation(0, -10 - _rng.Next(0, 14), TimeSpan.FromSeconds(1.8)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
                translate.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, floatAnim);

                // remove after TTL
                var ttl = TimeSpan.FromSeconds(5 + _rng.NextDouble() * 4.0);
                var t = new System.Threading.Timer(_ =>
                {
                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        if (_stage.Children.Contains(wrapper))
                        {
                            // fade then remove
                            var fade = new DoubleAnimation(1, 0, TimeSpan.FromSeconds(0.7));
                            fade.Completed += (_, __) => { _stage.Children.Remove(wrapper); };
                            wrapper.BeginAnimation(UIElement.OpacityProperty, fade);
                        }
                    });
                }, null, ttl, TimeSpan.FromMilliseconds(-1));
            }
        }

        private CritterInfo WeightedPick(System.Collections.Generic.List<CritterInfo> pool)
        {
            double total = pool.Sum(p => p.SpawnWeight);
            double pick = _rng.NextDouble() * total;
            double acc = 0;
            foreach (var p in pool)
            {
                acc += p.SpawnWeight;
                if (pick <= acc) return p;
            }
            return pool.Last();
        }
    }
}
