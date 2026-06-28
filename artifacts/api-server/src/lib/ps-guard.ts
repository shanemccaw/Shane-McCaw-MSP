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
 */
export const PS_KEYWORD_RE = /Param|function|#requires|\$|Write-|Get-|Set-|New-|Remove-/i;

export function hasPsKeywords(text: string): boolean {
  return PS_KEYWORD_RE.test(text.slice(0, 200));
}

export function hasPsKeywordsFullText(text: string): boolean {
  return PS_KEYWORD_RE.test(text);
}
