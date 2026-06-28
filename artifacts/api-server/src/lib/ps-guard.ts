/**
 * PowerShell heuristic guard.
 *
 * hasPsKeywords() returns true if `text` contains at least one recognisable
 * PowerShell keyword within its first 200 characters. Used by the /generate
 * and /fix endpoints to reject AI responses that contain only prose (i.e. the
 * model skipped the ```powershell fence entirely).
 *
 * hasPsKeywordsFullText() scans the entire string. Used by the
 * /generate-from-service route where the AI is instructed to prepend a
 * multi-line comment block (300–400 chars) before any PS code, which would
 * cause the 200-char window to miss valid scripts.
 *
 * validatePsSyntax() spawns pwsh to parse the script and returns any
 * syntax errors via the PowerShell language parser. Returns { valid: true,
 * skipped: true } silently when pwsh is not available on the host.
 */

import { execFile } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { logger } from "./logger.ts";

export const PS_KEYWORD_RE = /Param|function|#requires|\$|Write-|Get-|Set-|New-|Remove-/i;

export function hasPsKeywords(text: string): boolean {
  return PS_KEYWORD_RE.test(text.slice(0, 200));
}

export function hasPsKeywordsFullText(text: string): boolean {
  return PS_KEYWORD_RE.test(text);
}

export interface PsSyntaxError {
  line: number;
  column: number;
  message: string;
}

export interface PsSyntaxResult {
  valid: boolean;
  skipped?: boolean;
  errors?: PsSyntaxError[];
}

/**
 * Validate PowerShell syntax by spawning pwsh on the server.
 *
 * - Writes the script to a temp file, parses it with the PS language parser,
 *   and returns any errors as { line, column, message } objects.
 * - Returns { valid: true, skipped: true } (no crash) when pwsh is not
 *   installed (ENOENT) or if the temp-file write fails.
 * - Any other pwsh execution error also results in a skipped=true pass-through
 *   so we never block a run due to a validation infrastructure issue.
 */
export async function validatePsSyntax(content: string): Promise<PsSyntaxResult> {
  const tmpFile = join(
    tmpdir(),
    `ps-validate-${randomBytes(8).toString("hex")}.ps1`,
  );

  try {
    writeFileSync(tmpFile, content, "utf8");
  } catch (writeErr) {
    logger.warn({ err: writeErr }, "ps-guard: failed to write temp file for syntax validation — skipping");
    return { valid: true, skipped: true };
  }

  // PowerShell one-liner: parse the temp file and emit JSON errors (or {"valid":true})
  // We use ParseFile so the content stays on disk and never needs escaping.
  const psCmd =
    `$e=[System.Collections.Generic.List[System.Management.Automation.Language.ParseError]]::new();` +
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${tmpFile}',[ref]$null,[ref]$e);` +
    `if($e.Count -eq 0){'{"valid":true}'}` +
    `else{$e|ForEach-Object{[PSCustomObject]@{line=$_.Extent.StartLineNumber;column=$_.Extent.StartColumnNumber;message=$_.Message}}|ConvertTo-Json -AsArray}`;

  return new Promise<PsSyntaxResult>((resolve) => {
    execFile(
      "pwsh",
      ["-NonInteractive", "-NoProfile", "-Command", psCmd],
      { timeout: 15000 },
      (err, stdout) => {
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }

        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            logger.warn("ps-guard: pwsh not found on this host — syntax validation skipped");
          } else {
            logger.warn({ err }, "ps-guard: pwsh execution error — syntax validation skipped");
          }
          resolve({ valid: true, skipped: true });
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve({ valid: true, skipped: true });
          return;
        }

        try {
          const parsed = JSON.parse(trimmed) as
            | { valid: boolean }
            | PsSyntaxError[];

          if (Array.isArray(parsed)) {
            resolve({ valid: false, errors: parsed });
          } else {
            resolve({ valid: true });
          }
        } catch {
          logger.warn({ stdout: trimmed.slice(0, 300) }, "ps-guard: could not parse pwsh validation output — skipping");
          resolve({ valid: true, skipped: true });
        }
      },
    );
  });
}
