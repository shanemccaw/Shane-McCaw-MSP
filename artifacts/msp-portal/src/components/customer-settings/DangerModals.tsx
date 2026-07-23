import React, { useState } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';

interface CancelSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const CancelSubscriptionModal: React.FC<CancelSubscriptionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#1e2020] border border-[#3d181a] rounded-xl max-w-md w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-[#282a2b]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 pb-4 border-b border-[#3d181a]">
          <div className="p-2 rounded-lg bg-[#3a1517] border border-[#5a1c1f] text-[#ffb4ab]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base text-[#f1f3f5]">Cancel Subscription</h3>
            <p className="text-xs text-[#8a919d]">Confirm subscription downgrade</p>
          </div>
        </div>

        <div className="mt-4 text-xs text-[#c0c7d3] space-y-2 leading-relaxed">
          <p>
            Are you sure you want to cancel your active subscription? Your workspace will be downgraded to the free tier at the end of the billing period.
          </p>
          <p className="text-[#8a919d]">
            Your workspace data will be preserved in archive for 30 days. You can reactivate anytime during this period.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-[#282a2b]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#8a919d] hover:text-white rounded-md hover:bg-[#282a2b]"
          >
            Keep Subscription
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 text-xs font-medium bg-[#3d181a] border border-[#5a1c1f] text-[#ffb4ab] hover:bg-[#5a1c1f] rounded-md transition-colors"
          >
            Confirm Cancelation
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => void;
}

export const DeleteWorkspaceModal: React.FC<DeleteWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onConfirmDelete,
}) => {
  const [confirmInput, setConfirmInput] = useState('');

  if (!isOpen) return null;

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmInput !== 'DELETE') return;
    onConfirmDelete();
    onClose();
    setConfirmInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#1e2020] border border-[#690005] rounded-xl max-w-md w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-[#282a2b]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 pb-4 border-b border-[#3d181a]">
          <div className="p-2 rounded-lg bg-[#690005] text-[#ffdad6]">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base text-[#f1f3f5]">Delete Workspace</h3>
            <p className="text-xs text-[#ffb4ab]">Irreversible Action</p>
          </div>
        </div>

        <form onSubmit={handleDelete} className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-[#c0c7d3] leading-relaxed">
            This will permanently delete all properties, tenant records, team access, and audit logs associated with <strong className="text-white">Tenant Intelligence</strong>.
          </p>

          <div className="bg-[#141616] p-3 rounded-md border border-[#3d181a]">
            <label className="block text-[11px] font-mono text-[#8a919d] mb-1">
              TYPE <span className="text-white font-bold">DELETE</span> TO CONFIRM:
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-[#1e2020] border border-[#3d181a] rounded py-1.5 px-2.5 font-mono text-xs text-white focus:outline-none focus:border-[#ffb4ab]"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#282a2b]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#8a919d] hover:text-white rounded-md hover:bg-[#282a2b]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={confirmInput !== 'DELETE'}
              className="px-4 py-2 text-xs font-semibold bg-[#ffb4ab] text-[#690005] hover:bg-[#ff9f94] disabled:opacity-40 rounded-md transition-all shadow-sm"
            >
              Permanently Wipe Workspace
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
