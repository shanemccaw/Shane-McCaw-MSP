import React, { useState } from 'react';

interface RemediationScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemediationScriptModal: React.FC<RemediationScriptModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [executed, setExecuted] = useState(false);

  if (!isOpen) return null;

  const scriptCode = `# Obsidian Admin Copilot - M365 Baseline Remediation Script
# Generated: ${new Date().toISOString()}
# Target: Multi-Tenant Conditional Access & MFA Enforcement

Connect-MgGraph -Scopes "Policy.ReadWrite.ConditionalAccess", "Directory.ReadWrite.All"

$Tenants = @("T-0001-AV", "T-9102-LL", "T-3042-CY")

foreach ($TenantId in $Tenants) {
    Write-Host "[Obsidian] Checking Conditional Access baseline on Tenant $TenantId..." -ForegroundColor Cyan
    
    # Audit MFA Exclusion Groups
    $Exclusions = Get-MgIdentityConditionalAccessPolicy | Where-Object { $_.DisplayName -like "*MFA Exclusion*" }
    
    if ($Exclusions) {
        Write-Host "[Obsidian] Drift found in MFA Exclusions on $TenantId. Resetting policy..." -ForegroundColor Yellow
        # Enforce Zero-Trust Global Baseline Rule
        Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId $Exclusions.Id -State "enabled"
        Write-Host "[Obsidian] Successfully aligned $TenantId to global baseline." -ForegroundColor Green
    }
}

Write-Host "[Obsidian] All target tenants successfully remediated." -ForegroundColor Green`;

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExecute = () => {
    setExecuted(true);
    setTimeout(() => {
      setExecuted(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#111317] border border-[#99cbff]/30 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#99cbff]">code</span>
            <h2 className="text-sm font-bold text-[#e2e2e6] font-mono uppercase">
              Copilot Generated Remediation Script
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-[#bfc7d3] hover:text-[#e2e2e6]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Code body */}
        <div className="p-4 bg-[#0c0e11] font-mono text-xs overflow-x-auto max-h-80">
          <pre className="text-[#a5eeff]/90 leading-relaxed">{scriptCode}</pre>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#1a1c1f] flex items-center justify-between">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[#bfc7d3] hover:text-[#e2e2e6] rounded text-xs font-mono flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">content_copy</span>
            {copied ? 'Copied to Clipboard!' : 'Copy Script'}
          </button>

          <button
            onClick={handleExecute}
            disabled={executed}
            className="bg-[#99cbff] text-[#003355] hover:brightness-110 px-5 py-2 rounded text-xs font-bold font-mono uppercase flex items-center gap-2"
          >
            {executed ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">autorenew</span>
                Executing on Cluster...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">play_arrow</span>
                Run Script Across Tenants
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
