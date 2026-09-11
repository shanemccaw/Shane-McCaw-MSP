using System;
using System.Windows;
using System.Windows.Input;
using BuildConsole.Services;
using BuildConsole.Services.TestPad;

namespace BuildConsole.TestPad
{
    /// <summary>#2698 — "Test Pad: pop-out/expand view for a single note." The notes list row
    /// (<see cref="TestPadWindow.BuildRow"/>) trims each note's <see cref="TestPadNote.Text"/> to a
    /// single ellipsized line, which can't usefully show a large chunk of content (a wide markdown
    /// table, a long paste). This is a real, minimal, view-only pop-out for exactly one note's full
    /// text — same real custom-chrome window pattern already proven by
    /// <see cref="TestPadImportWindow"/> (#2533): <see cref="WindowChromeHelper.Setup"/> from
    /// OnSourceInitialized, resizable, centered on its owner. Renders via a read-only
    /// <c>TextBox</c> with <c>TextWrapping="NoWrap"</c> + both scrollbars rather than word-wrapping —
    /// a wrapped wide markdown table reads as garbage, whereas NoWrap + horizontal scroll keeps its
    /// column alignment intact and legible. Read/view only, per the issue's own scope note; editing
    /// stays in the existing composer edit-in-place flow on the main pad.</summary>
    public partial class TestPadNoteDetailWindow : Window
    {
        private TestPadNote? _note;

        private TestPadNoteDetailWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        /// <summary>#2715 — shows the pop-out as a non-modal, always-on-top floaty, owner-scoped
        /// to the Test Pad, for one note's full text. Same real convention
        /// <see cref="StickyNotesWindow"/> already uses (Topmost="True" in XAML + a plain
        /// <c>.Show()</c>, never <c>ShowDialog</c>) so it no longer blocks the owner (or the whole
        /// app) while open. Title/meta line mirror the same type-tag vocabulary
        /// <see cref="TestPadSendFormatter"/> already uses so the pop-out reads consistently with
        /// every other Test Pad surface.</summary>
        public static void ShowFor(Window? owner, TestPadNote note)
        {
            var dlg = new TestPadNoteDetailWindow { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg._note = note;

            dlg.TitleText.Text = $"[{TypeTag(note.Type)}] Note";
            dlg.MetaText.Text = BuildMetaLine(note);
            dlg.BodyText.Text = note.Text;
            dlg.RenderNote();

            dlg.Show();
        }

        /// <summary>Renders <see cref="_note"/>'s current text into the Rendered view, wiring
        /// <see cref="MarkdownRenderer.RenderOptions.OnTaskToggled"/> so a real checklist item's
        /// checkbox is clickable — #2706 — and, as of #3685,
        /// <see cref="MarkdownRenderer.RenderOptions.OnFileClick"/> /
        /// <see cref="MarkdownRenderer.RenderOptions.OnRevealInFolder"/> so a real doc-path
        /// reference in a note (a FileLink, or an implicit path-like inline-code span) opens in
        /// BuildConsole's own markdown-preview tab / reveals in Explorer, the exact same real
        /// pattern already proven in <c>GitDetailView</c>/<c>IssueDetailView</c>. Called both from
        /// <see cref="ShowFor"/> and again after a toggle persists, so the row's strikethrough
        /// reflects the new state immediately.</summary>
        private void RenderNote()
        {
            if (_note == null) return;
            RenderedContent.Content = MarkdownRenderer.Render(_note.Text, new MarkdownRenderer.RenderOptions
            {
                OnTaskToggled = OnTaskToggled,
                OnFileClick = async fileName => await OpenNotePathAsync(fileName, reveal: false),
                OnRevealInFolder = async fileName => await OpenNotePathAsync(fileName, reveal: true)
            });
        }

        /// <summary>#3685 — real, shared resolve-then-act for both a doc-path click (open in
        /// BuildConsole's own <see cref="MainWindow.OpenFileTab"/> markdown-preview tab) and a
        /// "Reveal in Explorer" context-menu action, reusing the identical real resolution pattern
        /// already proven in <c>GitDetailView</c>/<c>IssueDetailView</c>: resolve a relative path
        /// against the repo root (a direct combine, then the same common-subdirectory probe, then a
        /// pruned breadth-first search by filename), then act on whichever real path resolves.</summary>
        private static async System.Threading.Tasks.Task OpenNotePathAsync(string fileName, bool reveal)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return;

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            string fullPath = fileName.Replace("/", "\\");
            if (!System.IO.Path.IsPathRooted(fullPath) && repoRoot != null)
            {
                fullPath = System.IO.Path.Combine(repoRoot, fullPath);
            }

            if (!System.IO.File.Exists(fullPath) && repoRoot != null)
            {
                fullPath = await System.Threading.Tasks.Task.Run(() =>
                {
                    var commonDirs = new[]
                    {
                        "client/src", "client/src/components", "client/src/pages", "client/src/lib", "client",
                        "server", "server/routes", "server/services",
                        "desktop/BuildConsole/Controls", "desktop/BuildConsole/Services", "desktop/BuildConsole/TestPad", "desktop/BuildConsole", "desktop",
                        "src", "src/components", "src/pages", "src/services",
                        "migrations", "test-manifests", "scripts", "docs", "build-journal"
                    };
                    string justName = System.IO.Path.GetFileName(fileName);
                    foreach (var rel in commonDirs)
                    {
                        string candidate = System.IO.Path.Combine(repoRoot, rel, fileName.Replace("/", "\\"));
                        if (System.IO.File.Exists(candidate)) return candidate;
                        string candidateByName = System.IO.Path.Combine(repoRoot, rel, justName);
                        if (System.IO.File.Exists(candidateByName)) return candidateByName;
                    }

                    var queue = new System.Collections.Generic.Queue<string>();
                    queue.Enqueue(repoRoot);
                    while (queue.Count > 0)
                    {
                        var current = queue.Dequeue();
                        try
                        {
                            foreach (var file in System.IO.Directory.GetFiles(current, justName)) return file;
                            foreach (var dir in System.IO.Directory.GetDirectories(current))
                            {
                                var name = System.IO.Path.GetFileName(dir);
                                if (name is "node_modules" or ".git" or "bin" or "obj" or ".next") continue;
                                queue.Enqueue(dir);
                            }
                        }
                        catch { }
                    }
                    return fullPath;
                });
            }

            if (!System.IO.File.Exists(fullPath)) return;

            if (reveal)
            {
                try { System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{fullPath}\""); }
                catch { }
            }
            else if (Application.Current.MainWindow is MainWindow mWindow)
            {
                mWindow.OpenFileTab(fullPath);
            }
        }

        /// <summary>#2706 — flips one checklist line's `- [ ]`/`- [x]` marker in the note's real
        /// underlying text (by the real line index the renderer's click callback carries), persists
        /// it via <see cref="TestPadService.UpdateNote"/>, and re-renders so the row's strikethrough
        /// updates immediately. A no-op if the note is already sent (locked — the same rule
        /// <see cref="TestPadService.UpdateNote"/> itself enforces) or the targeted line no longer
        /// parses as a task item.</summary>
        private void OnTaskToggled(int lineIndex, bool newChecked)
        {
            if (_note == null || _note.IsSent) return;

            string? updated = MarkdownRenderer.ToggleTaskLine(_note.Text, lineIndex, newChecked);
            if (updated == null) return;

            TestPadService.UpdateNote(_note.Id, updated, _note.Type);
            _note.Text = updated;
            BodyText.Text = updated;
            RenderNote();
        }

        /// <summary>#2705 — Rendered/Raw toggle. Behaves like a two-state radio group (exactly one
        /// checked) even though each is a plain <see cref="System.Windows.Controls.Primitives.ToggleButton"/>
        /// reusing the existing <c>FilterChip</c> style, not a RadioButton pair.</summary>
        private void ViewModeToggle_Click(object sender, RoutedEventArgs e)
        {
            bool showRendered = ReferenceEquals(sender, BtnRenderedView);
            BtnRenderedView.IsChecked = showRendered;
            BtnRawView.IsChecked = !showRendered;
            RenderedScroll.Visibility = showRendered ? Visibility.Visible : Visibility.Collapsed;
            RawScroll.Visibility = showRendered ? Visibility.Collapsed : Visibility.Visible;
        }

        private static string TypeTag(NoteType type) => type switch
        {
            NoteType.Bug => "BUG",
            NoteType.Question => "QUESTION",
            NoteType.Idea => "IDEA",
            NoteType.Works => "WORKS",
            _ => "NOTE",
        };

        private static string BuildMetaLine(TestPadNote note)
        {
            var parts = new System.Collections.Generic.List<string>();
            if (!string.IsNullOrWhiteSpace(note.Feature)) parts.Add(note.Feature!);
            if (!string.IsNullOrWhiteSpace(note.Screen)) parts.Add(note.Screen!);
            if (note.BuildNumber.HasValue) parts.Add($"Build #{note.BuildNumber.Value}");
            parts.Add(note.CreatedAt.ToLocalTime().ToString("MMM d, h:mm tt"));
            if (note.IsSent) parts.Add("SENT");
            return string.Join(" · ", parts);
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape) Close();
        }
    }
}
