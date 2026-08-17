using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Focus Mode — the immersive full-screen view's shell integration (kept in its own partial so the
    /// original <see cref="MainWindow"/>.FocusMode.cs stays focused on the bar + filter + context work).
    ///
    /// This hosts the window-covering <see cref="FocusImmersiveView"/> overlay, toggles it on
    /// <see cref="FocusModeService.ImmersiveChanged"/> (with a soft fade), feeds it the shell-only bits it
    /// can't reach itself (the queue watcher for the centre build's live transcript, a queue-items probe,
    /// and open-issue / open-milestone / open-Build-Watch / take-suggestion actions), wires the real
    /// celebration signals (a build finishing, issues closing, an achievement unlocking), owns the
    /// Ctrl+Shift+F toggle hotkey, and provides the gentle distraction-recovery nudge (leave the immersive
    /// view while still focused → one soft, dismissible toast pointing the way back — never a nag).
    /// </summary>
    public partial class MainWindow
    {
        private FocusImmersiveView? _immersive;
        private DispatcherTimer? _focusNudgeTimer;

        /// <summary>Called once at the tail of <c>InitFocusMode()</c> (so the service is already started and
        /// its persisted state — including whether the immersive view was engaged — is loaded).</summary>
        private void InitFocusImmersive()
        {
            try
            {
                _immersive = new FocusImmersiveView();
                _immersive.Init(
                    _queueWatcher,
                    () => BuildQueuePanel.CurrentQueueItems,
                    // Local #47 — a linked child's real chat loads into the immersive centre
                    // panel IN PLACE (same WebView2 session the normal tabs use), staying
                    // immersive; this no longer exits to the normal tab bar.
                    buildChatView: BuildImmersiveChatView,
                    buildChatViewForChat: BuildChatWebView,
                    findChatByConversationId: LeftSidebar.FindChatByConversationId,
                    openMilestone: n => { FocusModeService.Instance.ExitImmersive(); OnFocusMilestoneOpen(n); },
                    openBuildWatch: OpenOrFocusBuildWatch,
                    takeSuggestion: s => { FocusModeService.Instance.ExitImmersive(); OnFocusSuggestionActivated(s); });

                InsertImmersiveOverlay(_immersive);

                FocusModeService.Instance.ImmersiveChanged += OnFocusImmersiveChanged;

                // Real-event celebrations — only while the immersive view is actually engaged.
                if (_queueWatcher != null)
                    _queueWatcher.BuildFinished += OnFocusImmersiveBuildFinished;
                FocusModeService.Instance.MilestoneIssuesClosed += (n, _) =>
                    Dispatcher.Invoke(() => { if (FocusModeService.Instance.ImmersiveActive) _immersive?.CelebrateIssuesClosed(n); });
                FocusModeService.Instance.AchievementUnlocked += a =>
                    Dispatcher.Invoke(() => { if (FocusModeService.Instance.ImmersiveActive) _immersive?.CheerAchievement(a); });

                // Ctrl+Shift+F toggles the immersive view. Added as an extra PreviewKeyDown handler so no
                // MainWindow.xaml edit is needed (the combo is otherwise unused in this app).
                PreviewKeyDown += FocusImmersiveHotkey;

                // Resume where he left off: if the immersive view was engaged at last close (and a milestone
                // is still focused), bring it straight back up.
                if (FocusModeService.Instance.ImmersiveActive) ShowImmersive();

                ActivityLog.Log("focus-mode", "immersive view wired into the shell");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"InitFocusImmersive failed: {ex.Message}");
            }
        }

        /// <summary>Add the overlay as a direct child of MainWindow's root Grid (sibling to the frame
        /// DockPanel, exactly like the TabSwitcher / CommandPalette / Startup overlays), at a high ZIndex so
        /// it covers the entire client area — title bar and status bar included — when shown.</summary>
        private void InsertImmersiveOverlay(FocusImmersiveView view)
        {
            var root = Content as Grid;
            if (root == null) return;
            Panel.SetZIndex(view, 15000);
            view.Visibility = Visibility.Collapsed;
            view.Opacity = 0;
            root.Children.Add(view);
        }

        private void OnFocusImmersiveChanged()
        {
            Dispatcher.Invoke(() =>
            {
                if (_immersive == null) return;
                if (FocusModeService.Instance.ImmersiveActive) { CancelFocusNudge(); ShowImmersive(); }
                else { HideImmersive(); StartFocusNudge(); }
            });
        }

        private void ShowImmersive()
        {
            if (_immersive == null) return;
            CancelFocusNudge();
            // Collapse the whole app frame (title bar + sidebar + editor panes + queue) while immersive.
            // This is BOTH the vision ("full-screen zoom on only what I'm working") AND the robust fix for
            // WPF airspace: the editor chat WebView2s are HwndHosts that would otherwise punch through and
            // render ON TOP of this WPF overlay regardless of z-order. Collapsing their host removes that
            // airspace entirely, so the immersive view is genuinely the only thing on screen.
            var frame = FrameDockPanel();
            if (frame != null) frame.Visibility = Visibility.Collapsed;

            _immersive.Opacity = 0;
            _immersive.Visibility = Visibility.Visible;
            _immersive.Activate();
            _immersive.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)));
        }

        private void HideImmersive()
        {
            if (_immersive == null) return;
            var frame = FrameDockPanel();
            var v = _immersive;
            var fade = new DoubleAnimation(v.Opacity, 0, TimeSpan.FromMilliseconds(150));
            fade.Completed += (_, _) =>
            {
                v.Visibility = Visibility.Collapsed;
                v.Deactivate();
                if (frame != null) frame.Visibility = Visibility.Visible; // restore the normal shell
            };
            v.BeginAnimation(UIElement.OpacityProperty, fade);
        }

        /// <summary>The app's frame DockPanel (title bar + status bar + the sidebar/editor/queue layout) —
        /// the same one the FocusModeBar is docked into. Found the same way InsertFocusBar finds it.</summary>
        private DockPanel? FrameDockPanel()
            => (Content as Grid)?.Children.OfType<DockPanel>().FirstOrDefault();

        // ---- gentle distraction recovery -------------------------------

        /// <summary>Left the immersive view but the milestone is still focused — the "got distracted" case.
        /// After a short grace period, if he hasn't come back on his own, show ONE soft, dismissible toast
        /// pointing the way back (never a modal, never repeated). Reusing the context snapshot: re-entering
        /// restores the same epic he was on.</summary>
        private void StartFocusNudge()
        {
            CancelFocusNudge();
            if (!FocusModeService.Instance.IsActive) return; // fully deactivated — nothing to nudge back to
            _focusNudgeTimer = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
            {
                Interval = TimeSpan.FromSeconds(25)
            };
            _focusNudgeTimer.Tick += (_, _) =>
            {
                CancelFocusNudge();
                var svc = FocusModeService.Instance;
                if (svc.IsActive && !svc.ImmersiveActive)
                {
                    ToastEngine.Info($"🎯 Still on “{svc.ActiveMilestoneTitle}”?",
                        "Your focus session is paused. Press Ctrl+Shift+F to jump right back in where you left off.");
                    ActivityLog.Log("focus-mode", "gentle distraction nudge shown — left the immersive view while still focused");
                }
            };
            _focusNudgeTimer.Start();
        }

        private void CancelFocusNudge()
        {
            _focusNudgeTimer?.Stop();
            _focusNudgeTimer = null;
        }

        // ---- real-event celebration bridge -----------------------------

        private void OnFocusImmersiveBuildFinished(int id, string title, int exitCode)
        {
            Dispatcher.Invoke(() =>
            {
                var svc = FocusModeService.Instance;
                if (_immersive == null || !svc.ImmersiveActive) return;
                // Celebrate builds tied to the focused epic. If the finished item is already gone from the
                // queue snapshot we can't tell — a finish is still a win, so celebrate; only skip when we can
                // positively see it's an OFF-epic build.
                var item = BuildQueuePanel.CurrentQueueItems.FirstOrDefault(i => i.Id == id);
                if (item != null && !svc.IsIssueInActiveMilestone(item.GithubNumber)) return;
                _immersive.CelebrateBuildFinished(title, exitCode == 0);
            });
        }

        private void OpenOrFocusBuildWatch()
        {
            try
            {
                if (_buildWatch == null) ToggleBuildWatch(); // opens it (Closed handler nulls the ref)
                else _buildWatch.Activate();
            }
            catch (Exception ex) { ActivityLog.Log("focus-mode", $"open Build Watch from immersive failed: {ex.Message}"); }
        }

        private void FocusImmersiveHotkey(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.F
                && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control
                && (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift)
            {
                FocusModeService.Instance.ToggleImmersive();
                e.Handled = true;
            }
        }
    }
}
