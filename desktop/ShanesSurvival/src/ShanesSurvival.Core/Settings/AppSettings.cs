namespace ShanesSurvival.Core.Settings;

/// <summary>
/// Locally-persisted app settings. Never hardcoded into source, never logged.
/// Stored as JSON under %AppData%\ShanesSurvival\settings.json — see <see cref="SettingsService"/>.
/// </summary>
public sealed class AppSettings
{
    /// <summary>Full Npgsql connection string for the local ShanesSurvival Postgres database.</summary>
    public string? PostgresConnectionString { get; set; }

    public string? PlaidClientId { get; set; }
    public string? PlaidSecret { get; set; }
    public string? PlaidEnvironment { get; set; } = "sandbox";

    // Plaid requires a stable per-user identifier (client_user_id) on every /link/token/create
    // call — stable across relinks/reconnects so update-mode Link works. This app has exactly
    // one real user (Shane), so one GUID is generated once (PlaidLinkService, on first Link
    // attempt) and persisted here rather than hardcoded.
    public string? PlaidClientUserId { get; set; }
}
