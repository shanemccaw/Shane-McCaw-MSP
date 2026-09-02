using System;

namespace ShaneBuilder.Services.TestPad;

/// <summary>Git #2331 — captures a <see cref="NoteStamp"/> at the moment a Test Pad note is filed.
/// Deliberately decoupled from where "screen", "feature" and "running build" actually live today:
/// the active screen/feature live as private state on <c>MainWindow</c> (<c>_activeTabId</c> /
/// <c>TabDef</c>, not externally queryable), and the running build has to be derived from
/// <c>QueueReadClient</c> (filter recent rows for <c>Status == "running"</c>, most recent
/// <c>GithubNumber</c>). Rather than reach into either — and risk colliding with #2327/#2328,
/// which are building/blocked on that same scaffold concurrently — this takes three resolver
/// delegates so the Composer (or whatever ends up owning note-filing) wires in the real lookups
/// once it exists. Each resolver is called independently and is allowed to throw or return
/// <c>null</c>; a failing resolver degrades that one field to <c>null</c> rather than failing the
/// whole stamp, since a note should never be lost just because e.g. the queue read timed out.</summary>
public sealed class NoteContextStamper
{
    private readonly Func<string?> _screenResolver;
    private readonly Func<string?> _featureResolver;
    private readonly Func<int?> _runningBuildNumberResolver;

    public NoteContextStamper(
        Func<string?> screenResolver,
        Func<string?> featureResolver,
        Func<int?> runningBuildNumberResolver)
    {
        _screenResolver = screenResolver ?? throw new ArgumentNullException(nameof(screenResolver));
        _featureResolver = featureResolver ?? throw new ArgumentNullException(nameof(featureResolver));
        _runningBuildNumberResolver = runningBuildNumberResolver ?? throw new ArgumentNullException(nameof(runningBuildNumberResolver));
    }

    /// <summary>The stamper <see cref="Services.TestPadService.AddNote"/> captures from at the
    /// moment a note is filed. Defaults to a no-op stamper (every field resolves to <c>null</c>)
    /// until <see cref="Configure"/> is called — real note-filing keeps working, just unstamped,
    /// for however long the real screen/feature/build lookups take to land and wire in.</summary>
    public static NoteContextStamper Current { get; private set; } = new(() => null, () => null, () => null);

    /// <summary>Wires the real resolvers in. Called once wherever the app actually knows how to
    /// answer "what screen/feature is active" and "what build is running" — e.g. MainWindow reading
    /// its own active <c>TabDef</c>, and a QueueReadClient lookup for the running build's
    /// <c>GithubNumber</c>. Safe to call again later (e.g. to swap in a live QueueReadClient once
    /// one is constructed) — the latest call wins.</summary>
    public static void Configure(
        Func<string?> screenResolver,
        Func<string?> featureResolver,
        Func<int?> runningBuildNumberResolver)
    {
        Current = new NoteContextStamper(screenResolver, featureResolver, runningBuildNumberResolver);
    }

    /// <summary>Captures the stamp right now: the current screen, current feature, and whichever
    /// build number the running-build resolver reports. <paramref name="now"/> is exposed only for
    /// tests; real callers should omit it and get <see cref="DateTimeOffset.UtcNow"/>.</summary>
    public NoteStamp Capture(DateTimeOffset? now = null)
    {
        return new NoteStamp(
            TryResolve(_screenResolver),
            TryResolve(_featureResolver),
            TryResolveBuildNumber(_runningBuildNumberResolver),
            now ?? DateTimeOffset.UtcNow);
    }

    private static string? TryResolve(Func<string?> resolver)
    {
        try
        {
            var value = resolver();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
        catch
        {
            return null;
        }
    }

    private static int? TryResolveBuildNumber(Func<int?> resolver)
    {
        try
        {
            return resolver();
        }
        catch
        {
            return null;
        }
    }
}
