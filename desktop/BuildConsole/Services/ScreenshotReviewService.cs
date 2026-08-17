using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;

namespace BuildConsole.Services
{
    /// <summary>Identity of the thing whose screenshots are being reviewed: the (area, slug) that keys
    /// its baseline folder plus the GitHub issue/title it traces back to. For a manifest run this is
    /// derived from the manifest's own on-disk path + issue number (see
    /// <see cref="ScreenshotReviewService.SubjectFromManifest"/>); a future producer (e.g. a mailer
    /// audit) builds its own subject and calls the same service.</summary>
    public sealed class ScreenshotReviewSubject
    {
        public string Area { get; set; } = "_unsorted";
        public string Slug { get; set; } = "";
        public int IssueNumber { get; set; }
        public string Title { get; set; } = "";
        public string DisplayName => $"{Area}/{Slug}";
    }

    /// <summary>One screenshot's row in the review dialog: the #966 capture + its baseline comparison,
    /// with the narration fields the walk-through window renders (what was verified, pass/fail, diff).</summary>
    public sealed class ScreenshotReviewItem
    {
        public UiScreenshotCapture Shot { get; set; } = new();
        public ScreenshotBaselineStore.Comparison Comparison { get; set; } = new();

        public int StepIndex => Shot.StepIndex;
        public string CurrentPath => Shot.FilePath;
        public string BaselinePath => Comparison.BaselinePath;
        public bool HasBaseline => Comparison.HasBaseline;
        public bool NeedsReview => Comparison.NeedsReview;
        public string DiffNote => Comparison.Note;

        /// <summary>#966 captures on any step failure ("step-failed"/"navigation-failed") or an explicit
        /// opt-in ("explicit"); the reason IS the pass/fail signal for this screenshot.</summary>
        public bool Passed => Shot.Reason != "step-failed" && Shot.Reason != "navigation-failed";
        public string Verdict => Passed ? "PASS" : "FAIL";
        public string What => string.IsNullOrWhiteSpace(Shot.StepLabel) ? $"step {StepIndex}" : Shot.StepLabel;
        public string Reason => Shot.Reason;
    }

    /// <summary>Outcome of evaluating a run's screenshots against their baselines. Carries #975's exact
    /// review decision (<see cref="NeedsReview"/> = <c>items.Any(i =&gt; i.NeedsReview)</c>) plus, for an
    /// interactive run that does need review, a DEFERRED <see cref="ShowReviewDialog"/> action. The dialog
    /// is no longer popped inline (that interrupted Shane mid-run) — the caller invokes it later from the
    /// "run needs attention" toast's click-through, so a routine run never blocks on a modal.</summary>
    public sealed class ScreenshotReviewResult
    {
        /// <summary>#975's exact condition — true when at least one shot has no baseline or a meaningful
        /// diff vs its baseline. This is the same signal that used to gate showing the review dialog.</summary>
        public bool NeedsReview { get; init; }
        /// <summary>How many shots had no baseline yet (new).</summary>
        public int NoBaseline { get; init; }
        /// <summary>How many shots differed from an existing baseline.</summary>
        public int Diffs { get; init; }
        /// <summary>How many shots were compared in total.</summary>
        public int ItemCount { get; init; }
        /// <summary>Non-null ONLY for an interactive run that needs review: invoking it (on the UI thread)
        /// pops the modal <see cref="ScreenshotReviewWindow"/> with the full Approve flow intact (promote
        /// baselines → landed-and-verified chat note → close the linked issue). Null for a clean run, or a
        /// non-interactive (scheduled #967 / remote #898) run whose dialog stays suppressed.</summary>
        public Action? ShowReviewDialog { get; init; }

        /// <summary>The "nothing to review" result (no shots, or none on disk).</summary>
        public static readonly ScreenshotReviewResult None = new();
    }

    /// <summary>
    /// Epic #803 — the single entry point EVERY screenshot-producing run funnels through to get its
    /// captures reviewed against the persistent baseline (<see cref="ScreenshotBaselineStore"/>). The
    /// #966 uiSteps run is the only producer today; a future mailer audit, or any other run that
    /// captures screenshots, calls this same method with its own <see cref="ScreenshotReviewSubject"/>
    /// + captured shots, so the whole feature applies to all of them by construction rather than being
    /// re-implemented per producer.
    ///
    /// It compares each shot against its stored baseline and, ONLY when a baseline is missing or a
    /// meaningful visual diff is found, marks the run as needing review and hands back a DEFERRED action
    /// that pops the walk-through review/approval dialog (<see cref="ScreenshotReviewWindow"/>). The dialog
    /// is no longer shown inline (it interrupted Shane mid-run) — the caller pops it from the "run needs
    /// attention" toast's click-through. A clean run that matches its baseline needs no review, shows nothing.
    /// Non-interactive runs (the scheduled #967 regression sweep, the #898 headless remote-trigger)
    /// never block on a modal — they log that review is pending so a background/3am run can't hang.
    ///
    /// Approve does three things, in order: promote the run's screenshots to the baseline set, send a
    /// landed-and-verified note into the active Claude chat (the #937 send-to-active-chat mechanism),
    /// and close the manifest's associated GitHub issue. Report issue reuses the same #937 compose +
    /// send-to-active-chat, pre-seeded with the diff context. Logs on "testing.screenshot-review".
    /// </summary>
    public static class ScreenshotReviewService
    {
        public const string Channel = "testing.screenshot-review";

        /// <summary>Traces a manifest to its review subject: (area, slug) come from the manifest's real
        /// on-disk path under test-manifests/ (the same {area}/{feature-slug} convention CLAUDE.md's
        /// Test Coverage section uses), and the issue/title come straight off the manifest — so the
        /// baseline folder and the "which issue does Approve close" association are both grounded in the
        /// manifest itself, not guessed.</summary>
        public static ScreenshotReviewSubject SubjectFromManifest(TestManifest manifest, string repoRoot)
        {
            string area = "_unsorted";
            string slug = "";
            try
            {
                if (!string.IsNullOrEmpty(manifest.SourcePath))
                {
                    string manifestsRoot = Path.Combine(repoRoot, "test-manifests");
                    string rel = Path.GetRelativePath(manifestsRoot, manifest.SourcePath);
                    var parts = rel.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2 && parts[0] != "..")
                    {
                        area = parts[0];
                        slug = Path.GetFileNameWithoutExtension(parts[^1]);
                    }
                    else if (parts.Length >= 1)
                    {
                        // Old flat test-manifests/{issue}-{slug}.json convention, or a path outside the
                        // manifests root — key it by filename under a catch-all area.
                        slug = Path.GetFileNameWithoutExtension(parts[^1]);
                    }
                }
            }
            catch { /* fall back to the defaults below */ }

            if (string.IsNullOrWhiteSpace(slug))
                slug = manifest.Issue > 0 ? $"issue-{manifest.Issue}" : "manifest";

            // Diagnostic trace on the same "testing.baseline" channel Compare/Promote use: record the exact
            // SourcePath this run resolved and the (area, slug) it derived. Two runs of the SAME manifest MUST
            // log an identical SourcePath → identical area/slug here; if a re-prompt ever recurs, this line is
            // where a per-run SourcePath drift (e.g. a different trigger path handing in a differently-rooted
            // path) would show up, upstream of the baseline dir the Promote[write]/Compare[read] lines log.
            ActivityLog.Log(ScreenshotBaselineStore.Channel,
                $"SubjectFromManifest repoRoot='{repoRoot}' sourcePath='{manifest.SourcePath}' → area='{area}' slug='{slug}' issue=#{manifest.Issue}.");

            return new ScreenshotReviewSubject
            {
                Area = area,
                Slug = slug,
                IssueNumber = manifest.Issue,
                Title = string.IsNullOrWhiteSpace(manifest.Feature) ? $"issue #{manifest.Issue}" : manifest.Feature,
            };
        }

        /// <param name="sendToChat">The #937 send-to-active-chat path, bound by the caller (MainWindow):
        /// (text, showMessage, onInserted) =&gt; SendTextToActiveClaudeChatAsync(...). Used both for
        /// Report issue and for Approve's landed-and-verified note.</param>
        /// <param name="interactive">False for the scheduled regression sweep and the #898 remote-trigger
        /// (both headless/background) — those log-and-skip the modal so they never block; true for a
        /// menu-driven single run, which builds the deferred <see cref="ScreenshotReviewResult.ShowReviewDialog"/>.</param>
        /// <returns>The review decision (see <see cref="ScreenshotReviewResult"/>). This method no longer
        /// shows the dialog itself — it evaluates #975's condition and, for an interactive run that needs
        /// review, hands back a deferred <see cref="ScreenshotReviewResult.ShowReviewDialog"/> the caller
        /// pops from the attention toast's click-through instead of interrupting the run inline.</returns>
        // Not `async`: the only awaited work (the Approve flow) lives inside the approveAsync delegate;
        // this method's body — compare and log — is all synchronous, so it returns Task directly.
        public static Task<ScreenshotReviewResult> EvaluateAsync(
            Window? owner,
            string repoRoot,
            ScreenshotReviewSubject subject,
            IReadOnlyList<UiScreenshotCapture> shots,
            Func<string, Action<string, bool>, Action?, Task> sendToChat,
            bool interactive)
        {
            if (shots == null || shots.Count == 0) return Task.FromResult(ScreenshotReviewResult.None);

            var items = shots
                .Where(s => !string.IsNullOrEmpty(s.FilePath) && File.Exists(s.FilePath))
                .Select(s => new ScreenshotReviewItem
                {
                    Shot = s,
                    Comparison = ScreenshotBaselineStore.Compare(repoRoot, subject.Area, subject.Slug, s.StepIndex, s.FilePath),
                })
                .ToList();

            if (items.Count == 0) return Task.FromResult(ScreenshotReviewResult.None);

            int noBaseline = items.Count(i => !i.HasBaseline);
            int diffs = items.Count(i => i.HasBaseline && i.NeedsReview);
            bool needsReview = items.Any(i => i.NeedsReview);

            ActivityLog.Log(Channel,
                $"{subject.DisplayName} (issue #{subject.IssueNumber}): {items.Count} screenshot(s) — {noBaseline} without a baseline, {diffs} changed vs baseline. "
                + (needsReview ? "Review needed." : "Clean — all match baseline, no review shown."));

            if (!needsReview)
                return Task.FromResult(new ScreenshotReviewResult
                {
                    NeedsReview = false, NoBaseline = noBaseline, Diffs = diffs, ItemCount = items.Count,
                });

            if (!interactive)
            {
                ActivityLog.Log(Channel,
                    $"{subject.DisplayName}: review needed ({noBaseline} new, {diffs} changed) but this run is non-interactive (scheduled/remote) — dialog suppressed; re-run interactively to review/approve.");
                return Task.FromResult(new ScreenshotReviewResult
                {
                    NeedsReview = true, NoBaseline = noBaseline, Diffs = diffs, ItemCount = items.Count,
                });
            }

            // Approve callback: promote baselines -> send the landed-and-verified note to the active
            // chat -> close the linked issue. Captures `shots`/`subject`/`sendToChat` from this scope.
            Func<Task<string>> approveAsync = async () =>
            {
                int promoted = ScreenshotBaselineStore.Promote(repoRoot, subject.Area, subject.Slug, shots);

                string chatNote = BuildApprovedNote(subject, promoted);
                try { await sendToChat(chatNote, (_, _) => { }, null); }
                catch (Exception ex) { ActivityLog.Log(Channel, $"Approve: couldn't send note to active chat: {ex.Message}"); }

                string closeMsg = await CloseIssueAsync(subject.IssueNumber);
                ActivityLog.Log(Channel, $"Approved {subject.DisplayName}: {promoted} baseline(s) updated; {closeMsg}.");
                return $"Approved — {promoted} baseline(s) updated, note sent to chat, {closeMsg}.";
            };

            // Deferred — invoked from the attention toast's click-through, NOT inline, so the run never
            // interrupts Shane. When it fires, the shots still exist on disk and the captured
            // subject/sendToChat/approveAsync are all still valid.
            Action showReviewDialog = () =>
            {
                var win = new ScreenshotReviewWindow(subject, items, sendToChat, approveAsync);
                if (owner != null) win.Owner = owner;
                win.ShowDialog();
            };

            return Task.FromResult(new ScreenshotReviewResult
            {
                NeedsReview = true, NoBaseline = noBaseline, Diffs = diffs, ItemCount = items.Count,
                ShowReviewDialog = showReviewDialog,
            });
        }

        private static string BuildApprovedNote(ScreenshotReviewSubject subject, int promoted)
        {
            string issue = subject.IssueNumber > 0 ? $" — closing #{subject.IssueNumber}" : "";
            return
                $"✅ Screenshots reviewed and approved for {subject.Title} [{subject.DisplayName}]{issue}. "
                + $"{promoted} screenshot(s) are now the visual baseline; verified as landed and correct.";
        }

        /// <summary>Closes the manifest's associated GitHub issue on Approve, via the same
        /// PAT/GitHubApiClient every other direct GitHub call in this app uses. This is Shane's own
        /// deliberate click (not the automated bookend workflow, which never auto-closes) — the task
        /// explicitly wires Approve to close the issue. No PAT / no linked issue is reported, not thrown.</summary>
        private static async Task<string> CloseIssueAsync(int issueNumber)
        {
            if (issueNumber <= 0) return "no linked GitHub issue to close";
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return $"issue #{issueNumber} left open (no GitHub PAT configured in Settings)";
            try
            {
                IssueChompAnimation.Play(null, $"Issue #{issueNumber}");
                await new GitHubApiClient(settings.GitHubPat).SetIssueStateAsync(issueNumber, close: true);
                ActivityLog.Log(Channel, $"Closed GitHub issue #{issueNumber} on screenshot approval.");
                return $"closed issue #{issueNumber}";
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Couldn't close issue #{issueNumber}: {ex.Message}");
                return $"couldn't close issue #{issueNumber}: {ex.Message}";
            }
        }
    }
}
