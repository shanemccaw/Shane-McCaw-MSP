using System;
using System.Collections.Generic;
using System.Text;

namespace ShaneBuilder.Services;

/// <summary>
/// Git #2215 — direct port of BuildConsole's <c>Services/SqlScriptSplitter.cs</c> (itself a
/// C# port of the api-server's <c>sql-statement-splitter.ts</c>), kept behavior-identical so a
/// script splits the same way in both apps. Splits a multi-statement SQL script on top-level
/// semicolons only, skipping any that live inside single-quoted strings, double-quoted
/// identifiers, dollar-quoted blocks, <c>--</c> line comments or <c>/* */</c> (nestable) block
/// comments.
/// </summary>
public static class SqlScriptSplitter
{
    private static string? MatchDollarTag(string sql, int start)
    {
        // sql[start] is known to be '$'. Empty tag ($$) is valid.
        var i = start + 1;
        if (i < sql.Length && sql[i] == '$') return "$$";
        if (i >= sql.Length || !(char.IsLetter(sql[i]) || sql[i] == '_')) return null;
        i++;
        while (i < sql.Length && (char.IsLetterOrDigit(sql[i]) || sql[i] == '_')) i++;
        if (i >= sql.Length || sql[i] != '$') return null;
        return sql.Substring(start, i - start + 1);
    }

    public static List<string> Split(string input)
    {
        var statements = new List<string>();
        var current = new StringBuilder();
        var hasContent = false;
        var n = input.Length;
        var i = 0;

        void Flush()
        {
            var trimmed = current.ToString().Trim();
            if (hasContent && trimmed.Length > 0) statements.Add(trimmed);
            current.Clear();
            hasContent = false;
        }

        while (i < n)
        {
            var ch = input[i];
            var next = i + 1 < n ? input[i + 1] : '\0';

            // -- line comment
            if (ch == '-' && next == '-')
            {
                var j = i;
                while (j < n && input[j] != '\n') j++;
                current.Append(input, i, j - i);
                i = j;
                continue;
            }

            // /* block comment */ (nestable)
            if (ch == '/' && next == '*')
            {
                var depth = 1;
                current.Append("/*");
                var j = i + 2;
                while (j < n && depth > 0)
                {
                    if (j + 1 < n && input[j] == '/' && input[j + 1] == '*') { depth++; current.Append("/*"); j += 2; }
                    else if (j + 1 < n && input[j] == '*' && input[j + 1] == '/') { depth--; current.Append("*/"); j += 2; }
                    else { current.Append(input[j]); j++; }
                }
                i = j;
                continue;
            }

            // '...' single-quoted string literal ('' escapes a quote)
            if (ch == '\'')
            {
                current.Append('\'');
                var j = i + 1;
                while (j < n)
                {
                    if (input[j] == '\'' && j + 1 < n && input[j + 1] == '\'') { current.Append("''"); j += 2; }
                    else if (input[j] == '\'') { current.Append('\''); j++; break; }
                    else { current.Append(input[j]); j++; }
                }
                hasContent = true;
                i = j;
                continue;
            }

            // "..." double-quoted identifier ("" escapes a quote)
            if (ch == '"')
            {
                current.Append('"');
                var j = i + 1;
                while (j < n)
                {
                    if (input[j] == '"' && j + 1 < n && input[j + 1] == '"') { current.Append("\"\""); j += 2; }
                    else if (input[j] == '"') { current.Append('"'); j++; break; }
                    else { current.Append(input[j]); j++; }
                }
                hasContent = true;
                i = j;
                continue;
            }

            // $tag$ ... $tag$ dollar-quoted block
            if (ch == '$')
            {
                var tag = MatchDollarTag(input, i);
                if (tag != null)
                {
                    current.Append(tag);
                    var j = i + tag.Length;
                    var close = input.IndexOf(tag, j, StringComparison.Ordinal);
                    if (close == -1)
                    {
                        current.Append(input, j, n - j);
                        j = n;
                    }
                    else
                    {
                        current.Append(input, j, close + tag.Length - j);
                        j = close + tag.Length;
                    }
                    hasContent = true;
                    i = j;
                    continue;
                }
            }

            // ; top-level statement terminator
            if (ch == ';')
            {
                current.Append(';');
                i++;
                Flush();
                continue;
            }

            current.Append(ch);
            if (!char.IsWhiteSpace(ch)) hasContent = true;
            i++;
        }

        // Trailing statement with no final semicolon.
        Flush();

        return statements;
    }
}
