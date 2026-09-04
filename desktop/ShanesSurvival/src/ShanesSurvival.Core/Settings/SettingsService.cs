using System.IO;
using System.Text.Json;

namespace ShanesSurvival.Core.Settings;

/// <summary>
/// Loads and saves <see cref="AppSettings"/> to a per-user file outside the repo/source tree,
/// so the Postgres connection string and (later) Plaid keys are never hardcoded and never
/// committed to git. Never log the contents of AppSettings anywhere in this app.
/// </summary>
public sealed class SettingsService
{
    private static readonly string SettingsDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShanesSurvival");

    private static readonly string SettingsFilePath = Path.Combine(SettingsDirectory, "settings.json");

    /// <summary>Real on-disk path settings are read from/written to. Safe to display in the UI.</summary>
    public string SettingsFileDisplayPath => SettingsFilePath;

    public AppSettings Load()
    {
        if (!File.Exists(SettingsFilePath))
        {
            return new AppSettings();
        }

        try
        {
            var json = File.ReadAllText(SettingsFilePath);
            return JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
        }
        catch (Exception)
        {
            // Corrupt/unreadable settings file: fail safe to an empty settings object rather
            // than crash the app on startup. The Settings window will show everything blank
            // and let Shane re-enter values.
            return new AppSettings();
        }
    }

    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(SettingsDirectory);
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(SettingsFilePath, json);
    }
}
