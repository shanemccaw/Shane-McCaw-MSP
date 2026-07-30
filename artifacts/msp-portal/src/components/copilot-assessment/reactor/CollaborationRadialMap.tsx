import React from 'react';
import { Users, Globe, Link2, ShieldAlert, AlertCircle } from 'lucide-react';

export interface ExposureZone {
  id: string;
  name: string;
  type: 'internal' | 'guest' | 'federated' | 'public' | 'anonymous';
  exposureLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  activeLinksCount: number;
  sensitivityOverlaps: string[]; // e.g. ["PHI", "CUI"]
}

interface CollaborationRadialMapProps {
  mode: 'projected' | 'soc' | 'redteam';
  zones: ExposureZone[];
  onSelectZone?: (zoneId: string) => void;
  selectedZoneId?: string;
}

export const CollaborationRadialMap: React.FC<CollaborationRadialMapProps> = ({
  mode,
  zones,
  onSelectZone,
  selectedZoneId
}) => {
  const isRedTeam = mode === 'redteam';

  const getZoneIcon = (type: string) => {
    switch (type) {
      case 'guest': return <Users className="w-3.5 h-3.5 text-rose-400" />;
      case 'federated': return <Globe className="w-3.5 h-3.5 text-amber-400" />;
      case 'public': return <Globe className="w-3.5 h-3.5 text-sky-400" />;
      case 'anonymous': return <Link2 className="w-3.5 h-3.5 text-rose-500" />;
      default: return <Users className="w-3.5 h-3.5 text-emerald-400" />;
    }
  };

  return (
    <div className="bg-[#080C16] border border-white/10 rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between h-full">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Collaboration Exposure Zones
            </h4>
            <p className="text-[9.5px] text-slate-400">
              Cross-boundary access vectors & oversharing links
            </p>
          </div>
        </div>
        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800 uppercase">
          {zones.length} Zones Tracked
        </span>
      </div>

      {/* Exposure Zones List */}
      <div className="space-y-2 flex-1 overflow-y-auto scrollbar-thin pr-1">
        {zones.map((zone) => {
          const isSelected = selectedZoneId === zone.id;
          const isCritical = zone.exposureLevel === 'Critical' || zone.exposureLevel === 'High';

          return (
            <div
              key={zone.id}
              onClick={() => onSelectZone && onSelectZone(zone.id)}
              className={`p-2.5 rounded-xl border transition-all duration-300 cursor-pointer relative group ${
                isSelected
                  ? 'bg-rose-950/40 border-rose-500 ring-1 ring-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                  : 'bg-black/50 border-white/10 hover:border-slate-700 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-slate-900 border border-white/10">
                    {getZoneIcon(zone.type)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-bold text-white group-hover:text-rose-300 transition-colors">
                        {zone.name}
                      </span>
                      <span className="text-[8.5px] font-mono text-slate-400">
                        ({zone.activeLinksCount} links)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {zone.sensitivityOverlaps.map((sen, idx) => (
                        <span key={idx} className="text-[8px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800 px-1.5 py-0.1 rounded">
                          ⚠️ {sen} Exposed
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  isCritical
                    ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}>
                  {zone.exposureLevel}
                </span>
              </div>

              {/* Dotted Connection Beam Representation */}
              <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[9px] font-mono text-slate-400">
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isRedTeam ? 'bg-rose-500' : 'bg-sky-400'} animate-ping`} />
                  <span>{mode === 'projected' ? 'Potential Ray:' : 'Active Exposure Line:'}</span>
                </span>
                <span className="text-slate-300 font-semibold">
                  {zone.sensitivityOverlaps.join(' + ')} accessible
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* OVERLAP EXPOSURE CALLOUT BANNER */}
      <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-[10px] space-y-1">
        <div className="flex items-center space-x-1.5 text-rose-300 font-bold uppercase font-mono">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
          <span>Critical Exposure Overlaps</span>
        </div>
        <p className="text-rose-200/90 text-[10px] leading-relaxed">
          "PHI records accessible to external guests in 14 public Teams channels without labels."
        </p>
      </div>

    </div>
  );
};
