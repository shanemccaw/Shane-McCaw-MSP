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
      case 'guest': return <Users className="w-3.5 h-3.5 text-destructive" />;
      case 'federated': return <Globe className="w-3.5 h-3.5 text-status-amber" />;
      case 'public': return <Globe className="w-3.5 h-3.5 text-primary" />;
      case 'anonymous': return <Link2 className="w-3.5 h-3.5 text-destructive" />;
      default: return <Users className="w-3.5 h-3.5 text-status-green" />;
    }
  };

  return (
    <div className="bg-background border border-border rounded-2xl p-4 space-y-3 relative overflow-hidden flex flex-col justify-between h-full">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded bg-destructive/20 border border-destructive/40 flex items-center justify-center text-destructive">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
              Collaboration Exposure Zones
            </h4>
            <p className="text-[9.5px] text-muted-foreground">
              Cross-boundary access vectors & oversharing links
            </p>
          </div>
        </div>
        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 uppercase">
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
                  ? 'bg-destructive/10/40 border-destructive ring-1 ring-destructive/50 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
                  : 'bg-muted/50 border-border hover:border-border hover:bg-secondary/60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-secondary border border-border">
                    {getZoneIcon(zone.type)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-bold text-foreground group-hover:text-destructive transition-colors">
                        {zone.name}
                      </span>
                      <span className="text-[8.5px] font-mono text-muted-foreground">
                        ({zone.activeLinksCount} links)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {zone.sensitivityOverlaps.map((sen, idx) => (
                        <span key={idx} className="text-[8px] font-mono font-bold bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.1 rounded">
                          ⚠️ {sen} Exposed
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  isCritical
                    ? 'bg-destructive/10 text-destructive border-destructive/30 animate-pulse'
                    : 'bg-status-amber/10 text-status-amber border-status-amber/30'
                }`}>
                  {zone.exposureLevel}
                </span>
              </div>

              {/* Dotted Connection Beam Representation */}
              <div className="mt-2 pt-1.5 border-t border-border/50 flex items-center justify-between text-[9px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isRedTeam ? 'bg-destructive' : 'bg-primary'} animate-ping`} />
                  <span>{mode === 'projected' ? 'Potential Ray:' : 'Active Exposure Line:'}</span>
                </span>
                <span className="text-muted-foreground font-semibold">
                  {zone.sensitivityOverlaps.join(' + ')} accessible
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* OVERLAP EXPOSURE CALLOUT BANNER */}
      <div className="p-2.5 rounded-xl bg-destructive/10/40 border border-destructive/40 text-[10px] space-y-1">
        <div className="flex items-center space-x-1.5 text-destructive font-bold uppercase font-mono">
          <ShieldAlert className="w-3.5 h-3.5 text-destructive animate-pulse" />
          <span>Critical Exposure Overlaps</span>
        </div>
        <p className="text-destructive/90 text-[10px] leading-relaxed">
          "PHI records accessible to external guests in 14 public Teams channels without labels."
        </p>
      </div>

    </div>
  );
};
