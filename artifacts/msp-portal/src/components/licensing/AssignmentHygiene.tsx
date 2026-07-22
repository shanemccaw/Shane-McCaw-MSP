import React from 'react';
import { HygieneDeptRow } from './types';
import { Grid, ShieldAlert, ArrowUpRight } from 'lucide-react';

interface AssignmentHygieneProps {
  data: HygieneDeptRow[];
  onCellClick: (department: string, category: 'inactive' | 'disabled' | 'overlap', count: number) => void;
}

export const AssignmentHygiene: React.FC<AssignmentHygieneProps> = ({ data, onCellClick }) => {
  const getCellStyle = (val: number, cat: 'inactive' | 'disabled' | 'overlap') => {
    if (val >= 15) {
      return 'bg-[#ffb4ab]/20 border border-[#ffb4ab]/50 text-[#ffb4ab] font-bold';
    }
    if (val >= 8) {
      return 'bg-yellow-500/20 border border-yellow-500/50 text-yellow-300 font-bold';
    }
    return 'bg-green-500/10 border border-green-500/30 text-green-400 font-medium';
  };

  const formatNumber = (num: number) => (num < 10 ? `0${num}` : `${num}`);

  return (
    <div className="bg-card border border-border p-6 rounded-xl h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Grid className="w-5 h-5 text-[#cda3ff]" />
            <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
              Assignment Hygiene
            </h3>
          </div>
          <span className="text-[10px] font-mono-tech text-[#c0c7d3] bg-[#1a1c1c] px-2 py-1 rounded border border-white/5">
            Cross-Tenant Matrix
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2.5 text-center text-xs font-mono-tech">
          {/* Header Row */}
          <div></div>
          <div className="text-[#c0c7d3] py-1 text-[11px] uppercase tracking-wider font-semibold">
            Inactive
          </div>
          <div className="text-[#c0c7d3] py-1 text-[11px] uppercase tracking-wider font-semibold">
            Disabled
          </div>
          <div className="text-[#c0c7d3] py-1 text-[11px] uppercase tracking-wider font-semibold">
            Overlap
          </div>

          {/* Department Rows */}
          {data.map((row) => (
            <React.Fragment key={row.department}>
              <div className="text-left font-bold text-[#e2e2e2] py-2.5 flex items-center">
                {row.department}
              </div>

              {/* Inactive Cell */}
              <button
                onClick={() => onCellClick(row.department, 'inactive', row.inactive)}
                className={`${getCellStyle(
                  row.inactive,
                  'inactive'
                )} rounded p-2.5 flex items-center justify-center hover:scale-[1.03] transition-transform cursor-pointer relative group`}
              >
                <span>{formatNumber(row.inactive)}</span>
                <ArrowUpRight className="w-2.5 h-2.5 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              {/* Disabled Cell */}
              <button
                onClick={() => onCellClick(row.department, 'disabled', row.disabled)}
                className={`${getCellStyle(
                  row.disabled,
                  'disabled'
                )} rounded p-2.5 flex items-center justify-center hover:scale-[1.03] transition-transform cursor-pointer relative group`}
              >
                <span>{formatNumber(row.disabled)}</span>
                <ArrowUpRight className="w-2.5 h-2.5 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              {/* Overlap Cell */}
              <button
                onClick={() => onCellClick(row.department, 'overlap', row.overlap)}
                className={`${getCellStyle(
                  row.overlap,
                  'overlap'
                )} rounded p-2.5 flex items-center justify-center hover:scale-[1.03] transition-transform cursor-pointer relative group`}
              >
                <span>{formatNumber(row.overlap)}</span>
                <ArrowUpRight className="w-2.5 h-2.5 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 flex items-center gap-2 text-[11px] font-mono-tech text-[#c0c7d3]">
        <ShieldAlert className="w-3.5 h-3.5 text-[#ffb4ab]" />
        <span>Click any cell to inspect individual user license flags.</span>
      </div>
    </div>
  );
};
