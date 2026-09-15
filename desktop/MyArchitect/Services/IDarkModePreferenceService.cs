namespace MyArchitect.Services;

/// <summary>
/// #4274 — persisted local-only preference for the portal dark-mode toggle. Holds only the seed
/// value for a *newly-opened* tab's initial <see cref="Models.PortalTabItem.IsDarkMode"/>; once a
/// tab is open, its own dark-mode state is independent and this preference does not follow it
/// back. Default is on; once the operator turns it off, it stays off (across tabs and restarts)
/// until turned back on.
/// </summary>
public interface IDarkModePreferenceService
{
    bool IsDarkModeEnabled { get; }

    void SetDarkModeEnabled(bool enabled);
}
