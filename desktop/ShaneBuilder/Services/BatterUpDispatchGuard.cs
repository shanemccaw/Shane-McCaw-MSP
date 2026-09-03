using System;
using System.Threading;

namespace ShaneBuilder.Services;

/// <summary>Git #2366 — the real, runtime-enforced boundary #2355's own body states in words: a
/// Batter Up item requires a build prompt written by Claude in chat after approval, then a Git
/// issue push, then an app-side Git refresh. Nothing in this app may write <c>bt_build_queue</c>
/// directly, and nothing in this app may post a synthetic <c>BUILD:</c> comment on the issue
/// itself. #2360's Dispatch action (<see cref="MainWindow.BatterUpDispatchClicked"/> /
/// <see cref="MainWindow.BatterUpDispatchAllClicked"/>) only opens the real issue in the browser
/// and copies a prompt to the clipboard — this guard is what makes that boundary a real assertion
/// instead of a doc comment a later edit can silently drift past.
///
/// <see cref="Enter"/> marks the synchronous+awaited call tree of a Dispatch click as "inside the
/// no-write zone" for as long as the returned scope is held (an <see cref="AsyncLocal{T}"/>, so it
/// flows down `await`s made from inside the click handler without leaking into unrelated
/// concurrent work elsewhere in the app — a background Git-panel refresh running at the same time
/// never sees <see cref="IsActive"/> as true). The two real choke points this app has for the
/// forbidden writes — <see cref="QueueWriteClient"/>'s direct `bt_build_queue` mutations, and
/// <see cref="GitMapService"/>'s `gh` CLI runner (the only path to a `gh issue comment` write) —
/// both check <see cref="IsActive"/> and throw immediately rather than complete the write. A
/// future edit that starts calling either from inside a Dispatch handler fails loudly the first
/// time it's actually exercised, not silently in review.</summary>
internal static class BatterUpDispatchGuard
{
    private static readonly AsyncLocal<bool> _active = new();

    public static bool IsActive => _active.Value;

    public static IDisposable Enter() => new Scope();

    /// <summary>Throws if called while a Dispatch click's guard scope is active. Call this at the
    /// top of any real write path a Dispatch handler must never reach.</summary>
    public static void ForbidIfActive(string what)
    {
        if (IsActive)
            throw new InvalidOperationException(
                $"Git #2366 boundary violation: Batter Up Dispatch attempted {what}. " +
                "Dispatch may only open the issue in the browser and copy a prompt to the " +
                "clipboard — the real build prompt is written by Claude in chat, pushed as a " +
                "Git issue comment, and picked up by the app's next real Git refresh. Nothing " +
                "here may write bt_build_queue or post a BUILD: comment directly.");
    }

    private sealed class Scope : IDisposable
    {
        private readonly bool _previous;
        public Scope()
        {
            _previous = _active.Value;
            _active.Value = true;
        }
        public void Dispose() => _active.Value = _previous;
    }
}
