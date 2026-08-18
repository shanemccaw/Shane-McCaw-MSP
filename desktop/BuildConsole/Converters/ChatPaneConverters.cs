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

    /// <summary>Visible only when the bound ComposerMode equals the mode named in ConverterParameter (supports "InteractiveOrTerminal", comma/pipe separated values).</summary>
    public sealed class ComposerModeVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is not ComposerMode mode) return Visibility.Collapsed;
            if (parameter is not string paramStr) return Visibility.Collapsed;

            if (paramStr.Equals("InteractiveOrTerminal", StringComparison.OrdinalIgnoreCase))
                return (mode is ComposerMode.Interactive or ComposerMode.Terminal) ? Visibility.Visible : Visibility.Collapsed;

            var modes = paramStr.Split(new[] { ',', '|', ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var m in modes)
            {
                if (Enum.TryParse<ComposerMode>(m.Trim(), ignoreCase: true, out var target) && mode == target)
                    return Visibility.Visible;
            }
            return Visibility.Collapsed;
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

    /// <summary>A file-edit diff line's foreground by kind — green added / red removed / accent meta header / muted context, reusing the pane's existing signal colors.</summary>
    public sealed class DiffLineKindToBrushConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var kind = value as DiffLineKind? ?? DiffLineKind.Context;
            var key = kind switch
            {
                DiffLineKind.Added => "ChatPane.Success",
                DiffLineKind.Removed => "ChatPane.Danger",
                DiffLineKind.Meta => "ChatPane.AccentText1",
                _ => "ChatPane.Muted5",
            };
            return Application.Current.TryFindResource(key);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }

    /// <summary>A file-edit diff line's row background by kind — a faint green/red wash for added/removed lines, transparent otherwise. Reuses the pane's existing translucent fill tokens.</summary>
    public sealed class DiffLineKindToBackgroundConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var kind = value as DiffLineKind? ?? DiffLineKind.Context;
            var key = kind switch
            {
                DiffLineKind.Added => "ChatPane.Pill.SuccessFill",
                DiffLineKind.Removed => "ChatPane.DangerFill",
                _ => (string?)null,
            };
            return key == null ? System.Windows.Media.Brushes.Transparent : Application.Current.TryFindResource(key);
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
            throw new NotSupportedException();
    }
}
