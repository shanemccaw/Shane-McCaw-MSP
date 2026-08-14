using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Lightweight "@path" autocomplete for a build's chat composer — extracted (verbatim
    /// logic) from BuildWatchWindow.xaml.cs's original per-slot InputBox handling so
    /// ChatSessionPane's own composer can reuse it directly. Pure filesystem lookup, no UI.
    /// </summary>
    public static class PathAutocomplete
    {
        /// <summary>The '@'-prefixed path fragment immediately left of the caret (or null if the caret isn't inside one). '@' must start a token (be at the start or follow whitespace) and the fragment must be whitespace-free.</summary>
        public static string? CurrentAtFragment(TextBox box)
        {
            string text = box.Text ?? "";
            int caret = Math.Min(box.CaretIndex, text.Length);
            string upto = text.Substring(0, caret);
            int at = upto.LastIndexOf('@');
            if (at < 0) return null;
            if (at > 0 && !char.IsWhiteSpace(upto[at - 1])) return null;
            string frag = upto.Substring(at + 1);
            return frag.Any(char.IsWhiteSpace) ? null : frag;
        }

        /// <summary>Up to 20 files/dirs under <paramref name="cwd"/> matching the (possibly directory-qualified) fragment, as forward-slashed relative paths, directories suffixed with '/'.</summary>
        public static List<string> MatchPaths(string cwd, string frag)
        {
            var results = new List<string>();
            try
            {
                string rel = frag.Replace('\\', '/');
                string dirPart = "", namePart = rel;
                int slash = rel.LastIndexOf('/');
                if (slash >= 0) { dirPart = rel.Substring(0, slash); namePart = rel.Substring(slash + 1); }
                string baseDir = string.IsNullOrEmpty(dirPart) ? cwd : Path.Combine(cwd, dirPart);
                if (!Directory.Exists(baseDir)) return results;
                foreach (var entry in Directory.EnumerateFileSystemEntries(baseDir))
                {
                    var name = Path.GetFileName(entry);
                    if (name.StartsWith(".", StringComparison.Ordinal)) continue; // skip dotfiles / .git
                    if (namePart.Length > 0 && !name.StartsWith(namePart, StringComparison.OrdinalIgnoreCase)) continue;
                    bool isDir = Directory.Exists(entry);
                    string relOut = (string.IsNullOrEmpty(dirPart) ? name : dirPart + "/" + name) + (isDir ? "/" : "");
                    results.Add(relOut);
                    if (results.Count >= 20) break;
                }
                results.Sort(StringComparer.OrdinalIgnoreCase);
            }
            catch { /* best-effort autocomplete */ }
            return results;
        }
    }
}
