// Splits SQL source text into individual executable statements by scanning
// character-by-character, so semicolons inside string literals, quoted
// identifiers, dollar-quoted strings, and comments never count as statement
// boundaries. A regex/split approach silently mis-splits exactly those cases,
// which would make "run just this block" execute the wrong SQL.

export interface SqlStatement {
  /** Offset of the first executable (non-comment, non-whitespace) character. */
  from: number;
  /** Offset just past the statement's last character (includes the semicolon). */
  to: number;
  /** The statement text, `source.slice(from, to)`. */
  text: string;
}

const DOLLAR_TAG_RE = new RegExp("\\$[A-Za-z_\\u0080-\\uffff][A-Za-z0-9_\\u0080-\\uffff]*\\$|\\$\\$", "y");

export function splitSqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const len = source.length;
  let i = 0;
  // Offset of the first executable token in the current segment, or -1 while
  // the segment holds only whitespace/comments. Leading comments are excluded
  // from the statement so the gutter play button lands on the code line.
  let contentFrom = -1;

  const markContent = () => {
    if (contentFrom === -1) contentFrom = i;
  };

  const endStatement = (endExclusive: number) => {
    if (contentFrom !== -1) {
      let to = endExclusive;
      while (to > contentFrom && /\s/.test(source[to - 1])) to--;
      statements.push({ from: contentFrom, to, text: source.slice(contentFrom, to) });
    }
    contentFrom = -1;
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "-" && next === "-") {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      // PostgreSQL block comments nest.
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (source[i] === "*" && source[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    if (ch === "'") {
      // Standard strings escape quotes by doubling (''). E'...' strings also
      // allow backslash escapes, so \' must not terminate those.
      const prev = source[i - 1] ?? "";
      const prev2 = source[i - 2] ?? "";
      const isEscapeString = /[eE]/.test(prev) && !/[A-Za-z0-9_$]/.test(prev2);
      markContent();
      i++;
      while (i < len) {
        if (isEscapeString && source[i] === "\\") {
          i += 2;
        } else if (source[i] === "'") {
          if (source[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    if (ch === '"') {
      // Quoted identifier; "" is an escaped quote.
      markContent();
      i++;
      while (i < len) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    if (ch === "$") {
      // Dollar-quoted string ($$...$$ or $tag$...$tag$). A lone $ (e.g. a $1
      // positional param) is ordinary content.
      DOLLAR_TAG_RE.lastIndex = i;
      const tagMatch = DOLLAR_TAG_RE.exec(source);
      markContent();
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = source.indexOf(tag, i + tag.length);
        i = close === -1 ? len : close + tag.length;
      } else {
        i++;
      }
      continue;
    }

    if (ch === ";") {
      // A semicolon with no preceding content is an empty statement — skip it.
      endStatement(i + 1);
      i++;
      continue;
    }

    if (!/\s/.test(ch)) markContent();
    i++;
  }

  endStatement(len);
  return statements;
}
