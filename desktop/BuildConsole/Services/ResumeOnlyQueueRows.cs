using System;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #3728 — the single definition of a <b>resume-only</b> queue row: one whose
    /// <see cref="QueueItem.Prompt"/> is a conversational message rather than a standalone build
    /// prompt, and which therefore means nothing without the session in
    /// <see cref="QueueItem.ResumeSessionId"/>.
    ///
    /// Two shapes exist, created in two different files:
    /// <list type="bullet">
    /// <item><c>Reply → …</c> — BuildQueuePanel's "💬 Reply…" / QuickReplyAsync.</item>
    /// <item><c>Continue: …</c> — BuildWatchWindow's composer continuation (Git #1878's sibling path).</item>
    /// </list>
    ///
    /// Both prefixes used to be bare interpolated literals at their creation sites with nothing at
    /// all on the read side, so "🔄 Retry (start over)" could not tell such a row from an ordinary
    /// build and re-queued it with <c>resumeSessionId: null</c> — dropping the only link to the
    /// conversation and launching a cold session whose entire prompt was a fragment. Live
    /// instances in <c>bt_build_queue</c>: #2382 (<c>"Retry"</c>), #462 (<c>"retry"</c>),
    /// #480 (<c>"try again"</c>) — the last two ran to <c>done</c>, exit 0, having been handed two
    /// words and no context.
    ///
    /// Keep every producer and consumer of these titles pointed at this class so the write side and
    /// the read side cannot drift apart again.
    ///
    /// <para>Deliberately NOT matched: the retired <c>"Reply: "</c> (colon) prefix. No current code
    /// path produces it — the reply sites emit <see cref="ReplyTitlePrefix"/> — so the only rows
    /// carrying it are historical and long since terminal (the newest is #379, 2026-08-17).
    /// Matching it would buy nothing live while adding a false-positive surface for any genuine
    /// build whose title happens to start that way.</para>
    /// </summary>
    public static class ResumeOnlyQueueRows
    {
        /// <summary>Prefix for a row created by "💬 Reply…" — prompt is the typed reply message.</summary>
        public const string ReplyTitlePrefix = "Reply → ";

        /// <summary>Prefix for a row created by Build Watch's composer continuation — prompt is the
        /// typed continuation instructions.</summary>
        public const string ContinueTitlePrefix = "Continue: ";

        /// <summary>
        /// True when <paramref name="title"/> marks a row whose prompt cannot stand on its own.
        ///
        /// Deliberately false for a "▶ Resume Session (crash recovery)" row: that one also carries a
        /// ResumeSessionId, but it copied the ORIGINAL build's full self-contained prompt under the
        /// original's own title, so starting it over is genuinely meaningful.
        /// </summary>
        public static bool IsResumeOnlyTitle(string? title) =>
            title != null &&
            (title.StartsWith(ReplyTitlePrefix, StringComparison.Ordinal) ||
             title.StartsWith(ContinueTitlePrefix, StringComparison.Ordinal));
    }
}
