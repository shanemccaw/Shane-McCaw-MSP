using System;
using System.Windows;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole;

/// <summary>
/// Git #4808 — Notifications bell, LinkedIn Post, Git Doctor and Microsoft Graph API Panel used to
/// live on the ActivityBar (left rail); they now sit in the top QAT strip in MainWindow.xaml. This is
/// a pure relocation: every handler below calls the exact same code the ActivityBar button used to
/// raise an event for (ToggleLinkedInComposer, OpenGitDoctorTab, the ActivityBar_ActiveViewChanged
/// "GraphApi" sidebar toggle, NotificationTrayPanel.Refresh).
/// </summary>
public partial class MainWindow
{
    /// <summary>Git #3880 — reflect current bookmarked-state on load, then keep it live: any mutation
    /// from the tray itself or a floating toast's own bookmark button (#3878) fires
    /// NotificationHistoryStore.Changed, so the bell never goes stale even while the popout is closed.</summary>
    private void InitQatNotificationBell()
    {
        UpdateNotificationBellColor();
        NotificationHistoryStore.Changed += NotificationHistoryStore_Changed;
        Closed += (_, _) => NotificationHistoryStore.Changed -= NotificationHistoryStore_Changed;
    }

    private void NotificationHistoryStore_Changed(object? sender, EventArgs e)
    {
        // Store's Changed event can fire from a background thread; hop to the UI thread.
        Dispatcher.Invoke(UpdateNotificationBellColor);
    }

    /// <summary>Git #3880 — color is the ONLY signal on the bell (explicitly no count/badge, per
    /// Shane's repeated ask): accent when at least one bookmarked entry exists, neutral otherwise.</summary>
    private void UpdateNotificationBellColor()
    {
        var hasBookmarks = NotificationHistoryStore.Bookmarked.Count > 0;
        NotificationBellGlyph.Foreground = (Brush)FindResource(hasBookmarks ? "PeachBrush" : "Subtext1Brush");
    }

    /// <summary>Opens the #3879 tray panel in an anchored popout, reloading its real content fresh
    /// every open.</summary>
    private void BtnNotifications_Click(object sender, RoutedEventArgs e)
    {
        NotificationTray.Refresh();
        NotificationsPopup.IsOpen = true;
    }

    /// <summary>Git #973 — toggles the always-on-top LinkedIn post pre-fill floaty.</summary>
    private void BtnLinkedInComposer_Click(object sender, RoutedEventArgs e) => ToggleLinkedInComposer();

    /// <summary>Git #2809 — opens Git Doctor as a full-width Editor tab.</summary>
    private void BtnGitDoctor_Click(object sender, RoutedEventArgs e) => OpenGitDoctorTab();

    /// <summary>Toggles the Microsoft Graph API panel in the LeftSidebar. Routes through the same
    /// handler the ActivityBar's radio buttons use, so the behavior is unchanged from when this was
    /// a "GraphApi" RadioButton: open/expand the sidebar on the Graph view, or collapse it when the
    /// Graph view is already the active one.</summary>
    private void BtnGraphApi_Click(object sender, RoutedEventArgs e) => ActivityBar_ActiveViewChanged(this, "GraphApi");
}
