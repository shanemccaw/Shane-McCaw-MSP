// SQL-aware statement splitter.
//
// Splits a multi-statement SQL script into its individual statements on
// top-level semicolons ONLY — a naive `script.split(";")` shreds string
// literals, dollar-quoted function bodies, and comments, so this walks the
// text character by character and skips semicolons that live inside:
//   - single-quoted string literals ('it''s a test;')  — '' is an escaped quote
//   - double-quoted identifiers ("weird;name")          — "" is an escaped quote
//   - dollar-quoted blocks ($$ ... $$ / $tag$ ... $tag$) used by this repo's
//     trigger/function definitions
//   - -- line comments (to end of line)
//   - /* block comments */ (nestable, per Postgres)
//
// Semantics worth calling out:
//   - A trailing statement with no final semicolon is still returned.
//   - Segments that are only whitespace and/or comments are dropped, so a
//     trailing `-- done` or a stray `;;` never becomes an empty statement.
//   - BEGIN / COMMIT are NOT special-cased or stripped — they are ordinary
//     statements terminated by their own semicolons, so a `BEGIN; ...; COMMIT;`
//     script naturally splits into a BEGIN statement, the body statements, and
//     a COMMIT statement, letting the caller replay it statement-by-statement
//     on a single connection and preserve the transaction.
//
// Standard-conforming strings are assumed (the Postgres default): inside a
// single-quoted literal only `''` escapes a quote — a backslash is literal.

// A dollar-quote tag follows unquoted-identifier rules (may be empty for $$):
// starts with a letter or underscore, then letters/digits/underscores. `$1`
// (a parameter placeholder) is deliberately NOT a dollar-quote opener.
function matchDollarTag(sql: string, start: number): string | null {
  // sql[start] is known to be '$'.
  let i = start + 1;
  // Empty tag ($$) is valid.
  if (sql[i] === "$") return "$$";
  // First tag char must be a letter or underscore.
  if (i >= sql.length || !/[A-Za-z_]/.test(sql[i])) return null;
  i++;
  while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
  if (sql[i] !== "$") return null;
  return sql.slice(start, i + 1);
}

export function splitSqlStatements(input: string): string[] {
  const statements: string[] = [];
  let current = "";
  // Whether the current segment contains any real SQL (not just whitespace or
  // comments) — governs whether an emitted segment is kept or discarded.
  let hasContent = false;
  const n = input.length;
  let i = 0;

  const flush = () => {
    const trimmed = current.trim();
    if (hasContent && trimmed.length > 0) statements.push(trimmed);
    current = "";
    hasContent = false;
  };

  while (i < n) {
    const ch = input[i];
    const next = i + 1 < n ? input[i + 1] : "";

    // -- line comment
    if (ch === "-" && next === "-") {
      let j = i;
      while (j < n && input[j] !== "\n") j++;
      current += input.slice(i, j);
      i = j;
      continue;
    }

    // /* block comment */ (nestable)
    if (ch === "/" && next === "*") {
      let depth = 1;
      current += "/*";
      let j = i + 2;
      while (j < n && depth > 0) {
        if (input[j] === "/" && input[j + 1] === "*") {
          depth++;
          current += "/*";
          j += 2;
        } else if (input[j] === "*" && input[j + 1] === "/") {
          depth--;
          current += "*/";
          j += 2;
        } else {
          current += input[j];
          j++;
        }
      }
      i = j;
      continue;
    }

    // '...' single-quoted string literal ('' escapes a quote)
    if (ch === "'") {
      current += "'";
      let j = i + 1;
      while (j < n) {
        if (input[j] === "'" && input[j + 1] === "'") {
          current += "''";
          j += 2;
        } else if (input[j] === "'") {
          current += "'";
          j++;
          break;
        } else {
          current += input[j];
          j++;
        }
      }
      hasContent = true;
      i = j;
      continue;
    }

    // "..." double-quoted identifier ("" escapes a quote)
    if (ch === '"') {
      current += '"';
      let j = i + 1;
      while (j < n) {
        if (input[j] === '"' && input[j + 1] === '"') {
          current += '""';
          j += 2;
        } else if (input[j] === '"') {
          current += '"';
          j++;
          break;
        } else {
          current += input[j];
          j++;
        }
      }
      hasContent = true;
      i = j;
      continue;
    }

    // $tag$ ... $tag$ dollar-quoted block
    if (ch === "$") {
      const tag = matchDollarTag(input, i);
      if (tag) {
        current += tag;
        let j = i + tag.length;
        const close = input.indexOf(tag, j);
        if (close === -1) {
          // Unterminated dollar quote — consume the remainder as-is.
          current += input.slice(j);
          j = n;
        } else {
          current += input.slice(j, close + tag.length);
          j = close + tag.length;
        }
        hasContent = true;
        i = j;
        continue;
      }
    }

    // ; top-level statement terminator
    if (ch === ";") {
      current += ";";
      i++;
      flush();
      continue;
    }

    current += ch;
    if (!/\s/.test(ch)) hasContent = true;
    i++;
  }

  // Trailing statement with no final semicolon.
  flush();

  return statements;
}
