using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3622 — Ctrl+K opens the new <see cref="CommandPaletteWindow"/> (the
    /// Smart All / category-tab / two-pane dialog shell), replacing the retired
    /// title-bar dropdown that lived in MainWindow.UniversalSearch.cs (decision
    /// recorded on the issue, 2026-09-11: rebind immediately, old search deleted).
    /// Kept as its own partial-class file, same as its predecessor, to stay clear
    /// of the concurrently edited MainWindow.xaml.cs.
    /// </summary>
    public partial class MainWindow
    {
        private CommandPaletteWindow? _commandPaletteWindow;

        /// <summary>Ctrl+K — toggle the command palette window.</summary>
        private void ToggleCommandPalette()
        {
            if (_commandPaletteWindow != null)
            {
                // Normally unreachable (losing focus already closes it), but keeps
                // the binding a true toggle if that ever changes.
                try { _commandPaletteWindow.Close(); } catch { }
                _commandPaletteWindow = null;
                return;
            }

            var win = CreateCommandPaletteWindow();
            win.Show();
        }

        /// <summary>
        /// Git #3829 — Ctrl+D's real entry point: opens (or reactivates) the same real Command
        /// Center window Ctrl+K does, forced straight into Dispatch mode (type an issue number →
        /// Enter dispatches the real, chain-aware component Git #3858 resolves → Enter again
        /// starts it → Esc closes) — supersedes #3553's own separate Ctrl+D binding, which opened
        /// a standalone DispatchDialog instead of this window (confirmed via direct code read
        /// before claiming the key, per this issue's own explicit instruction).
        /// </summary>
        private void OpenCommandPaletteDispatchMode()
        {
            if (_commandPaletteWindow != null)
            {
                _commandPaletteWindow.Activate();
                _commandPaletteWindow.EnterDispatchMode();
                return;
            }

            var win = CreateCommandPaletteWindow();
            win.EnterDispatchMode();
            win.Show();
        }

        /// <summary>Shared construction for both the normal Ctrl+K open and Ctrl+D's forced
        /// Dispatch-mode open — every wiring/positioning step below applies identically to both;
        /// only the caller decides whether <see cref="CommandPaletteWindow.EnterDispatchMode"/>
        /// runs afterward.</summary>
        private CommandPaletteWindow CreateCommandPaletteWindow()
        {
            var win = new CommandPaletteWindow(
                BuildPaletteCommands(), BuildTrackerApi, LeftSidebar.GetAllEpics(), QueueDb, QueueWatcher)
            { Owner = this };

            // Git #3850 — the epic-*name* matching branch (sibling #3831 covers epic/issue
            // number smart detection). Reuses OpenOrCreateEpicChat(int) verbatim — the same
            // real open-or-create flow (FindChatForIssue's real "latest chat" lookup, falling
            // back to a new epic chat) every other epic chat entry point already uses.
            win.EpicOpenRequested += (_, epicNumber) => OpenOrCreateEpicChat(epicNumber);

            // Git #3855 — the general free-text fallback's Issue/Epic result rows reuse the
            // exact same real "open by number" entry point tab-to-tab navigation inside a
            // detail tab already calls (OpenGitDetailByNumberAsync itself resolves Epic vs.
            // Issue and focuses an existing tab before opening a new one) — never a second
            // open-by-number mechanism.
            win.GitDetailOpenRequested += async (_, number) => await OpenGitDetailByNumberAsync(number);

            // Git #3855 — a Chat result row's real bt_chats.id looked up against the
            // currently-loaded board's own real chat list (no second chat-lookup mechanism),
            // then opened via the existing OpenChatTab path (same as #3850's epic-chat open).
            win.ChatOpenRequested += (_, chatId) =>
            {
                var chat = LeftSidebar.CurrentBoardChats.FirstOrDefault(c => c.Id == chatId);
                if (chat != null)
                    OpenChatTab(chat, chat.IssueGithubNumber);
                else
                    ToastEngine.Warning("Command Center", $"Chat #{chatId} isn't in the currently-loaded board — try refreshing the Git panel.");
            };

            // Git #3828 — SQL results panel's "Send to Chat" reuses the exact same shared
            // SendTextToActiveClaudeChatAsync path the SQL Runner floaty's own Send to Chat
            // already uses (#937/#940) — never a second mechanism. The palette itself has no
            // inline status strip, so the outcome surfaces as a toast instead.
            win.SqlSendToChatRequested += async (_, text) =>
                await SendTextToActiveClaudeChatAsync(
                    text,
                    showMessage: (msg, isError) =>
                    {
                        if (isError) ToastEngine.Warning("Command Center", msg);
                        else ToastEngine.Success("Command Center", msg);
                    },
                    onInserted: null,
                    logChannel: "command-palette.sql.send-to-chat",
                    whatSingular: "SQL results");

            // Center horizontally over this window's REAL on-screen bounds and sit
            // near the top, palette-style. Left/Top on a maximized WPF window still
            // report the pre-maximized rect, so read the actual origin instead.
            try
            {
                var originDevice = PointToScreen(new Point(0, 0));
                var dpi = VisualTreeHelper.GetDpi(this);
                double leftDip = originDevice.X / dpi.DpiScaleX;
                double topDip = originDevice.Y / dpi.DpiScaleY;
                win.Left = leftDip + (ActualWidth - win.Width) / 2;
                win.Top = topDip + 48;
            }
            catch
            {
                win.WindowStartupLocation = WindowStartupLocation.CenterOwner;
            }

            win.Closed += (_, _) => _commandPaletteWindow = null;
            _commandPaletteWindow = win;
            return win;
        }

        /// <summary>Clicking the title-bar search pill opens the palette.</summary>
        private void SearchBorder_MouseDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            ToggleCommandPalette();
        }

        /// <summary>
        /// The palette's quick-action commands — each one fires a real, existing
        /// BuildConsole feature (no stub pretending to succeed). These also render
        /// as the tile row per the reference screenshot.
        /// </summary>
        private List<CommandPaletteWindow.PaletteCommand> BuildPaletteCommands() => new()
        {
            new CommandPaletteWindow.PaletteCommand
            {
                Glyph = "\uE895", // Sync
                Title = "Git Pull",
                Subtitle = "Run git pull in the dev-server checkout",
                DetailBody = "Runs a real `git pull` against the main dev-server checkout — the same "
                           + "action as the Git panel's own Pull button. The real result shows right "
                           + "here once it finishes, plus a quick toast and the Git panel's own status "
                           + "readout (same real text, same real source).",
                ActionLabel = "Run Git Pull",
                RunWithResult = RunPaletteGitPullWithResultAsync,
            },
            new CommandPaletteWindow.PaletteCommand
            {
                Glyph = "\uE77F", // Paste
                Title = "Paste Manual Build",
                Subtitle = "Paste a full build prompt (with --flags) into the queue",
                DetailBody = "Opens the real Edit Build Prompt dialog with an empty prompt — paste a "
                           + "full BUILD comment (headers + body) and choose Add to Build Queue or "
                           + "Send to Builder, exactly like the Build Queue header's paste button "
                           + "(Git #1480).",
                ActionLabel = "Paste Manual Build",
                Run = () => _ = OpenBuildPromptDialogAsync("", null),
            },
            new CommandPaletteWindow.PaletteCommand
            {
                Glyph = "\uE777", // UpdateRestore
                Title = "Recover Builds",
                Subtitle = "Re-queue crashed/orphaned builds from the queue",
                DetailBody = "Re-queues every crashed/orphaned build (the failed rows the orphan sweep "
                           + "marked with its known crash sentinel), resuming each original session "
                           + "where one exists — the same real recovery the Build Queue's own "
                           + "\"Recover All\" banner runs. If there is nothing to recover, it says so "
                           + "honestly.",
                ActionLabel = "Recover Builds",
                RunWithResult = () => BuildQueuePanel.RecoverOrphanedBuildsWithResultAsync(),
            },
            new CommandPaletteWindow.PaletteCommand
            {
                Glyph = "", // UpdateRestore
                Title = "deploy-shanesbuild.cmd",
                Subtitle = "Rebuild Release & relaunch BuildConsole — same as the Update button",
                DetailBody = "Runs the real desktop\\BuildConsole\\deploy-shanesbuild.cmd (Process.Start, "
                           + "detached console window) — the exact same RunDeployScript() the title-bar "
                           + "Update button already calls. It rebuilds Release, stops the running "
                           + "instance and relaunches it; its own relaunch replaces this process, so "
                           + "nothing further happens here. Not gated on the Build Queue (Git #1934) — "
                           + "in-flight builds survive the restart via #1804's durable-file redirect + "
                           + "pid-adoption, so this runs immediately regardless of active builds.",
                ActionLabel = "Run deploy-shanesbuild.cmd",
                Run = () => RunDeployScript(),
            },
        };

        /// <summary>Git #3826 — runs the sidebar's real git pull and returns its real,
        /// actual output (Stdout/Stderr combined — same real text the Git panel's own
        /// <c>GitStatusSummaryText.ToolTip</c> gets) for the palette's right pane to show
        /// inline, plus the existing quick toast (kept, not replaced).</summary>
        private async System.Threading.Tasks.Task<string> RunPaletteGitPullWithResultAsync()
        {
            var result = await LeftSidebar.RunGitPullWithResultAsync();

            if (result.Success)
                ToastEngine.Success("Git Pull", "git pull finished — details in the Git panel.");
            else
                ToastEngine.Warning("Git Pull", "git pull failed — see the Git panel's status line for the real error.");

            string full = $"{result.Stdout}\n{result.Stderr}".Trim();
            if (string.IsNullOrWhiteSpace(full))
                full = result.Success ? "git pull succeeded (no output)." : $"git pull failed (exit {result.ExitCode}), no output.";
            return full;
        }
    }
}
