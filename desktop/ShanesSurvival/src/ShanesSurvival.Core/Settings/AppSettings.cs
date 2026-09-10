namespace ShanesSurvival.Core.Settings;

/// <summary>
/// Locally-persisted app settings. Never hardcoded into source, never logged.
/// Stored as JSON under %AppData%\ShanesSurvival\settings.json — see <see cref="SettingsService"/>.
/// </summary>
public sealed class AppSettings
{
    /// <summary>Full Npgsql connection string for the local ShanesSurvival Postgres database.</summary>
    public string? PostgresConnectionString { get; set; }

    // Shane's Life (web/shanes-life) real remote MCP endpoint (Git #3288) — the weekly-ad
    // scraper's own real, existing pipeline for push_deals/push_coupons. ApiBaseUrl is the
    // deployment's real public origin (e.g. the Replit URL), never localhost in normal use since
    // this WPF app and that deployment are not on the same machine. Mint the token with
    // `npm run issue-mcp-token` against that deployment, or from its own Settings screen.
    public string? ShanesLifeApiBaseUrl { get; set; }
    public string? ShanesLifeMcpToken { get; set; }
}
