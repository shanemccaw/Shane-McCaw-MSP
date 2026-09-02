using System;
using System.Collections.Generic;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2201 — a static bridge, same pattern this file's neighbours already use (ToastEngine calling
/// into <c>Application.Current</c> rather than holding a MainWindow reference) so AlertWatchers.cs and
/// the Alert Lab can build real <see cref="AlertAction"/> delegates without depending on MainWindow
/// directly. MainWindow wires every field once, in its constructor, to its own real methods
/// (OpenGitDoctor, the Log Viewer's filter state, AppendToComposer, the left Git panel toggle).
/// Any field left null (no MainWindow attached yet, e.g. a watcher fires before Loaded) is a no-op —
/// an action must never throw back into the card that invoked it.
/// </summary>
public static class AlertActions
{
    public static Action<string?, IReadOnlyList<LogLevel>?, string?>? OpenLogAt;
    public static Action? OpenGitDoctor;
    public static Action<int>? OpenIssueInGitPanel;
    /// <summary>Posts text into the currently active chat composer (AppendToComposer) — the real
    /// "answerable from the card" reply path for a ClaudeWaiting alert with no open matching tab.</summary>
    public static Action<string>? AppendToComposer;
    /// <summary>conversationId -> opens the real claude.ai chat in the default browser (fallback when
    /// no matching tab is open in this session).</summary>
    public static Action<string>? OpenChatInBrowser;
}
