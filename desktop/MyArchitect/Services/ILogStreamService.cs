using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the platform's live logging/telemetry SSE feed
/// (<c>GET /api/admin/live-stream</c>, <c>artifacts/api-server/src/routes/admin-live-stream.ts</c>)
/// — the same stream <c>artifacts/admin-panel/src/hooks/useLiveStream.ts</c> consumes. Backs the
/// Live half of the title-bar Log Viewer (UI_RULES.md §1, #3506); the Loaded half is
/// <see cref="IConsoleHistoryService"/>, unchanged.
///
/// Always subscribes with a real <c>mspId</c> attached — the route's own tiering treats
/// <c>channel=*</c> as a true global firehose that ignores scope entirely, and a bare channel
/// with no <c>mspId</c> as a firehose across every MSP's scope on that channel. MyArchitect is an
/// MSP-operator tool, not the platform Admin Panel this route was built for, so this
/// deliberately only ever uses the third tier (channel + mspId) — the one subscription shape
/// that cannot surface another MSP's activity to an operator who isn't a PlatformAdmin.
/// </summary>
public interface ILogStreamService
{
    /// <summary>Bearer token used for the plain (non-SSE) channel-list request. The SSE
    /// connection itself carries the token as a query parameter — EventSource-style auth is what
    /// the server route actually reads (it never checks the Authorization header) — but this same
    /// value is what <see cref="SubscribeAsync"/> sends that way.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/admin/live-stream/channels — the real, server-owned channel taxonomy for
    /// a picker, matching the locked channel list in this repo's CLAUDE.md logging section. No
    /// client-side hardcoded list.</summary>
    Task<IReadOnlyList<string>> GetChannelsAsync(CancellationToken cancellationToken = default);

    /// <summary>Subscribes to GET /api/admin/live-stream?channel=&lt;channel&gt;&amp;mspId=&lt;mspId&gt;
    /// (real SSE, 25s keepalive) and invokes <paramref name="onEvent"/> for every real
    /// (non-keepalive) event received, until <paramref name="cancellationToken"/> is cancelled or
    /// the connection drops. One connection attempt; a transport failure or the token being
    /// cancelled both end the method normally rather than retrying internally (Git #2160's
    /// bounded-wait discipline) — same convention as
    /// <see cref="ITaskQueueService.SubscribeToEventsAsync"/>.</summary>
    Task SubscribeAsync(string channel, int mspId, Action<string> onEvent, CancellationToken cancellationToken);
}
