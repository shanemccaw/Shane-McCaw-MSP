using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    // Spawns Copilot-designed vector critters onto a Canvas (stage). Motion deliberately mirrors
    // FocusCharacterLayer.Stroll() — a full-width left-to-right/right-to-left amble with bob+waddle,
    // not the as-authored fixed-position float-in-place — so the new critter pool reads as the same
    // kind of ambient companion as the existing emoji Companions, not a visually distinct system.
    // Runs additively alongside (never in place of) the existing emoji companions.
    public class CritterSpawner
    {
        private readonly Canvas _stage;
        private readonly Random _rng = new();
        private readonly int _maxConcurrent = 6;

        public CritterSpawner(Canvas stage)
        {
            _stage = stage ?? throw new ArgumentNullException(nameof(stage));
        }

        /// <summary>One critter (any category) strolls the full width — the ambient-loop trigger,
        /// interleaved with the existing emoji Stroll()/PeekFromEdge() companions.</summary>
        public void AmbientStroll()
        {
            if (_stage.ActualWidth < 80 || _stage.ActualHeight < 30) return;
            var pool = CritterRegistry.All;
            if (pool.Count == 0) return;
            SpawnOne(WeightedPick(pool), "ambient stroll");
        }

        /// <summary>A build tied to the focused epic finished — positive critters on success, cute-grumpy
        /// critters on failure. Mirrors CelebrateBuildFinished's existing emoji HappyHop/Banner pairing.</summary>
        public void SpawnForEvent(bool success)
        {
            if (_stage.ActualWidth < 80 || _stage.ActualHeight < 30) return;
            var cat = success ? CritterCategory.Positive : CritterCategory.Negative;
            int count = success ? _rng.Next(2, 4) : _rng.Next(1, 3);
            SpawnMany(cat, count, "build finished");
        }

        /// <summary>N issue(s) closed under the focused epic — positive critters stroll in alongside the
        /// existing trophy/checkmark FloatUp() glyphs.</summary>
        public void CelebrateIssuesClosed(int count)
        {
            if (_stage.ActualWidth < 80 || _stage.ActualHeight < 30) return;
            int n = Math.Min(Math.Max(1, count), 3);
            SpawnMany(CritterCategory.Positive, n, "issues closed");
        }

        private void SpawnMany(CritterCategory category, int count, string reason)
        {
            var pool = CritterRegistry.All.Where(c => c.Category == category).ToList();
            if (!pool.Any()) return;
            for (int i = 0; i < count; i++)
            {
                if (_stage.Children.Count > _maxConcurrent) break;
                SpawnOne(WeightedPick(pool), reason);
            }
        }

        private void SpawnOne(CritterInfo info, string reason)
        {
            if (_stage.Children.Count > _maxConcurrent) return;

            var art = info.Factory();
            double width = art.Width * info.Scale;
            double height = art.Height * info.Scale;
            art.Width = width;
            art.Height = height;

            var wrapper = new Canvas { Width = width, Height = height, ClipToBounds = false };
            wrapper.Children.Add(art);

            bool leftToRight = _rng.NextDouble() < 0.5;
            double y = _stage.ActualHeight - height - 14 - _rng.Next(0, 30); // hug the bottom border, like Stroll()
            double startX = leftToRight ? -width - 10 : _stage.ActualWidth + width + 10;
            double endX = leftToRight ? _stage.ActualWidth + width + 10 : -width - 10;

            var scale = new ScaleTransform(1, 1);
            var rotate = new RotateTransform();
            var translate = new TranslateTransform();
            var grp = new TransformGroup();
            grp.Children.Add(scale);
            grp.Children.Add(rotate);
            grp.Children.Add(translate);
            wrapper.RenderTransformOrigin = new Point(0.5, 0.5);
            wrapper.RenderTransform = grp;
            if (!leftToRight) scale.ScaleX = -1; // face the way it's walking, same as Stroll()

            Canvas.SetLeft(wrapper, startX);
            Canvas.SetTop(wrapper, y);
            _stage.Children.Add(wrapper);

            // Full-width traversal, 7.5-11.5s — identical timing/easing to FocusCharacterLayer.Stroll().
            double dur = 7.5 + _rng.NextDouble() * 4.0;
            var walk = new DoubleAnimation(startX, endX, TimeSpan.FromSeconds(dur))
            { EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            walk.Completed += (_, _) => _stage.Children.Remove(wrapper);

            var bob = new DoubleAnimation(0, -6, TimeSpan.FromSeconds(0.6))
            { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            var waddle = new DoubleAnimation(-7, 7, TimeSpan.FromSeconds(0.9))
            { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };

            wrapper.BeginAnimation(Canvas.LeftProperty, walk);
            translate.BeginAnimation(TranslateTransform.YProperty, bob);
            rotate.BeginAnimation(RotateTransform.AngleProperty, waddle);
            FadeIn(wrapper);

            ActivityLog.Log("focus-mode", $"immersive {reason}: {info.Name} critter strolled across the border");
        }

        private static void FadeIn(UIElement el)
            => el.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromSeconds(0.35)));

        private CritterInfo WeightedPick(List<CritterInfo> pool)
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
