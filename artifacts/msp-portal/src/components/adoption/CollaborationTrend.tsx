import React from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend 
} from 'recharts';
import { CollaborationTrendPoint } from './types';

interface CollaborationTrendProps {
  data: CollaborationTrendPoint[];
  inactiveSites?: number;
  lowCollabSites?: number;
  highCollabSites?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a1c1c] p-3 rounded-lg border border-white/10 shadow-xl font-mono-data text-xs">
        <p className="text-white font-bold mb-1.5">{label}</p>
        <p className="text-[#479ef5] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#479ef5]"></span>
          Edits: {payload[0]?.value}
        </p>
        <p className="text-[#dab9ff] flex items-center gap-1.5 mt-0.5">
          <span className="w-2 h-2 rounded-full bg-[#dab9ff]"></span>
          Shares: {payload[1]?.value}
        </p>
      </div>
    );
  }
  return null;
};

export const CollaborationTrend: React.FC<CollaborationTrendProps> = ({
  data,
  inactiveSites = 42,
  lowCollabSites = 128,
  highCollabSites = 672
}) => {
  return (
    <section className="glass-card p-6 rounded-xl flex flex-col justify-between h-full">
      {/* Header & Legend */}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div>
          <h2 className="font-headline text-lg font-bold text-white tracking-tight">
            Collaboration Activity Trend
          </h2>
          <p className="text-xs text-[#8a919d] font-body mt-0.5">
            Document edits & sharing events across SharePoint & OneDrive
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono-data text-xs">
          <span className="flex items-center gap-1.5 text-white">
            <span className="w-2.5 h-2.5 bg-[#479ef5] rounded-full"></span> Edits
          </span>
          <span className="flex items-center gap-1.5 text-white">
            <span className="w-2.5 h-2.5 bg-[#dab9ff] rounded-full"></span> Shares
          </span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-48 my-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis 
              dataKey="day" 
              stroke="#8a919d" 
              fontSize={10} 
              tickLine={false} 
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              fontFamily="JetBrains Mono"
            />
            <YAxis 
              stroke="#8a919d" 
              fontSize={10} 
              tickLine={false} 
              axisLine={false}
              fontFamily="JetBrains Mono"
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }} />
            <Bar dataKey="edits" fill="#479ef5" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="shares" fill="#dab9ff" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer 3 metrics */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10 mt-2">
        <div>
          <p className="font-mono-data text-[10px] text-[#8a919d] uppercase tracking-wider">
            Inactive Sites
          </p>
          <p className="font-headline text-xl lg:text-2xl font-bold text-red-400 mt-0.5">
            {inactiveSites}
          </p>
        </div>
        <div>
          <p className="font-mono-data text-[10px] text-[#8a919d] uppercase tracking-wider">
            Low-collaboration
          </p>
          <p className="font-headline text-xl lg:text-2xl font-bold text-amber-500 mt-0.5">
            {lowCollabSites}
          </p>
        </div>
        <div>
          <p className="font-mono-data text-[10px] text-[#8a919d] uppercase tracking-wider">
            High-collaboration
          </p>
          <p className="font-headline text-xl lg:text-2xl font-bold text-[#479ef5] mt-0.5">
            {highCollabSites}
          </p>
        </div>
      </div>
    </section>
  );
};
