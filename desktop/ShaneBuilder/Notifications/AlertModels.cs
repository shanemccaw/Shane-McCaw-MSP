using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ShaneBuilder;

// Git #2201 — readme-phase2.md Step 11 (Alerts and Critters). The real contract, verbatim from the
// doc: "Every emitter (build runner, git watcher, deploy watcher, agent bridge) publishes one of
// these two records — never a plain string." Kept as C# records exactly as specified; presentation
// (accent colour, icon) is derived from Kind/Mood at render time in AlertPalette, not stored here.

/// <summary>Which real subsystem raised the alert — the five kinds this build actually wires to a
/// live emitter (see AlertWatchers.cs). Matches the mockup's ALERT_SEED keys 1:1.</summary>
public enum AlertKind { Crash, BuildFailed, ClaudeWaiting, IssueBlocked, WorktreeDirty }

public enum Severity { Info, Warning, Critical }

/// <summary>One card action. <see cref="Invoke"/> is async so an action can await a real I/O call
/// (e.g. opening the Log Viewer's query, or posting to the composer) before the card dismisses.</summary>
public sealed record AlertAction(string Label, Func<Task> Invoke);

public sealed record Alert(
    string Id, AlertKind Kind, Severity Sev, string Title, string Meta, string Evidence,
    AlertAction? Primary, AlertAction? Secondary, bool WantsReply)
{
    public DateTimeOffset At { get; init; } = DateTimeOffset.Now;
    /// <summary>Set only for <see cref="AlertKind.ClaudeWaiting"/> — the reply box's Send target.</summary>
    public Func<string, Task>? OnReply { get; init; }
}

public enum Mood { Good, Evil }

/// <summary>The animation shape the critter overlay renders for one celebration — matches the
/// mockup's PARTY_EVENTS "kind" field (cheer/eat/carry/whammy/party).</summary>
public enum CelebrationShape { Cheer, Eat, Carry, Whammy, Party }

public sealed record Celebration(string EventId, int Tier, Mood Mood, CelebrationShape Shape, string Text)
{
    /// <summary>Short label shown on the tier-3+ banner ("Epic #1202 closed"); falls back to
    /// <see cref="Text"/> when not set.</summary>
    public string? Label { get; init; }
}

/// <summary>Git #2201 — one seeded alert the Alert Lab can fire on demand (the doc's own QA-harness
/// requirement: "fire any alert/celebration on demand"). Distinct from a live <see cref="Alert"/>
/// instance: this is the reusable template a real watcher OR the lab turns into one.</summary>
public sealed record AlertSeed(AlertKind Kind, Severity Sev, string ToneRgb, string Title, string MetaTemplate, string EvidenceTemplate, bool WantsReply);

/// <summary>One demo-fireable party event for the Alert Lab, mirroring the mockup's PARTY_EVENTS
/// table verbatim (id/label/hint/tier/mood/kind/text).</summary>
public sealed record PartyEventDef(string Id, string Label, string Hint, int Tier, Mood Mood, CelebrationShape Shape, string Text);

/// <summary>Static seed tables — the exact ALERT_SEED / PARTY_EVENTS data ported from
/// `Shell Skeleton v2.dc.html`'s logic class (computeAlertLab / celebrate), used both by the Alert
/// Lab (fire on demand) and as the copy template real watchers fill with live evidence.</summary>
public static class AlertCatalog
{
    public static readonly IReadOnlyDictionary<AlertKind, AlertSeed> Seeds = new Dictionary<AlertKind, AlertSeed>
    {
        [AlertKind.Crash] = new(AlertKind.Crash, Severity.Critical, "226,89,63",
            "API Server stopped responding", "just now",
            "FATAL — service process is not responding", false),
        [AlertKind.BuildFailed] = new(AlertKind.BuildFailed, Severity.Warning, "226,176,57",
            "Build failed", "just now",
            "MSB — the queued build exited non-zero", false),
        [AlertKind.ClaudeWaiting] = new(AlertKind.ClaudeWaiting, Severity.Info, "217,119,87",
            "Claude is waiting on you", "held a few minutes · build paused",
            "A pinned question is open in this chat", true),
        [AlertKind.IssueBlocked] = new(AlertKind.IssueBlocked, Severity.Critical, "226,89,63",
            "Issue just got blocked", "labelled blocked",
            "blocked_by dependency is open", false),
        [AlertKind.WorktreeDirty] = new(AlertKind.WorktreeDirty, Severity.Warning, "163,116,234",
            "Worktree is dirty or diverged", "checked just now",
            "Git Doctor has the real findings", false),
    };

    public static readonly IReadOnlyList<PartyEventDef> PartyEvents = new List<PartyEventDef>
    {
        new("unblocked", "Dependency cleared", "blocked_by went away", 1, Mood.Good, CelebrationShape.Cheer, "cleared — buildable again"),
        new("buildclean", "Build finished clean", "green build", 1, Mood.Good, CelebrationShape.Cheer, "green build"),
        new("deploy", "Deploy succeeded", "shipped to an environment", 2, Mood.Good, CelebrationShape.Cheer, "deployed"),
        new("issueclosed", "Git issue closed", "critters eat it", 2, Mood.Good, CelebrationShape.Eat, "closed"),
        new("issueopened", "Git issue opened", "mean critters drag it in", 1, Mood.Evil, CelebrationShape.Carry, "opened"),
        new("issueblocked", "Git issue blocked", "whammy", 2, Mood.Evil, CelebrationShape.Whammy, "BLOCKED"),
        new("epicclosed", "Epic closed", "confetti + disco", 3, Mood.Good, CelebrationShape.Party, "epic closed"),
        new("milestone", "Milestone closed", "bigger party", 4, Mood.Good, CelebrationShape.Party, "milestone done"),
        new("release", "Release shipped", "everything at once", 5, Mood.Good, CelebrationShape.Party, "RELEASE IS OUT"),
    };

    /// <summary>Tier -> (critter count, critter size px), exactly the mockup's celebrate() table.</summary>
    public static readonly int[] TierCount = { 1, 3, 5, 8, 12 };
    public static readonly int[] TierSize = { 54, 50, 46, 42, 40 };

    public static string ToneRgb(AlertKind kind) => Seeds.TryGetValue(kind, out var s) ? s.ToneRgb : "139,148,158";
}
