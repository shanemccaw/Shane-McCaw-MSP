import React from 'react';
import { CAPolicy } from './types';

interface ConditionalAccessMapProps {
  policies: CAPolicy[];
  onSelectPolicy?: (policy: CAPolicy) => void;
}

export const ConditionalAccessMap: React.FC<ConditionalAccessMapProps> = ({
  policies,
  onSelectPolicy,
}) => {
  const getStatusDot = (status: 'aligned' | 'misaligned' | 'unused') => {
    switch (status) {
      case 'aligned':
        return (
          <div className="flex items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
          </div>
        );
      case 'misaligned':
        return (
          <div className="flex items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b] shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
          </div>
        );
      case 'unused':
      default:
        return (
          <div className="flex items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full bg-[#404752]" />
          </div>
        );
    }
  };

  const getBadge = (enforcement: CAPolicy['enforcement']) => {
    switch (enforcement) {
      case 'ACTIVE':
        return (
          <span className="inline-flex rounded bg-[#001c37] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#a0c9ff] border border-[#479ef5]/30">
            ACTIVE
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex rounded bg-[#422006] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#f59e0b] border border-[#f59e0b]/40">
            WARNING
          </span>
        );
      case 'AUDIT':
        return (
          <span className="inline-flex rounded bg-[#282a2b] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#8a919d] border border-[#333535]">
            AUDIT
          </span>
        );
      default:
        return (
          <span className="inline-flex rounded bg-[#1e2020] px-2 py-0.5 font-mono text-[10px] text-[#8a919d]">
            {enforcement}
          </span>
        );
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-2 border-b border-[#282a2b]">
        <div>
          <h2 className="font-display text-base font-semibold text-[#e2e2e2]">
            Conditional Access Architecture Map
          </h2>
          <p className="text-xs text-[#8a919d]">
            Policy alignment across environmental conditions
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 font-mono text-xs text-[#c0c7d3]">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Aligned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            <span>Misaligned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#404752]" />
            <span>Unused</span>
          </div>
        </div>
      </div>

      {/* Table Matrix */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-[#282a2b] text-[10px] font-medium tracking-wider text-[#8a919d]">
              <th className="pb-3 pt-1 uppercase">POLICY NAME</th>
              <th className="pb-3 pt-1 text-center uppercase">DEVICE</th>
              <th className="pb-3 pt-1 text-center uppercase">LOCATION</th>
              <th className="pb-3 pt-1 text-center uppercase">RISK</th>
              <th className="pb-3 pt-1 text-center uppercase">APP</th>
              <th className="pb-3 pt-1 text-right uppercase">ENFORCEMENT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#282a2b]/60">
            {policies.map((pol) => (
              <tr
                key={pol.id}
                onClick={() => onSelectPolicy?.(pol)}
                className="group cursor-pointer hover:bg-[#282a2b]/40 transition-colors"
              >
                <td className="py-3.5 font-medium text-[#e2e2e2] group-hover:text-[#a0c9ff]">
                  {pol.name}
                </td>
                <td className="py-3.5 text-center">{getStatusDot(pol.device)}</td>
                <td className="py-3.5 text-center">{getStatusDot(pol.location)}</td>
                <td className="py-3.5 text-center">{getStatusDot(pol.risk)}</td>
                <td className="py-3.5 text-center">{getStatusDot(pol.app)}</td>
                <td className="py-3.5 text-right">{getBadge(pol.enforcement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
