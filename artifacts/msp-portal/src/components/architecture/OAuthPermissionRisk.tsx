import React from 'react';
import { OAuthRisk } from './types';

interface OAuthPermissionRiskProps {
  oauthRisk: OAuthRisk;
}

export const OAuthPermissionRisk: React.FC<OAuthPermissionRiskProps> = ({
  oauthRisk,
}) => {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-semibold text-[#e2e2e2]">
            OAuth Permission Risk
          </h2>
          <span className="font-mono text-[10px] font-bold tracking-widest text-[#ffb4ab] uppercase">
            CRITICAL
          </span>
        </div>

        {/* Grant Exposure Bar Chart */}
        <div>
          <div className="font-mono text-[10px] font-semibold tracking-wider text-[#8a919d] uppercase mb-1.5">
            GRANT EXPOSURE LEVEL
          </div>

          <div className="flex h-3.5 w-full overflow-hidden rounded-sm bg-[#121414]">
            <div
              className="bg-[#f59e0b] h-full"
              style={{ width: `${oauthRisk.highPercentage}%` }}
              title={`High Exposure: ${oauthRisk.highPercentage}%`}
            />
            <div
              className="bg-[#479ef5]/70 h-full"
              style={{ width: `${oauthRisk.medPercentage}%` }}
              title={`Medium Exposure: ${oauthRisk.medPercentage}%`}
            />
            <div
              className="bg-[#479ef5] h-full"
              style={{ width: `${oauthRisk.lowPercentage}%` }}
              title={`Low Exposure: ${oauthRisk.lowPercentage}%`}
            />
          </div>

          {/* Labels underneath */}
          <div className="mt-2 flex justify-between font-mono text-[10px] text-[#8a919d]">
            <span>HIGH ({oauthRisk.highPercentage}%)</span>
            <span>MED ({oauthRisk.medPercentage}%)</span>
            <span>LOW ({oauthRisk.lowPercentage}%)</span>
          </div>
        </div>
      </div>

      {/* Bottom 2 Stat Cards */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {/* Most Privileged App */}
        <div className="rounded-md border border-[#282a2b] bg-[#121414] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8a919d]">
            MOST PRIVILEGED APP
          </div>
          <div className="mt-1 truncate font-mono text-xs font-bold text-[#e2e2e2]">
            {oauthRisk.mostPrivilegedApp}
          </div>
        </div>

        {/* Total Admin Consents */}
        <div className="rounded-md border border-[#282a2b] bg-[#121414] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8a919d]">
            TOTAL ADMIN CONSENTS
          </div>
          <div className="mt-1 font-display text-lg font-bold text-[#e2e2e2]">
            {oauthRisk.totalAdminConsents}
          </div>
        </div>
      </div>
    </div>
  );
};
