using System;
using System.Windows;
using System.Windows.Media.Animation;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1030 cleanup pass — Shane: "things shouldnt just boop gone... make them
    /// fade out or slide away or something." Small reusable fade in/out for overlays
    /// and tab-close, replacing straight Visibility flips / instant Items.Remove.
    /// </summary>
    public static class UiFadeHelper
    {
        public static void FadeIn(UIElement element, double durationMs = 140)
        {
            element.Opacity = 0;
            element.Visibility = Visibility.Visible;
            element.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(durationMs)));
        }

        public static void FadeOut(UIElement element, double durationMs = 140, Action? onComplete = null)
        {
            var anim = new DoubleAnimation(element.Opacity, 0, TimeSpan.FromMilliseconds(durationMs));
            anim.Completed += (s, e) =>
            {
                element.BeginAnimation(UIElement.OpacityProperty, null);
                element.Opacity = 1;
                element.Visibility = Visibility.Collapsed;
                onComplete?.Invoke();
            };
            element.BeginAnimation(UIElement.OpacityProperty, anim);
        }
    }
}
