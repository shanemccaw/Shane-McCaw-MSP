/**
 * PowerShell heuristic guard.
 *
 * Returns true if `text` contains at least one recognisable PowerShell keyword
 * within its first 200 characters. Used by the /generate and /fix endpoints to
 * reject AI responses that contain only prose (i.e. the model skipped the
 * ```powershell fence entirely).
 */
export const PS_KEYWORD_RE = /Param|function|#requires|\$|Write-|Get-|Set-|New-|Remove-/i;

export function hasPsKeywords(text: string): boolean {
  return PS_KEYWORD_RE.test(text.slice(0, 200));
}
