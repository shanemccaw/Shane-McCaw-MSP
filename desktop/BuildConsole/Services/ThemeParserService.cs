using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Xml.Linq;
using BuildConsole.Models;

namespace BuildConsole.Services
{
    public class ThemeParserService
    {
        private static readonly XNamespace PresentationNs = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
        private static readonly XNamespace XamlNs = "http://schemas.microsoft.com/winfx/2006/xaml";

        public string ColorsPath { get; private set; } = "";
        public string TypographyPath { get; private set; } = "";
        public string DarkThemePath { get; private set; } = "";

        public ThemeParserService()
        {
            ResolveThemePaths();
        }

        public void ResolveThemePaths()
        {
            // 1. Try repo root
            var repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (!string.IsNullOrEmpty(repoRoot))
            {
                var candidateThemes = Path.Combine(repoRoot, "desktop", "BuildConsole", "Themes");
                if (Directory.Exists(candidateThemes))
                {
                    ColorsPath = Path.Combine(candidateThemes, "Colors.xaml");
                    TypographyPath = Path.Combine(candidateThemes, "Typography.xaml");
                    DarkThemePath = Path.Combine(candidateThemes, "DarkTheme.xaml");
                    if (File.Exists(ColorsPath) && File.Exists(DarkThemePath))
                    {
                        return;
                    }
                }
            }

            // 2. Try AppContext.BaseDirectory
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var localThemes = Path.Combine(baseDir, "Themes");
            if (Directory.Exists(localThemes))
            {
                ColorsPath = Path.Combine(localThemes, "Colors.xaml");
                TypographyPath = Path.Combine(localThemes, "Typography.xaml");
                DarkThemePath = Path.Combine(localThemes, "DarkTheme.xaml");
                if (File.Exists(ColorsPath) && File.Exists(DarkThemePath))
                {
                    return;
                }
            }

            // 3. Fallback walk up from BaseDirectory
            var current = new DirectoryInfo(baseDir);
            while (current != null)
            {
                var checkPath = Path.Combine(current.FullName, "desktop", "BuildConsole", "Themes", "Colors.xaml");
                if (File.Exists(checkPath))
                {
                    var dir = Path.GetDirectoryName(checkPath)!;
                    ColorsPath = checkPath;
                    TypographyPath = Path.Combine(dir, "Typography.xaml");
                    DarkThemePath = Path.Combine(dir, "DarkTheme.xaml");
                    return;
                }
                current = current.Parent;
            }
        }

        public async Task<ThemeModel> LoadAndParseUnifiedThemeAsync()
        {
            return await Task.Run(() => LoadAndParseUnifiedTheme());
        }

        public ThemeModel LoadAndParseUnifiedTheme()
        {
            ResolveThemePaths();

            var theme = new ThemeModel
            {
                SourceColorsPath = ColorsPath,
                SourceTypographyPath = TypographyPath,
                SourceDarkThemePath = DarkThemePath,
                LoadedTimestamp = DateTime.Now
            };

            var colorMap = new Dictionary<string, ColorModel>(StringComparer.OrdinalIgnoreCase);
            var brushMap = new Dictionary<string, BrushModel>(StringComparer.OrdinalIgnoreCase);

            // -------------------------------------------------------------
            // Step 1 (Critical): Load Colors.xaml first (base palette)
            // -------------------------------------------------------------
            if (File.Exists(ColorsPath))
            {
                ParseColorsXaml(ColorsPath, theme, colorMap, brushMap);
            }

            // -------------------------------------------------------------
            // Step 2 (Critical): Load Typography.xaml second
            // -------------------------------------------------------------
            if (File.Exists(TypographyPath))
            {
                ParseTypographyXaml(TypographyPath, theme);
            }

            // -------------------------------------------------------------
            // Step 3 (Critical): Load DarkTheme.xaml last (merged dictionaries)
            // -------------------------------------------------------------
            if (File.Exists(DarkThemePath))
            {
                ParseDarkThemeXaml(DarkThemePath, theme, colorMap, brushMap);
            }

            // -------------------------------------------------------------
            // Step 4: Map Relationships & Usage Counts
            // -------------------------------------------------------------
            MapRelationshipsAndUsage(theme, colorMap, brushMap);

            // -------------------------------------------------------------
            // Step 5: Evaluate Color Diagnostics
            // -------------------------------------------------------------
            Color primaryBg = ThemeDiagnosticsService.PrimaryBackgroundColor;
            if (colorMap.TryGetValue("AppBackgroundColor", out var appBgModel))
            {
                primaryBg = appBgModel.Color;
            }

            foreach (var c in theme.Colors)
            {
                ThemeDiagnosticsService.EvaluateDiagnostics(c, primaryBg);
            }

            return theme;
        }

        private void ParseColorsXaml(string path, ThemeModel theme, Dictionary<string, ColorModel> colorMap, Dictionary<string, BrushModel> brushMap)
        {
            var doc = XDocument.Load(path, LoadOptions.PreserveWhitespace | LoadOptions.SetLineInfo);
            var root = doc.Root;
            if (root == null) return;

            foreach (var elem in root.Elements())
            {
                var localName = elem.Name.LocalName;
                var key = elem.Attribute(XamlNs + "Key")?.Value;
                if (string.IsNullOrEmpty(key)) continue;

                if (localName == "Color")
                {
                    var hex = elem.Value?.Trim() ?? "#000000";
                    var color = ParseColorHex(hex);
                    var model = new ColorModel
                    {
                        Key = key,
                        HexValue = hex,
                        Color = color,
                        SourceFile = "Colors.xaml",
                        Category = CategorizeColorKey(key)
                    };
                    theme.Colors.Add(model);
                    colorMap[key] = model;
                }
                else if (localName == "SolidColorBrush")
                {
                    var colorAttr = elem.Attribute("Color")?.Value ?? "";
                    string? colorKey = ExtractResourceKey(colorAttr);
                    string colorHex = "#000000";
                    Color brushColor = Colors.Transparent;

                    if (!string.IsNullOrEmpty(colorKey) && colorMap.TryGetValue(colorKey, out var refColor))
                    {
                        colorHex = refColor.HexValue;
                        brushColor = refColor.Color;
                    }
                    else if (colorAttr.StartsWith("#"))
                    {
                        colorHex = colorAttr;
                        brushColor = ParseColorHex(colorAttr);
                    }

                    var opacityAttr = elem.Attribute("Opacity")?.Value;
                    double opacity = 1.0;
                    if (!string.IsNullOrEmpty(opacityAttr) && double.TryParse(opacityAttr, out var opVal))
                    {
                        opacity = opVal;
                    }

                    var brush = new SolidColorBrush(brushColor) { Opacity = opacity };
                    if (brush.CanFreeze) brush.Freeze();

                    var brushModel = new BrushModel
                    {
                        Key = key,
                        ColorKey = colorKey,
                        ColorHex = colorHex,
                        Brush = brush,
                        Opacity = opacity,
                        SourceFile = "Colors.xaml",
                        BrushType = "SolidColorBrush"
                    };

                    theme.Brushes.Add(brushModel);
                    brushMap[key] = brushModel;

                    if (!string.IsNullOrEmpty(colorKey) && colorMap.TryGetValue(colorKey, out var cm))
                    {
                        if (!cm.ReferencedByBrushes.Contains(key))
                        {
                            cm.ReferencedByBrushes.Add(key);
                        }
                    }
                }
            }
        }

        private void ParseTypographyXaml(string path, ThemeModel theme)
        {
            var doc = XDocument.Load(path, LoadOptions.PreserveWhitespace | LoadOptions.SetLineInfo);
            var root = doc.Root;
            if (root == null) return;

            foreach (var elem in root.Elements())
            {
                var localName = elem.Name.LocalName;
                var key = elem.Attribute(XamlNs + "Key")?.Value;
                if (string.IsNullOrEmpty(key)) continue;

                if (localName == "Double")
                {
                    if (double.TryParse(elem.Value?.Trim(), out var sizeVal))
                    {
                        theme.Typography.Add(new TypographyModel
                        {
                            Key = key,
                            Category = "FontSize",
                            FontSize = sizeVal,
                            FontFamily = "Segoe UI",
                            FontWeight = "Normal",
                            SourceFile = "Typography.xaml",
                            SampleText = $"{key} = {sizeVal}px",
                            UsageLocations = new List<string> { "Window", "Menu", "TextBox", "Controls" }
                        });
                    }
                }
                else if (localName == "FontFamily")
                {
                    theme.Typography.Add(new TypographyModel
                    {
                        Key = key,
                        Category = "FontFamily",
                        FontFamily = elem.Value?.Trim() ?? "Segoe UI",
                        FontSize = 14,
                        SourceFile = "Typography.xaml",
                        SampleText = "The quick brown fox jumps over the lazy dog"
                    });
                }
                else if (localName == "Style")
                {
                    var targetType = elem.Attribute("TargetType")?.Value ?? "TextBlock";
                    double fontSize = 14;
                    string fontFamily = "Segoe UI";
                    string fontWeight = "Normal";

                    foreach (var setter in elem.Elements().Where(e => e.Name.LocalName == "Setter"))
                    {
                        var prop = setter.Attribute("Property")?.Value;
                        var val = setter.Attribute("Value")?.Value;
                        if (prop == "FontSize" && !string.IsNullOrEmpty(val))
                        {
                            if (double.TryParse(val, out var parsedSize)) fontSize = parsedSize;
                        }
                        else if (prop == "FontFamily" && !string.IsNullOrEmpty(val))
                        {
                            fontFamily = val;
                        }
                        else if (prop == "FontWeight" && !string.IsNullOrEmpty(val))
                        {
                            fontWeight = val;
                        }
                    }

                    theme.Typography.Add(new TypographyModel
                    {
                        Key = key,
                        Category = CategorizeTypographyKey(key),
                        TargetType = targetType,
                        FontSize = fontSize,
                        FontFamily = fontFamily,
                        FontWeight = fontWeight,
                        SourceFile = "Typography.xaml",
                        SampleText = GetSampleTextForCategory(key)
                    });
                }
            }

            // Ensure standard categories exist if not yet defined in Typography.xaml
            EnsureStandardTypography(theme);
        }

        private void EnsureStandardTypography(ThemeModel theme)
        {
            var keys = new HashSet<string>(theme.Typography.Select(t => t.Key), StringComparer.OrdinalIgnoreCase);

            double bodySize = theme.Typography.FirstOrDefault(t => t.Key == "BodyFontSize")?.FontSize ?? 14;
            double headerSize = theme.Typography.FirstOrDefault(t => t.Key == "HeaderFontSize")?.FontSize ?? 18;
            double subHeaderSize = theme.Typography.FirstOrDefault(t => t.Key == "SubHeaderFontSize")?.FontSize ?? 16;
            double monoSize = theme.Typography.FirstOrDefault(t => t.Key == "MonospaceFontSize")?.FontSize ?? 13;

            if (!keys.Contains("HeaderTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "HeaderTextStyle",
                    Category = "Heading",
                    FontFamily = "Segoe UI",
                    FontSize = headerSize,
                    FontWeight = "SemiBold",
                    SourceFile = "Typography.xaml",
                    SampleText = "Major Section Header (18px SemiBold)",
                    UsageLocations = new List<string> { "Dialog Titles", "Section Headers" }
                });
            }

            if (!keys.Contains("SubHeaderTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "SubHeaderTextStyle",
                    Category = "Heading",
                    FontFamily = "Segoe UI",
                    FontSize = subHeaderSize,
                    FontWeight = "SemiBold",
                    SourceFile = "Typography.xaml",
                    SampleText = "Panel Subheader (16px SemiBold)",
                    UsageLocations = new List<string> { "Card Headers", "Sidebar Titles" }
                });
            }

            if (!keys.Contains("BodyTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "BodyTextStyle",
                    Category = "Body",
                    FontFamily = "Segoe UI",
                    FontSize = bodySize,
                    FontWeight = "Normal",
                    SourceFile = "Typography.xaml",
                    SampleText = "Standard body text readability across BuildConsole views (14px Normal).",
                    UsageLocations = new List<string> { "TextBlocks", "Labels", "Descriptions" }
                });
            }

            if (!keys.Contains("CaptionTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "CaptionTextStyle",
                    Category = "Caption",
                    FontFamily = "Segoe UI",
                    FontSize = 11,
                    FontWeight = "Normal",
                    SourceFile = "Typography.xaml",
                    SampleText = "Timestamp 14:32:01 • Build #1048 • Passed",
                    UsageLocations = new List<string> { "Timestamps", "Badges", "Metadata" }
                });
            }

            if (!keys.Contains("ButtonTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "ButtonTextStyle",
                    Category = "Button",
                    FontFamily = "Segoe UI",
                    FontSize = bodySize,
                    FontWeight = "SemiBold",
                    SourceFile = "Typography.xaml",
                    SampleText = "Confirm Action",
                    UsageLocations = new List<string> { "Buttons", "CTA Chips", "Toolbars" }
                });
            }

            if (!keys.Contains("InputTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "InputTextStyle",
                    Category = "Input",
                    FontFamily = "Segoe UI",
                    FontSize = bodySize,
                    FontWeight = "Normal",
                    SourceFile = "Typography.xaml",
                    SampleText = "Filter by branch name...",
                    UsageLocations = new List<string> { "TextBox", "SearchBox", "ComboBox" }
                });
            }

            if (!keys.Contains("MonospaceTextStyle"))
            {
                theme.Typography.Add(new TypographyModel
                {
                    Key = "MonospaceTextStyle",
                    Category = "Monospace",
                    FontFamily = "Cascadia Code, Consolas, Courier New",
                    FontSize = monoSize,
                    FontWeight = "Normal",
                    SourceFile = "Typography.xaml",
                    SampleText = "git status --porcelain; exit 0",
                    UsageLocations = new List<string> { "EditorTextBox", "TerminalOutputBox", "LogViewer" }
                });
            }
        }

        private void ParseDarkThemeXaml(string path, ThemeModel theme, Dictionary<string, ColorModel> colorMap, Dictionary<string, BrushModel> brushMap)
        {
            var doc = XDocument.Load(path, LoadOptions.PreserveWhitespace | LoadOptions.SetLineInfo);
            var root = doc.Root;
            if (root == null) return;

            foreach (var elem in root.Elements())
            {
                var localName = elem.Name.LocalName;
                var key = elem.Attribute(XamlNs + "Key")?.Value;

                if (localName == "SolidColorBrush")
                {
                    if (string.IsNullOrEmpty(key)) continue;

                    var colorAttr = elem.Attribute("Color")?.Value ?? "";
                    string? colorKey = ExtractResourceKey(colorAttr);
                    string colorHex = "#000000";
                    Color brushColor = Colors.Transparent;

                    if (!string.IsNullOrEmpty(colorKey) && colorMap.TryGetValue(colorKey, out var refColor))
                    {
                        colorHex = refColor.HexValue;
                        brushColor = refColor.Color;
                    }
                    else if (colorAttr.StartsWith("#"))
                    {
                        colorHex = colorAttr;
                        brushColor = ParseColorHex(colorAttr);
                    }

                    var opacityAttr = elem.Attribute("Opacity")?.Value;
                    double opacity = 1.0;
                    if (!string.IsNullOrEmpty(opacityAttr) && double.TryParse(opacityAttr, out var opVal))
                    {
                        opacity = opVal;
                    }

                    var brush = new SolidColorBrush(brushColor) { Opacity = opacity };
                    if (brush.CanFreeze) brush.Freeze();

                    var brushModel = new BrushModel
                    {
                        Key = key,
                        ColorKey = colorKey,
                        ColorHex = colorHex,
                        Brush = brush,
                        Opacity = opacity,
                        SourceFile = "DarkTheme.xaml",
                        BrushType = "SolidColorBrush"
                    };

                    theme.Brushes.Add(brushModel);
                    brushMap[key] = brushModel;

                    if (!string.IsNullOrEmpty(colorKey) && colorMap.TryGetValue(colorKey, out var cm))
                    {
                        if (!cm.ReferencedByBrushes.Contains(key))
                        {
                            cm.ReferencedByBrushes.Add(key);
                        }
                    }
                }
                else if (localName == "Style")
                {
                    var targetType = elem.Attribute("TargetType")?.Value ?? "";
                    var basedOn = elem.Attribute("BasedOn")?.Value;
                    var styleKey = key ?? targetType;

                    var styleModel = new StyleModel
                    {
                        Key = styleKey,
                        TargetType = targetType,
                        BasedOn = basedOn,
                        SourceFile = "DarkTheme.xaml"
                    };

                    // Extract brushes and colors used in Setters and ControlTemplate
                    ExtractBrushAndColorReferences(elem, styleModel.BrushesUsed, styleModel.ColorsUsed);
                    theme.Styles.Add(styleModel);
                }
                else if (localName == "ControlTemplate")
                {
                    if (string.IsNullOrEmpty(key)) continue;
                    var targetType = elem.Attribute("TargetType")?.Value ?? "";

                    var tmplModel = new TemplateModel
                    {
                        Key = key,
                        TargetType = targetType,
                        SourceFile = "DarkTheme.xaml"
                    };

                    ExtractBrushAndColorReferences(elem, tmplModel.BrushesUsed, tmplModel.ColorsUsed);
                    theme.Templates.Add(tmplModel);
                }
            }
        }

        private void ExtractBrushAndColorReferences(XElement root, List<string> brushesUsed, List<string> colorsUsed)
        {
            var text = root.ToString();
            // Match {StaticResource Key} and {DynamicResource Key}
            var matches = Regex.Matches(text, @"\{(?:StaticResource|DynamicResource)\s+([a-zA-Z0-9_]+)\}");
            foreach (Match m in matches)
            {
                var resourceKey = m.Groups[1].Value;
                if (resourceKey.EndsWith("Brush", StringComparison.OrdinalIgnoreCase) ||
                    resourceKey.EndsWith("Tint", StringComparison.OrdinalIgnoreCase))
                {
                    if (!brushesUsed.Contains(resourceKey)) brushesUsed.Add(resourceKey);
                }
                else if (resourceKey.EndsWith("Color", StringComparison.OrdinalIgnoreCase))
                {
                    if (!colorsUsed.Contains(resourceKey)) colorsUsed.Add(resourceKey);
                }
            }
        }

        private void MapRelationshipsAndUsage(ThemeModel theme, Dictionary<string, ColorModel> colorMap, Dictionary<string, BrushModel> brushMap)
        {
            // Map Brush -> Styles & Templates referencing it
            foreach (var style in theme.Styles)
            {
                foreach (var bKey in style.BrushesUsed)
                {
                    if (brushMap.TryGetValue(bKey, out var bm))
                    {
                        if (!bm.ReferencedByStyles.Contains(style.Key))
                        {
                            bm.ReferencedByStyles.Add(style.Key);
                            bm.UsageCount++;
                        }
                    }
                }
            }

            foreach (var tmpl in theme.Templates)
            {
                foreach (var bKey in tmpl.BrushesUsed)
                {
                    if (brushMap.TryGetValue(bKey, out var bm))
                    {
                        if (!bm.ReferencedByTemplates.Contains(tmpl.Key))
                        {
                            bm.ReferencedByTemplates.Add(tmpl.Key);
                            bm.UsageCount++;
                        }
                    }
                }
            }

            // Map Color usage count: Color's direct style references + references via Brushes
            foreach (var color in theme.Colors)
            {
                int totalUsage = 0;
                foreach (var bKey in color.ReferencedByBrushes)
                {
                    if (brushMap.TryGetValue(bKey, out var bm))
                    {
                        totalUsage += Math.Max(1, bm.UsageCount);
                    }
                }

                // Check direct style references to this color
                foreach (var style in theme.Styles)
                {
                    if (style.ColorsUsed.Contains(color.Key))
                    {
                        totalUsage++;
                    }
                }

                color.UsageCount = totalUsage;
            }
        }

        public static Color ParseColorHex(string hex)
        {
            try
            {
                hex = hex.Trim().TrimStart('#');
                if (hex.Length == 3) // #RGB
                {
                    byte r = Convert.ToByte(new string(hex[0], 2), 16);
                    byte g = Convert.ToByte(new string(hex[1], 2), 16);
                    byte b = Convert.ToByte(new string(hex[2], 2), 16);
                    return Color.FromArgb(255, r, g, b);
                }
                if (hex.Length == 6) // #RRGGBB
                {
                    byte r = Convert.ToByte(hex.Substring(0, 2), 16);
                    byte g = Convert.ToByte(hex.Substring(2, 2), 16);
                    byte b = Convert.ToByte(hex.Substring(4, 2), 16);
                    return Color.FromArgb(255, r, g, b);
                }
                if (hex.Length == 8) // #AARRGGBB
                {
                    byte a = Convert.ToByte(hex.Substring(0, 2), 16);
                    byte r = Convert.ToByte(hex.Substring(2, 2), 16);
                    byte g = Convert.ToByte(hex.Substring(4, 2), 16);
                    byte b = Convert.ToByte(hex.Substring(6, 2), 16);
                    return Color.FromArgb(a, r, g, b);
                }
            }
            catch
            {
                // Fallback to Black
            }
            return Colors.Black;
        }

        public static string ColorToHex(Color c, bool includeAlpha = false)
        {
            if (includeAlpha || c.A != 255)
            {
                return $"#{c.A:X2}{c.R:X2}{c.G:X2}{c.B:X2}";
            }
            return $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        }

        private static string? ExtractResourceKey(string val)
        {
            if (string.IsNullOrWhiteSpace(val)) return null;
            var match = Regex.Match(val, @"\{(?:StaticResource|DynamicResource)\s+([a-zA-Z0-9_]+)\}");
            return match.Success ? match.Groups[1].Value : null;
        }

        private static string CategorizeColorKey(string key)
        {
            if (key.Contains("Background", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Card", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Panel", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Border", StringComparison.OrdinalIgnoreCase))
                return "Background";

            if (key.Contains("Text", StringComparison.OrdinalIgnoreCase))
                return "Text";

            if (key.Contains("Accent", StringComparison.OrdinalIgnoreCase))
                return "Accent";

            if (key.Contains("Status", StringComparison.OrdinalIgnoreCase))
                return "Status";

            return "General";
        }

        private static string CategorizeTypographyKey(string key)
        {
            if (key.Contains("Header", StringComparison.OrdinalIgnoreCase) || key.Contains("Heading", StringComparison.OrdinalIgnoreCase))
                return "Heading";
            if (key.Contains("Caption", StringComparison.OrdinalIgnoreCase))
                return "Caption";
            if (key.Contains("Button", StringComparison.OrdinalIgnoreCase))
                return "Button";
            if (key.Contains("Input", StringComparison.OrdinalIgnoreCase))
                return "Input";
            if (key.Contains("Mono", StringComparison.OrdinalIgnoreCase))
                return "Monospace";
            return "Body";
        }

        private static string GetSampleTextForCategory(string key)
        {
            if (key.Contains("Header", StringComparison.OrdinalIgnoreCase))
                return "Build Console System Header";
            if (key.Contains("Caption", StringComparison.OrdinalIgnoreCase))
                return "v2.4.1 • Updated 2 minutes ago";
            if (key.Contains("Button", StringComparison.OrdinalIgnoreCase))
                return "Run Build";
            if (key.Contains("Input", StringComparison.OrdinalIgnoreCase))
                return "Search manifests and logs...";
            if (key.Contains("Mono", StringComparison.OrdinalIgnoreCase))
                return "npm run test:e2e";
            return "Antigravity IDE unified theme typography sample";
        }
    }
}
