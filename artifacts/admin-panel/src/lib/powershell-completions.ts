import { autocompletion, CompletionContext, CompletionResult, Completion, acceptCompletion } from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";

const PS_KEYWORDS: Completion[] = [
  "begin", "break", "catch", "class", "continue", "data", "define",
  "do", "dynamicparam", "else", "elseif", "end", "enum", "exit",
  "filter", "finally", "for", "foreach", "from", "function", "hidden",
  "if", "in", "param", "process", "return", "static", "switch",
  "throw", "trap", "try", "until", "using", "var", "while",
  "workflow", "parallel", "sequence", "inlinescript",
].map((kw) => ({ label: kw, type: "keyword" }));

const PS_CMDLETS: Completion[] = [
  "Add-Member", "Add-Type", "Clear-Host", "Compare-Object",
  "Connect-AzAccount", "Connect-ExchangeOnline", "Connect-MgGraph",
  "Connect-MicrosoftTeams", "Connect-PnPOnline", "Connect-SPOService",
  "ConvertFrom-Csv", "ConvertFrom-Json", "ConvertTo-Csv", "ConvertTo-Html",
  "ConvertTo-Json", "ConvertTo-SecureString", "Copy-Item", "Disable-AzureADUser",
  "Enable-AzureADUser", "Export-Csv", "Format-List", "Format-Table",
  "Get-AzContext", "Get-AzResource", "Get-AzResourceGroup",
  "Get-AzStorageAccount", "Get-AzSubscription", "Get-AzVM",
  "Get-AzureADGroup", "Get-AzureADGroupMember", "Get-AzureADUser",
  "Get-ChildItem", "Get-Command", "Get-Content", "Get-Date", "Get-Help",
  "Get-Host", "Get-Item", "Get-ItemProperty", "Get-Job", "Get-Location",
  "Get-Member", "Get-MgGroup", "Get-MgGroupMember", "Get-MgUser",
  "Get-MgUserMailbox", "Get-Module", "Get-PnPField", "Get-PnPList",
  "Get-PnPListItem", "Get-PnPSite", "Get-PnPWeb", "Get-Process",
  "Get-Service", "Get-SPOSite", "Get-SPOUser", "Get-Unique",
  "Get-UnifiedGroup", "Get-Variable", "Grant-SPOSiteDesignRights",
  "Group-Object", "Import-Csv", "Import-Module", "Invoke-Command",
  "Invoke-Expression", "Invoke-MgGraphRequest", "Invoke-RestMethod",
  "Invoke-WebRequest", "Measure-Object", "Move-Item", "New-AzResourceGroup",
  "New-AzureADGroup", "New-AzureADUser", "New-Item", "New-MgGroup",
  "New-MgUser", "New-Object", "New-PnPList", "New-PnPSite",
  "New-PnPWeb", "New-SPOSite", "New-TeamsApp", "New-UnifiedGroup",
  "New-Variable", "Out-File", "Out-Null", "Out-String", "Read-Host",
  "Remove-AzureADGroupMember", "Remove-AzureADUser", "Remove-Item",
  "Remove-MgGroupMember", "Remove-MgUser", "Remove-Module",
  "Remove-PnPListItem", "Remove-SPOUser", "Remove-Variable",
  "Rename-Item", "Resolve-Path", "Select-Object", "Select-String",
  "Set-AzContext", "Set-AzureADUser", "Set-Content", "Set-ExecutionPolicy",
  "Set-Item", "Set-ItemProperty", "Set-Location", "Set-MgUser",
  "Set-PnPField", "Set-PnPListItem", "Set-PnPSite", "Set-PnPWeb",
  "Set-SPOSite", "Set-Variable", "Sort-Object", "Split-Path",
  "Start-Job", "Start-Process", "Start-Sleep", "Start-Transcript",
  "Stop-Job", "Stop-Process", "Stop-Transcript", "Test-Path",
  "Update-AzureADUser", "Update-MgUser", "Wait-Job", "Where-Object",
  "Write-Debug", "Write-Error", "Write-Host", "Write-Information",
  "Write-Output", "Write-Progress", "Write-Verbose", "Write-Warning",
].map((cmd) => ({ label: cmd, type: "function", boost: 1 }));

const PS_VARIABLES: Completion[] = [
  "$true", "$false", "$null", "$_", "$PSVersionTable", "$PSScriptRoot",
  "$PSCommandPath", "$MyInvocation", "$args", "$input", "$error",
  "$ErrorActionPreference", "$VerbosePreference", "$DebugPreference",
  "$WarningPreference", "$InformationPreference", "$ProgressPreference",
  "$LASTEXITCODE", "$PID", "$PWD", "$HOME", "$env:USERNAME",
  "$env:COMPUTERNAME", "$env:PATH", "$env:TEMP",
].map((v) => ({ label: v, type: "variable" }));

function extractScriptVariables(textBeforeCursor: string): Completion[] {
  const seen = new Set<string>();
  const result: Completion[] = [];
  const varRegex = /\$[A-Za-z_]\w*/g;
  let m: RegExpExecArray | null;
  while ((m = varRegex.exec(textBeforeCursor)) !== null) {
    const name = m[0];
    if (!seen.has(name)) {
      seen.add(name);
      result.push({ label: name, type: "variable", boost: 2 });
    }
  }
  return result;
}

function powerShellCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$-][\w$-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const textBeforeCursor = context.state.doc.sliceString(0, context.pos);
  const scriptVars = extractScriptVariables(textBeforeCursor);

  const from = word.from;
  const typed = word.text.toLowerCase();

  const allOptions: Completion[] = [...PS_CMDLETS, ...PS_KEYWORDS, ...scriptVars, ...PS_VARIABLES];

  const options = allOptions.filter((c) =>
    c.label.toLowerCase().startsWith(typed) ||
    c.label.toLowerCase().includes(typed)
  );

  if (options.length === 0) return null;

  return {
    from,
    options,
    validFor: /^[\w$-]*$/,
  };
}

const psAutocomplete = autocompletion({
  override: [powerShellCompletions],
  activateOnTyping: true,
  maxRenderedOptions: 50,
});

const psTabKeymap = keymap.of([
  {
    key: "Tab",
    run: acceptCompletion,
  },
]);

export const powershellExtensions = [psAutocomplete, psTabKeymap];
