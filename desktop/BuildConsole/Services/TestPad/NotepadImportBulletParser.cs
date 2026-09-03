using System.Text.RegularExpressions;

namespace BuildConsole.Services.TestPad;

/// <summary>Ported from ShaneBuilder (Git #2531, Feature: Test Pad #2530; originally Git #2467,
/// re-dispatch of #2346, ShaneBuilder Feature: Test Pad #2326). Recognizes a bulleted or numbered
/// line inside an import paste (<c>- did the thing</c>, <c>* did the thing</c>,
/// <c>1. did the thing</c>, <c>2) did the thing</c>, <c>(3) did the thing</c>) and strips the
/// marker off, leaving just the item text. Pure/stateless, same shape as
/// <see cref="NotepadImportLineClassifier"/> and <see cref="NoteMarkerParser"/>, so
/// <see cref="TestPadImportParser"/> can call it line-by-line while reflowing a block.</summary>
public static class NotepadImportBulletParser
{
    /// <summary>Matches a leading bullet character (<c>- * • ‣ ▪ ● ○</c>) or a numeric ordinal
    /// (<c>1.</c>, <c>1)</c>, <c>(1)</c> — up to 3 digits) followed by required whitespace. Letter
    /// enumerations (<c>a.</c>, <c>A)</c>) are deliberately not matched here — too easily a real
    /// sentence's leading word-plus-period ("A. is for..."), not a list marker.</summary>
    private static readonly Regex BulletPrefix = new(
        @"^(?:[-*•‣▪●○]|\(?\d{1,3}[.\)])\s+",
        RegexOptions.Compiled);

    /// <summary>True when <paramref name="trimmedLine"/> (already <c>.Trim()</c>'d by the caller)
    /// opens with a bullet/numbering marker. When true, <paramref name="strippedText"/> is the
    /// line with that marker (and the whitespace right after it) removed; when false,
    /// <paramref name="strippedText"/> is just <paramref name="trimmedLine"/> unchanged.</summary>
    public static bool TryStripMarker(string trimmedLine, out string strippedText)
    {
        var match = BulletPrefix.Match(trimmedLine);
        if (!match.Success)
        {
            strippedText = trimmedLine;
            return false;
        }

        strippedText = trimmedLine[match.Length..].TrimStart();
        return true;
    }
}
