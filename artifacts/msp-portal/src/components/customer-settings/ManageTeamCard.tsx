import React, { useState } from 'react';
import { UserPlus, MoreVertical, Trash2, ShieldCheck } from 'lucide-react';
import { TeamMember, Role } from '../types';

interface ManageTeamCardProps {
  members: TeamMember[];
  searchQuery: string;
  onOpenInviteModal: () => void;
  onUpdateRole: (id: string, newRole: Role) => void;
  onRemoveMember: (id: string) => void;
}

export const ManageTeamCard: React.FC<ManageTeamCardProps> = ({
  members,
  searchQuery,
  onOpenInviteModal,
  onUpdateRole,
  onRemoveMember,
}) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5 flex flex-col justify-between shadow-sm relative">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between pb-4 border-b border-[#282a2b]">
          <div>
            <h2 className="font-display font-semibold text-base text-[#f1f3f5]">Manage Team</h2>
            <p className="text-xs text-[#8a919d] mt-0.5">
              {members.length} Active members on this workspace
            </p>
          </div>
          <button
            onClick={onOpenInviteModal}
            className="flex items-center gap-1.5 bg-[#3881e6] hover:bg-[#479ef5] text-white text-xs font-medium px-3.5 py-1.5 rounded-md transition-all shadow-sm active:scale-95"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Invite Member</span>
          </button>
        </div>

        {/* Members Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#282a2b] text-[10px] font-mono font-medium text-[#8a919d] uppercase tracking-wider">
                <th className="pb-2.5 font-normal">NAME / EMAIL</th>
                <th className="pb-2.5 font-normal px-4">ROLE</th>
                <th className="pb-2.5 font-normal text-right">LAST ACTIVE</th>
                <th className="pb-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#282a2b]/60">
              {filteredMembers.map((member) => (
                <tr key={member.id} className="group hover:bg-[#282a2b]/30 transition-colors">
                  {/* Name & Email */}
                  <td className="py-3 pr-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs font-semibold text-white shrink-0 ${
                          member.avatarBg || 'bg-[#282a2b]'
                        }`}
                      >
                        {member.avatarInitials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#e2e2e2] truncate">
                          {member.name}
                        </p>
                        <p className="text-[11px] text-[#8a919d] truncate">{member.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Role Tag */}
                  <td className="py-3 px-4">
                    <span className="inline-block bg-[#282a2b] text-[#c0c7d3] border border-[#38393a] font-mono text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded">
                      {member.role}
                    </span>
                  </td>

                  {/* Last Active */}
                  <td className="py-3 text-right font-mono text-xs text-[#8a919d]">
                    {member.lastActive}
                  </td>

                  {/* Actions Dropdown */}
                  <td className="py-3 pl-2 text-right relative">
                    {member.role !== 'OWNER' && (
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === member.id ? null : member.id)}
                        className="p-1 rounded text-[#8a919d] hover:text-white hover:bg-[#333535] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {activeMenuId === member.id && (
                      <div className="absolute right-0 top-8 z-30 bg-[#282a2b] border border-[#38393a] rounded-lg shadow-xl p-1 w-36 text-left text-xs animate-in fade-in zoom-in-95">
                        <div className="px-2 py-1 text-[10px] font-mono text-[#8a919d] border-b border-[#38393a]">
                          CHANGE ROLE
                        </div>
                        <button
                          onClick={() => {
                            onUpdateRole(member.id, 'ADMIN');
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-2 py-1.5 hover:bg-[#38393a] rounded text-[#e2e2e2] flex items-center gap-1.5"
                        >
                          <ShieldCheck className="w-3 h-3 text-[#a0c9ff]" />
                          <span>Admin</span>
                        </button>
                        <button
                          onClick={() => {
                            onUpdateRole(member.id, 'MEMBER');
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-2 py-1.5 hover:bg-[#38393a] rounded text-[#e2e2e2]"
                        >
                          Member
                        </button>
                        <div className="border-t border-[#38393a] my-1" />
                        <button
                          onClick={() => {
                            onRemoveMember(member.id);
                            setActiveMenuId(null);
                          }}
                          className="w-full text-left px-2 py-1.5 hover:bg-[#3d1818] rounded text-red-400 flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-[#8a919d]">
                    No members found matching "{searchQuery}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
