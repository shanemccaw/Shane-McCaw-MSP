import React, { useState } from 'react';
import { AffectedUser } from './types';
import { X, Search, ShieldAlert, UserCheck, Filter, ArrowRight } from 'lucide-react';

interface UserInspectModalProps {
  title: string;
  subtitle: string;
  users: AffectedUser[];
  onClose: () => void;
  onFixUser: (userId: string) => void;
}

export const UserInspectModal: React.FC<UserInspectModalProps> = ({
  title,
  subtitle,
  users,
  onClose,
  onFixUser,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');

  const departments = ['All', ...Array.from(new Set(users.map((u) => u.department)))];

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = deptFilter === 'All' || u.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#1a1c1c] border border-white/10 rounded-xl max-w-3xl w-full p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#c0c7d3] hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-4">
          <span className="text-[10px] font-mono-tech text-[#479ef5] uppercase tracking-wider">
            Tenant Audit Drilldown
          </span>
          <h3 className="font-headline text-xl font-bold text-[#e2e2e2]">
            {title}
          </h3>
          <p className="text-xs text-[#c0c7d3] mt-1">{subtitle}</p>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#c0c7d3]" />
            <input
              type="text"
              placeholder="Search user, email, or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#121414] border border-white/10 rounded-md pl-9 pr-3 py-2 text-xs font-mono-tech text-[#e2e2e2] placeholder-[#c0c7d3]/50 focus:outline-none focus:border-[#479ef5]"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#c0c7d3]" />
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="bg-[#121414] border border-white/10 rounded-md px-3 py-2 text-xs font-mono-tech text-[#e2e2e2] focus:outline-none focus:border-[#479ef5]"
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  Dept: {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* User Table */}
        <div className="flex-1 overflow-y-auto border border-white/5 rounded-lg bg-[#121414]">
          <table className="w-full text-left font-mono-tech text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-[#1e2020] text-[#c0c7d3] sticky top-0 z-10">
                <th className="py-2.5 px-3">User</th>
                <th className="py-2.5 px-3">Dept</th>
                <th className="py-2.5 px-3">Assigned SKU</th>
                <th className="py-2.5 px-3">Issue Flagged</th>
                <th className="py-2.5 px-3 text-right">Remediation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[#e2e2e2]">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#c0c7d3]">
                    No accounts matching current criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#e2e2e2]">{user.name}</div>
                      <div className="text-[10px] text-[#c0c7d3]">{user.email}</div>
                    </td>
                    <td className="py-2.5 px-3 text-[#c0c7d3]">{user.department}</td>
                    <td className="py-2.5 px-3">
                      <span className="bg-[#479ef5]/10 text-[#a0c9ff] px-1.5 py-0.5 rounded text-[10px]">
                        {user.sku}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[#ffb4ab] flex items-center gap-1 text-[11px]">
                        <ShieldAlert className="w-3 h-3 inline shrink-0" />
                        {user.issue}
                      </span>
                      <div className="text-[10px] text-[#c0c7d3]">
                        Active: {user.lastActive}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => onFixUser(user.id)}
                        className="px-2.5 py-1 bg-[#282a2b] hover:bg-[#479ef5] hover:text-[#003259] text-[#a0c9ff] rounded text-[10px] font-bold transition-all inline-flex items-center gap-1"
                      >
                        <span>{user.potentialAction}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center text-xs font-mono-tech text-[#c0c7d3]">
          <span>Showing {filteredUsers.length} flagged accounts</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#282a2b] hover:bg-[#333535] text-[#e2e2e2] rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
