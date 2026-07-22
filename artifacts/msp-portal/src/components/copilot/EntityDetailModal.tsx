import React from 'react';
import { Cloud, Users, FolderOpen, Database, Shield, X, Wand2 } from 'lucide-react';
import { HeatmapEntity } from './types';

interface EntityDetailModalProps {
  entity: HeatmapEntity | null;
  onClose: () => void;
  onRemediateEntity: (entityId: string) => void;
}

const ENTITY_ICONS: Record<HeatmapEntity['icon'], React.ComponentType<{ className?: string }>> = {
  cloud: Cloud,
  groups: Users,
  folder_open: FolderOpen,
  database: Database,
  shield: Shield
};

export const EntityDetailModal: React.FC<EntityDetailModalProps> = ({
  entity,
  onClose,
  onRemediateEntity
}) => {
  if (!entity) return null;

  const EntityIcon = ENTITY_ICONS[entity.icon];

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="max-w-xl w-full rounded-xl border border-[#404752] p-6 space-y-6 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-[#2b2b2b] pb-4">
          <div className="flex items-center gap-3">
            <span className="text-[#479ef5] bg-[#479ef5]/10 p-2 rounded-lg inline-flex">
              <EntityIcon className="w-7 h-7" />
            </span>
            <div>
              <h3 className="font-display text-xl font-bold text-white">
                {entity.name}
              </h3>
              <p className="font-mono text-xs text-[#8a919d]">
                Type: {entity.type} • Owner: {entity.owner}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Telemetry Grid */}
        <div>
          <h4 className="font-mono text-xs uppercase font-semibold text-[#c0c7d3] mb-3">
            Exposure & Permission Risk Breakdown
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#1a1a1a] border border-[#2b2b2b] rounded-lg">
              <span className="font-mono text-[10px] text-[#8a919d] uppercase block">
                Anonymous Links
              </span>
              <span className="font-display text-xl font-bold text-red-400 mt-1 block">
                {entity.anonymousLinks}
              </span>
            </div>

            <div className="p-3 bg-[#1a1a1a] border border-[#2b2b2b] rounded-lg">
              <span className="font-mono text-[10px] text-[#8a919d] uppercase block">
                External Guest Users
              </span>
              <span className="font-display text-xl font-bold text-amber-400 mt-1 block">
                {entity.externalUsers}
              </span>
            </div>

            <div className="p-3 bg-[#1a1a1a] border border-[#2b2b2b] rounded-lg">
              <span className="font-mono text-[10px] text-[#8a919d] uppercase block">
                Broad Internal Exposure
              </span>
              <span className="font-display text-xl font-bold text-red-500 mt-1 block">
                {entity.broadInternal}
              </span>
            </div>

            <div className="p-3 bg-[#1a1a1a] border border-[#2b2b2b] rounded-lg">
              <span className="font-mono text-[10px] text-[#8a919d] uppercase block">
                High-Permission Apps
              </span>
              <span className="font-display text-xl font-bold text-[#b388ff] mt-1 block">
                {entity.highPermissionApps}
              </span>
            </div>
          </div>
        </div>

        {/* Risk Assessment */}
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg space-y-1">
          <div className="flex items-center gap-2 text-red-400 font-mono text-xs font-bold uppercase">
            <Shield className="w-4 h-4" />
            Copilot Risk Warning
          </div>
          <p className="font-body text-xs text-[#c0c7d3]">
            Microsoft 365 Copilot will index all data accessible via broad internal permissions ({entity.broadInternal} objects). High-permission apps ({entity.highPermissionApps}) may expose sensitive financial or employee records to AI prompt requests.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <span className="font-mono text-[10px] text-[#8a919d]">
            Last Audited: {entity.lastAudited}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 font-mono text-xs border border-[#2b2b2b] text-[#c0c7d3] hover:text-white rounded-md transition-colors"
            >
              CLOSE
            </button>
            <button
              onClick={() => {
                onRemediateEntity(entity.id);
                onClose();
              }}
              className="px-4 py-2 font-mono text-xs font-bold bg-[#479ef5] text-[#003259] hover:bg-sky-400 rounded-md transition-all shadow-md flex items-center gap-1"
            >
              <Wand2 className="w-4 h-4" />
              REVOKE ANONYMOUS LINKS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
