using System;
using System.Windows.Media;
using BuildConsole.Models;

namespace BuildConsole.Services
{
    public static class ThemeDiagnosticsService
    {
        // Primary app background color from Colors.xaml (#0D1117)
        public static readonly Color PrimaryBackgroundColor = Color.FromRgb(0x0D, 0x11, 0x17);

        /// <summary>
        /// Calculates perceived brightness (0 to 255) using standard HSP formula.
        /// </summary>
        public static double CalculateBrightness(Color color)
        {
            double r = color.R;
            double g = color.G;
            double b = color.B;
            return Math.Sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b);
        }

        /// <summary>
        /// Calculates WCAG 2.1 relative luminance for a color.
        /// </summary>
        public static double CalculateRelativeLuminance(Color color)
        {
            double rLin = LinearizeChannel(color.R / 255.0);
            double gLin = LinearizeChannel(color.G / 255.0);
            double bLin = LinearizeChannel(color.B / 255.0);
            return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
        }

        private static double LinearizeChannel(double val)
        {
            return val <= 0.03928 ? val / 12.92 : Math.Pow((val + 0.055) / 1.055, 2.4);
        }

        /// <summary>
        /// Calculates WCAG contrast ratio (1.0 to 21.0) between two colors.
        /// </summary>
        public static double CalculateContrastRatio(Color foreground, Color background)
        {
            double l1 = CalculateRelativeLuminance(foreground);
            double l2 = CalculateRelativeLuminance(background);
            double lighter = Math.Max(l1, l2);
            double darker = Math.Min(l1, l2);
            return (lighter + 0.05) / (darker + 0.05);
        }

        /// <summary>
        /// Converts Color to HSL (Hue: 0-360, Saturation: 0-1, Lightness: 0-1).
        /// </summary>
        public static (double h, double s, double l) ColorToHsl(Color color)
        {
            double r = color.R / 255.0;
            double g = color.G / 255.0;
            double b = color.B / 255.0;

            double max = Math.Max(r, Math.Max(g, b));
            double min = Math.Min(r, Math.Min(g, b));
            double delta = max - min;

            double l = (max + min) / 2.0;
            double h = 0;
            double s = 0;

            if (delta > 0.00001)
            {
                s = l > 0.5 ? delta / (2.0 - max - min) : delta / (max + min);

                if (Math.Abs(max - r) < 0.00001)
                {
                    h = (g - b) / delta + (g < b ? 6.0 : 0.0);
                }
                else if (Math.Abs(max - g) < 0.00001)
                {
                    h = (b - r) / delta + 2.0;
                }
                else
                {
                    h = (r - g) / delta + 4.0;
                }

                h *= 60.0;
            }

            return (h, s, l);
        }

        /// <summary>
        /// Converts HSL back to RGB Color.
        /// </summary>
        public static Color HslToColor(double h, double s, double l, byte alpha = 255)
        {
            h = ((h % 360) + 360) % 360;
            s = Math.Clamp(s, 0.0, 1.0);
            l = Math.Clamp(l, 0.0, 1.0);

            if (s <= 0.0001)
            {
                byte v = (byte)Math.Round(l * 255.0);
                return Color.FromArgb(alpha, v, v, v);
            }

            double q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
            double p = 2.0 * l - q;
            double hk = h / 360.0;

            double tr = hk + 1.0 / 3.0;
            double tg = hk;
            double tb = hk - 1.0 / 3.0;

            byte red = (byte)Math.Round(ColorComponentFromHue(p, q, tr) * 255.0);
            byte green = (byte)Math.Round(ColorComponentFromHue(p, q, tg) * 255.0);
            byte blue = (byte)Math.Round(ColorComponentFromHue(p, q, tb) * 255.0);

            return Color.FromArgb(alpha, red, green, blue);
        }

        private static double ColorComponentFromHue(double p, double q, double t)
        {
            if (t < 0) t += 1.0;
            if (t > 1) t -= 1.0;
            if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
            if (t < 1.0 / 2.0) return q;
            if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
            return p;
        }

        /// <summary>
        /// Evaluates all diagnostic metrics for a ColorModel against the primary theme background.
        /// </summary>
        public static void EvaluateDiagnostics(ColorModel model, Color? primaryBg = null)
        {
            var bg = primaryBg ?? PrimaryBackgroundColor;
            var c = model.Color;

            model.Brightness = CalculateBrightness(c);
            model.ContrastRatio = CalculateContrastRatio(c, bg);

            var (h, s, l) = ColorToHsl(c);

            // Shane ADHD sensitivity: "Dark color. Bright hurts my eyes. Pinks are bad."
            // Flag backgrounds that are too bright (> 65)
            bool isBackgroundKey = model.Key.Contains("Background", StringComparison.OrdinalIgnoreCase) ||
                                  model.Key.Contains("Card", StringComparison.OrdinalIgnoreCase) ||
                                  model.Key.Contains("Panel", StringComparison.OrdinalIgnoreCase) ||
                                  model.Key.Contains("Crust", StringComparison.OrdinalIgnoreCase) ||
                                  model.Key.Contains("Mantle", StringComparison.OrdinalIgnoreCase) ||
                                  model.Key.Contains("Base", StringComparison.OrdinalIgnoreCase);

            if (isBackgroundKey)
            {
                model.IsTooBright = model.Brightness > 65.0;
                // Low contrast for background against border or primary
                model.IsLowContrast = false; // backgrounds are intentionally low contrast to each other
            }
            else if (model.Key.Contains("Text", StringComparison.OrdinalIgnoreCase))
            {
                // Text should have at least 4.5:1 for primary, 3.0:1 for disabled
                model.IsTooBright = model.Brightness > 240.0; // pure white glare is discouraged
                double minContrast = model.Key.Contains("Disabled", StringComparison.OrdinalIgnoreCase) ? 2.5 : 4.5;
                model.IsLowContrast = model.ContrastRatio < minContrast;
            }
            else // Accents / Status
            {
                // High glare accents > 215
                model.IsTooBright = model.Brightness > 215.0;
                model.IsLowContrast = model.ContrastRatio < 3.0;
            }

            // Outlier detection:
            // Check for oversaturated neon (> 92% saturation) or harsh magentas/pinks (hue 290-340 with high sat)
            bool isHarshPink = (h >= 290 && h <= 345) && s > 0.65 && l > 0.60;
            bool isNeon = s > 0.92 && l > 0.70;
            model.IsOutlier = isHarshPink || isNeon;

            // Unused detection
            model.IsUnused = model.UsageCount == 0 && model.ReferencedByBrushes.Count == 0;
        }
    }
}
