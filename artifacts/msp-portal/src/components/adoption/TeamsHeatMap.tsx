import React, { useState } from 'react';
import { HeatMapRow, IntensityLevel, Department } from './types';
import { Info } from 'lucide-react';

interface TeamsHeatMapProps {
  data: HeatMapRow[];
  selectedDepartment: Department;
  onSelectDepartment: (dept: Department) => void;
}

export const TeamsHeatMap: React.FC<TeamsHeatMapProps> = ({
  data,
  selectedDepartment,
  onSelectDepartment
}) => {
  const [activeCell, setActiveCell] = useState<{ dept: string; type: string; level: IntensityLevel; score: number } | null>(null);

  const getCellClasses = (level: IntensityLevel) => {
    switch (level) {
      case 'High':
        return 'bg-[#479ef5] text-[#001c37] font-bold shadow-sm hover:brightness-110';
      case 'Mid':
        return 'bg-amber-500 text-[#2a1a00] font-bold shadow-sm hover:brightness-110';
      case 'Low':
        return 'bg-red-500 text-white font-bold shadow-sm hover:brightness-110';
      default:
        return 'bg-gray-700 text-white';
    }
  };

  const filteredData = selectedDepartment === 'All' 
    ? data 
    : data.filter(d => d.department === selectedDepartment);

  return (
    <section className="glass-card p-6 rounded-xl flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="font-headline text-lg font-bold text-white tracking-tight flex items-center gap-2">
            Teams Activity Heat Map
          </h2>
          <p className="text-xs text-[#8a919d] font-body mt-0.5">
            Cross-department engagement intensity matrix
          </p>
        </div>
        <span className="font-mono-data text-[10px] text-[#8a919d] bg-[#1a1c1c] px-2.5 py-1 rounded border border-white/5 uppercase tracking-wider">
          Last 30 Days
        </span>
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="font-mono-data text-xs text-[#c0c7d3] uppercase border-b border-white/10">
              <th className="pb-3 font-semibold">Department</th>
              <th className="pb-3 text-center font-semibold">Meetings</th>
              <th className="pb-3 text-center font-semibold">Chats</th>
              <th className="pb-3 text-center font-semibold">Channels</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredData.map((row) => (
              <tr 
                key={row.department}
                className={`transition-colors ${selectedDepartment === row.department ? 'bg-[#479ef5]/10' : 'hover:bg-white/[0.02]'}`}
              >
                {/* Department Name */}
                <td className="py-3 font-body text-sm font-medium text-[#e2e2e2]">
                  <button
                    onClick={() => onSelectDepartment(selectedDepartment === row.department ? 'All' : row.department)}
                    className="hover:text-[#479ef5] transition-colors flex items-center gap-1.5"
                  >
                    <span>{row.department}</span>
                    {selectedDepartment === row.department && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#479ef5]"></span>
                    )}
                  </button>
                </td>

                {/* Meetings */}
                <td className="py-2 px-1.5 text-center">
                  <div
                    onMouseEnter={() => setActiveCell({ dept: row.department, type: 'Meetings', level: row.meetings, score: row.meetingScore })}
                    onMouseLeave={() => setActiveCell(null)}
                    className={`h-8 rounded-lg flex items-center justify-center font-mono-data text-xs cursor-pointer transition-all ${getCellClasses(row.meetings)}`}
                  >
                    {row.meetings}
                  </div>
                </td>

                {/* Chats */}
                <td className="py-2 px-1.5 text-center">
                  <div
                    onMouseEnter={() => setActiveCell({ dept: row.department, type: 'Chats', level: row.chats, score: row.chatScore })}
                    onMouseLeave={() => setActiveCell(null)}
                    className={`h-8 rounded-lg flex items-center justify-center font-mono-data text-xs cursor-pointer transition-all ${getCellClasses(row.chats)}`}
                  >
                    {row.chats}
                  </div>
                </td>

                {/* Channels */}
                <td className="py-2 px-1.5 text-center">
                  <div
                    onMouseEnter={() => setActiveCell({ dept: row.department, type: 'Channels', level: row.channels, score: row.channelScore })}
                    onMouseLeave={() => setActiveCell(null)}
                    className={`h-8 rounded-lg flex items-center justify-center font-mono-data text-xs cursor-pointer transition-all ${getCellClasses(row.channels)}`}
                  >
                    {row.channels}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cell Hover Status Footer */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-[#8a919d]">
        <div className="flex items-center gap-3 font-mono-data text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-[#479ef5]"></span> High (&gt;75%)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-amber-500"></span> Mid (40-75%)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-red-500"></span> Low (&lt;40%)
          </span>
        </div>

        {activeCell ? (
          <div className="font-mono-data text-[11px] text-[#479ef5] bg-[#1a1c1c] px-2 py-0.5 rounded border border-[#479ef5]/30">
            {activeCell.dept} {activeCell.type}: {activeCell.score}/100 ({activeCell.level})
          </div>
        ) : (
          <span className="font-mono-data text-[10px] text-[#8a919d]">Hover cell for score</span>
        )}
      </div>
    </section>
  );
};
