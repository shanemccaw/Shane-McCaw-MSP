using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using BuildConsole.Models;

namespace BuildConsole.Services
{
    public class ThemeReloaderService
    {
        /// <summary>
        /// Applies live updates directly to Application.Current.Resources so all windows reflect changes immediately.
        /// </summary>
        public static void ApplyLiveColorUpdate(string colorKey, Color newColor, string? associatedBrushKey = null, double opacity = 1.0)
        {
            if (Application.Current == null) return;

            Application.Current.Dispatcher.Invoke(() =>
            {
                // Update Color resource
                if (!string.IsNullOrEmpty(colorKey))
                {
                    Application.Current.Resources[colorKey] = newColor;
                }

                // Update Brush resource if specified
                if (!string.IsNullOrEmpty(associatedBrushKey))
                {
                    var newBrush = new SolidColorBrush(newColor) { Opacity = opacity };
                    if (newBrush.CanFreeze) newBrush.Freeze();
                    Application.Current.Resources[associatedBrushKey] = newBrush;
                }
            });
        }

        /// <summary>
        /// Applies live updates for a brush key directly.
        /// </summary>
        public static void ApplyLiveBrushUpdate(string brushKey, Brush newBrush)
        {
            if (Application.Current == null) return;

            Application.Current.Dispatcher.Invoke(() =>
            {
                Application.Current.Resources[brushKey] = newBrush;
            });
        }

        /// <summary>
        /// Applies live updates for a typography resource.
        /// </summary>
        public static void ApplyLiveTypographyUpdate(string key, object value)
        {
            if (Application.Current == null) return;

            Application.Current.Dispatcher.Invoke(() =>
            {
                Application.Current.Resources[key] = value;
            });
        }

        /// <summary>
        /// Safely saves theme changes back to Colors.xaml, Typography.xaml, and DarkTheme.xaml.
        /// Creates timestamped backups for all modified files and preserves XAML comments and formatting.
        /// </summary>
        public static async Task<SaveResult> SaveThemeChangesAsync(
            ThemeModel theme,
            IDictionary<string, string> modifiedColors,
            IDictionary<string, (string Hex, double Opacity)> modifiedBrushes,
            IDictionary<string, (string Family, double Size, string Weight)> modifiedTypography)
        {
            return await Task.Run(() =>
            {
                var result = new SaveResult();
                string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");

                try
                {
                    // 1. Update Colors.xaml
                    if (File.Exists(theme.SourceColorsPath) && (modifiedColors.Count > 0 || modifiedBrushes.Any(b => b.Key.EndsWith("Brush"))))
                    {
                        var backupFile = CreateBackupFile(theme.SourceColorsPath, "Colors", timestamp);
                        result.BackupFiles.Add(backupFile);

                        string content = File.ReadAllText(theme.SourceColorsPath);

                        // Replace Color tags: <Color x:Key="Key">#HEX</Color>
                        foreach (var kvp in modifiedColors)
                        {
                            string key = kvp.Key;
                            string newHex = kvp.Value;
                            var pattern = $@"<Color\s+x:Key=""{Regex.Escape(key)}""\s*>([^<]+)</Color>";
                            content = Regex.Replace(content, pattern, $"<Color x:Key=\"{key}\">{newHex}</Color>");
                        }

                        // Replace SolidColorBrush direct Color attributes in Colors.xaml if any
                        foreach (var kvp in modifiedBrushes)
                        {
                            string key = kvp.Key;
                            string newHex = kvp.Value.Hex;
                            var pattern = $@"<SolidColorBrush\s+x:Key=""{Regex.Escape(key)}""\s+Color=""(#[0-9a-fA-F]+)""";
                            content = Regex.Replace(content, pattern, $"<SolidColorBrush x:Key=\"{key}\" Color=\"{newHex}\"");
                        }

                        File.WriteAllText(theme.SourceColorsPath, content);
                        result.SavedFiles.Add(theme.SourceColorsPath);
                    }

                    // 2. Update Typography.xaml
                    if (File.Exists(theme.SourceTypographyPath) && modifiedTypography.Count > 0)
                    {
                        var backupFile = CreateBackupFile(theme.SourceTypographyPath, "Typography", timestamp);
                        result.BackupFiles.Add(backupFile);

                        string content = File.ReadAllText(theme.SourceTypographyPath);

                        foreach (var kvp in modifiedTypography)
                        {
                            string key = kvp.Key;
                            var info = kvp.Value;

                            // If Double font size: <sys:Double x:Key="Key">14</sys:Double>
                            var patternDouble = $@"<sys:Double\s+x:Key=""{Regex.Escape(key)}""\s*>([^<]+)</sys:Double>";
                            if (Regex.IsMatch(content, patternDouble))
                            {
                                content = Regex.Replace(content, patternDouble, $"<sys:Double x:Key=\"{key}\">{info.Size:0.##}</sys:Double>");
                            }
                        }

                        File.WriteAllText(theme.SourceTypographyPath, content);
                        result.SavedFiles.Add(theme.SourceTypographyPath);
                    }

                    // 3. Update DarkTheme.xaml
                    if (File.Exists(theme.SourceDarkThemePath) && modifiedBrushes.Count > 0)
                    {
                        var backupFile = CreateBackupFile(theme.SourceDarkThemePath, "DarkTheme", timestamp);
                        result.BackupFiles.Add(backupFile);

                        string content = File.ReadAllText(theme.SourceDarkThemePath);

                        foreach (var kvp in modifiedBrushes)
                        {
                            string key = kvp.Key;
                            string newHex = kvp.Value.Hex;
                            double opacity = kvp.Value.Opacity;

                            // Pattern for SolidColorBrush with Color="#HEX" and optional Opacity
                            var pattern = $@"(<SolidColorBrush\s+x:Key=""{Regex.Escape(key)}""\s+Color="")(#[0-9a-fA-F]+)("")";
                            content = Regex.Replace(content, pattern, $"$1{newHex}$3");

                            if (Math.Abs(opacity - 1.0) > 0.001)
                            {
                                var opacityPattern = $@"(<SolidColorBrush\s+x:Key=""{Regex.Escape(key)}""[^>]*Opacity="")([0-9.]+)""";
                                if (Regex.IsMatch(content, opacityPattern))
                                {
                                    content = Regex.Replace(content, opacityPattern, $"${{1}}{opacity:F2}\"");
                                }
                            }
                        }

                        File.WriteAllText(theme.SourceDarkThemePath, content);
                        result.SavedFiles.Add(theme.SourceDarkThemePath);
                    }

                    result.Success = true;
                    result.Message = $"Theme successfully saved. {result.SavedFiles.Count} files updated, {result.BackupFiles.Count} backups created.";
                }
                catch (Exception ex)
                {
                    result.Success = false;
                    result.Message = $"Error saving theme: {ex.Message}";
                }

                return result;
            });
        }

        private static string CreateBackupFile(string originalPath, string name, string timestamp)
        {
            var dir = Path.GetDirectoryName(originalPath) ?? "";
            var backupPath = Path.Combine(dir, $"{name}_backup_{timestamp}.xaml");
            File.Copy(originalPath, backupPath, overwrite: true);
            return backupPath;
        }
    }

    public class SaveResult
    {
        public bool Success { get; set; }
        public string Message { get; set; } = "";
        public List<string> SavedFiles { get; set; } = new();
        public List<string> BackupFiles { get; set; } = new();
    }
}
