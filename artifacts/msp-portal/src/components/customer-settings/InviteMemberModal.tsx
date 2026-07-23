import React, { useState } from 'react';
import { X, UserPlus, Shield } from 'lucide-react';
import { Role } from '../types';

interface InviteMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: (name: string, email: string, role: Role) => void;
}

export const InviteMemberModal: React.FC<InviteMemberModalProps> = ({
  isOpen,
  onClose,
  onInvite,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    onInvite(name.trim(), email.trim(), role);
    setName('');
    setEmail('');
    setRole('MEMBER');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl max-w-md w-full p-6 shadow-2xl relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#8a919d] hover:text-white p-1 rounded-md hover:bg-[#282a2b]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2.5 pb-4 border-b border-[#282a2b]">
          <div className="p-2 rounded-lg bg-[#3881e6]/10 text-[#479ef5]">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-base text-[#f1f3f5]">Invite Team Member</h3>
            <p className="text-xs text-[#8a919d]">Add a new user to your workspace.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-5">
          <div>
            <label className="block text-xs font-medium text-[#c0c7d3] mb-1.5">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Elena Rostova"
              className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] placeholder-[#525866] focus:outline-none focus:border-[#479ef5]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#c0c7d3] mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. e.rostova@tenant-intel.io"
              className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] placeholder-[#525866] focus:outline-none focus:border-[#479ef5]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#c0c7d3] mb-1.5">Workspace Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] focus:outline-none focus:border-[#479ef5]"
            >
              <option value="ADMIN">ADMIN - Full administrative access</option>
              <option value="MEMBER">MEMBER - Standard access</option>
              <option value="VIEWER">VIEWER - Read-only access</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2.5 mt-2 pt-4 border-t border-[#282a2b]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#8a919d] hover:text-white rounded-md hover:bg-[#282a2b]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-[#3881e6] hover:bg-[#479ef5] text-white rounded-md transition-colors"
            >
              Send Invitation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
