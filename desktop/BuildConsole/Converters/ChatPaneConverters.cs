using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using BuildConsole.Controls;

namespace BuildConsole.Converters
{
    /// <summary>Visible when the bound string is non-null/non-empty — used for the composer footer's token segment (hidden entirely when no real usage data is available, never showing a fabricated placeholder).</summary>
    public sealed class StringNonEmptyToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
            string.IsNullOrEmpty(value as string) ? Visibility.Collapsed : Visibility.Visible;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Visible when the bound string IS null/empty — drives the composer's placeholder overlay (WPF TextBox has no built-in watermark).</summary>
    public sealed class StringEmptyToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
            string.IsNullOrEmpty(value as string) ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>True for a UserMessageTurn — used to give it its own spec'd border/padding instead of the uniform inter-item gap the other turn types share.</summary>
    public sealed class IsUserMessageTurnConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value is UserMessageTurn;
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => throw new NotSupportedException();
    }

    /// <summary>Maps a ToolGroupTurn.GlyphKey ("wrench" / "file-text") to its Resources/Icons.xaml geometry.</summary>
    public sealed class GlyphKeyConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var key = value as string == "file-text" ? "Icon.FileText" : "Icon.Wrench";
            return Application.Current.TryFindResource(key);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Visible only when the bound ComposerMode equals the mode named in ConverterParameter.</summary>
    public sealed class ComposerModeVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is not ComposerMode mode) return Visibility.Collapsed;
            var target = Enum.Parse<ComposerMode>((string)parameter);
            return mode == target ? Visibility.Visible : Visibility.Collapsed;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Assistant paragraph text color by Kind — Normal uses the spec's plain prose color; Error/Done reuse the existing app's red/green signal so today's color-coded lines keep their meaning.</summary>
    public sealed class ParagraphKindToBrushConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var kind = value as ParagraphKind? ?? ParagraphKind.Normal;
            var key = kind switch
            {
                ParagraphKind.Error => "ChatPane.Danger",
                ParagraphKind.Done => "ChatPane.Success",
                _ => "ChatPane.Text2",
            };
            return Application.Current.TryFindResource(key);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>Assistant paragraph FontWeight by Kind — Error/Done read as SemiBold, matching the pre-redesign card styling for those two event types.</summary>
    public sealed class ParagraphKindToWeightConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var kind = value as ParagraphKind? ?? ParagraphKind.Normal;
            return kind == ParagraphKind.Normal ? FontWeights.Normal : FontWeights.SemiBold;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }
}
