import React, { useState } from 'react';
import { Info, FileCode, FileSpreadsheet, Download, Check } from 'lucide-react';
import { TeamMember } from '../types';

interface DownloadDataCardProps {
  members: TeamMember[];
  onExportToast: (format: 'JSON' | 'CSV') => void;
}

export const DownloadDataCard: React.FC<DownloadDataCardProps> = ({
  members,
  onExportToast,
}) => {
  const [downloadingFormat, setDownloadingFormat] = useState<'JSON' | 'CSV' | null>(null);

  const handleExportJSON = () => {
    setDownloadingFormat('JSON');
    const data = {
      workspace: 'Tenant Intelligence Workspace',
      exportedAt: new Date().toISOString(),
      auditTrailStatus: 'Logged',
      members: members,
      retentionPolicy: 'Standard (7 Years)',
      mfaStatus: 'Enabled',
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(data, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `tenant_intel_archive_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setTimeout(() => {
      setDownloadingFormat(null);
      onExportToast('JSON');
    }, 600);
  };

  const handleExportCSV = () => {
    setDownloadingFormat('CSV');
    const headers = ['ID,Name,Email,Role,LastActive'];
    const rows = members.map(
      (m) => `"${m.id}","${m.name}","${m.email}","${m.role}","${m.lastActive}"`
    );
    const csvContent = `data:text/csv;charset=utf-8,${encodeURIComponent(
      [headers, ...rows].join('\n')
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', csvContent);
    downloadAnchor.setAttribute('download', `tenant_intel_members_${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setTimeout(() => {
      setDownloadingFormat(null);
      onExportToast('CSV');
    }, 600);
  };

  return (
    <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5 flex flex-col justify-between shadow-sm">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div>
          <h2 className="font-display font-semibold text-base text-[#f1f3f5]">Download Data</h2>
          <p className="text-xs text-[#8a919d] mt-0.5 leading-relaxed">
            Access a full archive of your workspace metadata and interaction logs.
          </p>
        </div>

        {/* Audit Callout Notice */}
        <div className="bg-[#141616] border border-[#282a2b] rounded-lg p-3 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-[#a0c9ff] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#a8b1bf] leading-relaxed italic">
            All exports are logged in the global audit trail. Data is compiled in real-time.
          </p>
        </div>
      </div>

      {/* Export Action Buttons */}
      <div className="flex flex-col gap-2.5 mt-5">
        <button
          onClick={handleExportJSON}
          disabled={downloadingFormat !== null}
          className="flex items-center justify-center gap-2 bg-[#282a2b] hover:bg-[#333535] active:bg-[#38393a] border border-[#38393a] text-[#e2e2e2] text-xs font-medium py-2 px-4 rounded-md transition-all shadow-xs disabled:opacity-50"
        >
          {downloadingFormat === 'JSON' ? (
            <Check className="w-4 h-4 text-green-400 animate-in zoom-in-50" />
          ) : (
            <FileCode className="w-4 h-4 text-[#a0c9ff]" />
          )}
          <span>{downloadingFormat === 'JSON' ? 'Exporting JSON...' : 'Export JSON'}</span>
        </button>

        <button
          onClick={handleExportCSV}
          disabled={downloadingFormat !== null}
          className="flex items-center justify-center gap-2 bg-[#282a2b] hover:bg-[#333535] active:bg-[#38393a] border border-[#38393a] text-[#e2e2e2] text-xs font-medium py-2 px-4 rounded-md transition-all shadow-xs disabled:opacity-50"
        >
          {downloadingFormat === 'CSV' ? (
            <Check className="w-4 h-4 text-green-400 animate-in zoom-in-50" />
          ) : (
            <FileSpreadsheet className="w-4 h-4 text-[#dab9ff]" />
          )}
          <span>{downloadingFormat === 'CSV' ? 'Exporting CSV...' : 'Export CSV'}</span>
        </button>
      </div>
    </div>
  );
};
