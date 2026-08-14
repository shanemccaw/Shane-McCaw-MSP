using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace BuildConsole.Converters
{
    internal static class FluidMath
    {
        /// <summary>Linear-interpolates value between min (at paneWidth&lt;=480) and max (at paneWidth&gt;=800), matching the design handoff's CSS clamp() fluid sizing. See design_handoff_claude_cli_chat/README.md "Responsive behavior".</summary>
        public static double Interpolate(double paneWidth, double min, double max, double paneMin = 480, double paneMax = 800)
        {
            double t = paneMax > paneMin ? (paneWidth - paneMin) / (paneMax - paneMin) : 1;
            t = Math.Max(0, Math.Min(1, t));
            return min + (max - min) * t;
        }

        public static (double min, double max) ParseRange(object? parameter)
        {
            var parts = (parameter as string)?.Split(',');
            if (parts == null || parts.Length != 2 ||
                !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var min) ||
                !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var max))
            {
                throw new ArgumentException("ConverterParameter must be \"min,max\" (invariant-culture doubles).", nameof(parameter));
            }
            return (min, max);
        }
    }

    /// <summary>
    /// WPF equivalent of the design handoff's CSS <c>clamp(min, vw, max)</c> fluid sizing:
    /// given the pane's own width (bind to its ActualWidth — a DependencyProperty, so the
    /// binding re-evaluates on resize with no INotifyPropertyChanged needed), linearly
    /// interpolates between a min/max pair, clamped at both ends, floored at 10px per the
    /// spec ("Nothing may drop below 10px"). ConverterParameter is "min,max".
    /// </summary>
    public sealed class FluidSizeConverter : IValueConverter
    {
        public double Floor { get; set; } = 10;

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            double width = value is double d ? d : 0;
            var (min, max) = FluidMath.ParseRange(parameter);
            return Math.Max(Floor, FluidMath.Interpolate(width, min, max));
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Same fluid interpolation as <see cref="FluidSizeConverter"/> but returns a symmetric horizontal Thickness(v,0,v,0) — used for the transcript/composer column's fluid side padding (14→36px per spec).</summary>
    public sealed class FluidHorizontalPaddingConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            double width = value is double d ? d : 0;
            var (min, max) = FluidMath.ParseRange(parameter);
            double v = FluidMath.Interpolate(width, min, max);
            return new Thickness(v, 0, v, 0);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Same fluid interpolation but returns a bottom-only Thickness(0,0,0,v) — the assistant-turn "gap" spacing (11→22px per spec) applied via ItemsControl.ItemContainerStyle.</summary>
    public sealed class FluidBottomMarginConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            double width = value is double d ? d : 0;
            var (min, max) = FluidMath.ParseRange(parameter);
            double v = FluidMath.Interpolate(width, min, max);
            return new Thickness(0, 0, 0, v);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }
}
