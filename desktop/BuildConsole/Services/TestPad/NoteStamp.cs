using System;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2331,
/// ShaneBuilder Feature: Test Pad #2326). The screen/feature/build context captured onto a Test
/// Pad note the moment it's filed. Notes get taken mid test-pass, often minutes to hours before
/// anyone reads them back; without a stamp there's no way to tell later which screen the note was
/// about, which feature it belonged to, or which build was actually running when the behavior was
/// observed. <see cref="Screen"/> and <see cref="Feature"/> are free-text (whatever the caller's
/// active-tab resolver names them as — see <see cref="NoteContextStamper"/>) and may be
/// <c>null</c> when nothing is resolvable (e.g. no tab focused yet); <see cref="BuildNumber"/> is
/// the GitHub issue number of whichever build the queue shows as <c>running</c> at capture time,
/// or <c>null</c> if none is.</summary>
public sealed record NoteStamp(string? Screen, string? Feature, int? BuildNumber, DateTimeOffset CapturedAtUtc)
{
    /// <summary>A stamp with every field unresolved, timestamped now. Used when a note is filed
    /// with no context resolvers wired up yet (or all of them returned nothing) rather than
    /// leaving the note unstamped.</summary>
    public static NoteStamp Empty(DateTimeOffset? now = null) => new(null, null, null, now ?? DateTimeOffset.UtcNow);

    /// <summary>Renders the stamp as the single-line prefix a note carries — e.g.
    /// <c>"[Test Pad · Build #1269]"</c>, <c>"[Home]"</c>, or <c>"[Build #1269]"</c> depending on
    /// which parts resolved. Omits parts that are <c>null</c> rather than printing an empty
    /// placeholder, and renders nothing (empty string) when every part is <c>null</c>.</summary>
    public string Format()
    {
        var parts = new System.Collections.Generic.List<string>(capacity: 3);
        if (!string.IsNullOrWhiteSpace(Screen))
        {
            parts.Add(Screen!);
        }

        if (!string.IsNullOrWhiteSpace(Feature) && !string.Equals(Feature, Screen, StringComparison.Ordinal))
        {
            parts.Add(Feature!);
        }

        if (BuildNumber is { } buildNumber)
        {
            parts.Add($"Build #{buildNumber}");
        }

        return parts.Count == 0 ? string.Empty : $"[{string.Join(" · ", parts)}]";
    }
}
