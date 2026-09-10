using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the Personal Task Queue (#3490) — msp-sla.ts's virtual operator task
/// queue (unresolved SLA breaches + scope-creep violations, deep-linked) and its real SSE stream
/// for live updates. Same shape as <see cref="ISlaService"/> — a Bearer token set once auth
/// lands, real typed exceptions on failure, no fixture data.
/// </summary>
public interface ITaskQueueService
{
    /// <summary>Bearer token attached to every request — set from <c>IAuthService.SessionChanged</c>,
    /// same convention as every other MSP-scoped service in this app.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/operator-tasks — every unresolved SLA breach + scope-creep violation
    /// across the book, newest first.</summary>
    Task<IReadOnlyList<OperatorTask>> GetTasksAsync(CancellationToken cancellationToken = default);

    /// <summary>Subscribes to GET /api/msp/sla/events/stream (real SSE, 30s heartbeat) and invokes
    /// <paramref name="onEvent"/> for every real (non-heartbeat) event received, until
    /// <paramref name="cancellationToken"/> is cancelled or the connection drops. Runs until
    /// cancelled — callers own the lifetime via the token, same discipline as every other
    /// bounded-wait in this app (no indefinite retry loop of its own; one connection attempt per
    /// call, real failures propagate to the caller).</summary>
    Task SubscribeToEventsAsync(Action<string> onEvent, CancellationToken cancellationToken);
}
