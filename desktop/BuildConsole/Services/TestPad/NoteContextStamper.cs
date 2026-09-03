using System;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2331,
/// ShaneBuilder Feature: Test Pad #2326). Captures a <see cref="NoteStamp"/> at the moment a Test
/// Pad note is filed. Deliberately decoupled from where "screen", "feature" and "running build"
/// actually live — BuildConsole's own equivalents (whatever the UI ends up wiring, and
/// <c>BuildQueuePostgresClient</c> for the running build) are not yet wired here since this issue
/// is services-only, no UI/window wiring (that's #2532). This takes three resolver delegates so
/// whoever ends up owning note-filing wires in the real lookups once it exists. Each resolver is
/// called independently and is allowed to throw or return <c>null</c>; a failing resolver degrades
/// that one field to <c>null</c> rather than failing the whole stamp, since a note should never be
/// lost just because e.g. a queue read timed out.</summary>
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
    /// answer "what screen/feature is active" and "what build is running" — the eventual UI wiring
    /// (#2532). Safe to call again later (e.g. to swap in a live build-status lookup once one is
    /// constructed) — the latest call wins.</summary>
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
