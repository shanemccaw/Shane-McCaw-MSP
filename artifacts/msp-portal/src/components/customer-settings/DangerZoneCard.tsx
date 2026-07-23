import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface DangerZoneCardProps {
  onOpenCancelModal: () => void;
  onOpenDeleteModal: () => void;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({
  onOpenCancelModal,
  onOpenDeleteModal,
}) => {
  return (
    <div className="bg-[#1e2020] border border-[#531b1e] rounded-xl p-5 shadow-sm relative overflow-hidden">
      {/* Top Banner Header */}
      <div className="flex items-start gap-3 pb-4 border-b border-[#3d181a]">
        <div className="w-8 h-8 rounded-lg bg-[#3a1517] border border-[#5a1c1f] flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4 text-[#ffb4ab]" />
        </div>
        <div>
          <h2 className="font-display font-semibold text-base text-[#f1f3f5]">Danger Zone</h2>
          <p className="text-xs text-[#8a919d] mt-0.5">
            Destructive actions that cannot be undone. Exercise extreme caution.
          </p>
        </div>
      </div>

      {/* Grid Sub-Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Cancel Subscription */}
        <div className="bg-[#141616] border border-[#2d1b1d] rounded-lg p-4 flex flex-col justify-between gap-4">
          <div>
            <h3 className="font-medium text-xs text-[#e2e2e2]">Cancel Subscription</h3>
            <p className="text-[11px] text-[#8a919d] mt-1 leading-relaxed">
              Downgrade to the free tier. Your data will be archived for 30 days before permanent deletion.
            </p>
          </div>

          <div>
            <button
              onClick={onOpenCancelModal}
              className="bg-[#1e2020] hover:bg-[#282a2b] border border-[#38393a] text-[#e2e2e2] text-xs font-medium py-2 px-4 rounded-md transition-all active:scale-95"
            >
              Cancel Subscription
            </button>
          </div>
        </div>

        {/* Delete Workspace */}
        <div className="bg-[#141616] border border-[#3d181a] rounded-lg p-4 flex flex-col justify-between gap-4">
          <div>
            <h3 className="font-medium text-xs text-[#fca5a5]">Delete Workspace</h3>
            <p className="text-[11px] text-[#8a919d] mt-1 leading-relaxed">
              Permanently wipe all properties, tenants, and team logs. This action is irreversible.
            </p>
          </div>

          <div>
            <button
              onClick={onOpenDeleteModal}
              className="bg-[#ffb4ab] hover:bg-[#ff9f94] text-[#690005] text-xs font-semibold py-2 px-4 rounded-md transition-all active:scale-95 shadow-sm"
            >
              Delete Entire Workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
