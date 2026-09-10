using System;
using System.Collections.Generic;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Local, in-app "current context" tracking (#3463) — which tenant/step/console-command is
/// currently active, plus a foreground-window fallback for genuinely external apps. Local-only:
/// no backend sync. Powers auto-tagging for Screenshot Tool (#3470) and Session Notes (#3472),
/// and its own daily review/tagging timeline (see <see cref="MainWindow.OpenActivityTimelineRecord"/>).
/// </summary>
public interface IActivityContextService
{
    /// <summary>The tenant currently in scope, mirrored from <see cref="ITenantService"/>.</summary>
    Tenant? ActiveTenant { get; }

    /// <summary>The most recently opened record (a remediation step, change request, console
    /// history entry, etc.) — the "active step" half of the issue's scope. Null before anything
    /// has been opened this session.</summary>
    (string Kind, string Id, string Label)? ActiveRecord { get; }

    /// <summary>Fires once per recorded event, real-time, for anything that wants to react live
    /// (e.g. a future auto-tagging consumer).</summary>
    event EventHandler<ActivityEvent>? EventRecorded;

    IReadOnlyList<ActivityEvent> GetAll();

    /// <summary>All events whose local timestamp falls on <paramref name="day"/>.</summary>
    IReadOnlyList<ActivityEvent> GetForDay(DateOnly day);

    void RecordTenantSwitch(Tenant? tenant);
    void RecordConsoleCommand(ConsoleExecutionRecord record);
    void RecordOpen(string kind, string id, string label);

    /// <summary>Foreground-window fallback signal — <paramref name="appLabel"/> is the friendly
    /// name of whatever genuinely-external app (VS Code, terminal, Slack, ...) just took focus.
    /// Tagged against whatever tenant/record was last active in MyArchitect.</summary>
    void RecordExternalApp(string appLabel);

    /// <summary>Sets or clears the local free-text tag on a previously recorded event. Returns
    /// false if no event with that id exists.</summary>
    bool SetTag(Guid eventId, string? tag);
}
