namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2329,
/// ShaneBuilder Feature: Test Pad #2326). The type a Test Pad note carries, set either by a
/// leading marker character typed into the composer or by clicking a type chip that inserts the
/// same marker. <see cref="Note"/> is the default for text with no recognized marker.</summary>
public enum NoteType
{
    /// <summary>No marker present — a plain, untyped note.</summary>
    Note,

    /// <summary>Leading marker <c>!</c> — something is broken.</summary>
    Bug,

    /// <summary>Leading marker <c>?</c> — something needs an answer.</summary>
    Question,

    /// <summary>Leading marker <c>+</c> — a suggestion or improvement.</summary>
    Idea,

    /// <summary>Leading marker <c>.</c> — confirms something works as expected.</summary>
    Works,
}
