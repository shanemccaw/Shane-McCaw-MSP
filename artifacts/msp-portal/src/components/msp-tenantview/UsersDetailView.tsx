import React, { useState } from 'react';
import { Tenant } from '@/components/msp-tenantview/types';
import { mockUserList } from '@/components/msp-tenantview/mockData';

interface UsersDetailViewProps {
  tenant: Tenant;
}

export const UsersDetailView: React.FC<UsersDetailViewProps> = ({ tenant }) => {
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState(mockUserList);
  const [toast, setToast] = useState<string | null>(null);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(userSearch.toLowerCase()) || 
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.role.toLowerCase().includes(userSearch.toLowerCase())
  );

  const enforceMFA = (email: string) => {
    setUsers(users.map(u => u.email === email ? { ...u, mfa: 'Enforced', status: 'Active' } : u));
    setToast(`MFA enforced for ${email}`);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-6 relative">
      {toast && (
        <div className="fixed top-20 right-8 bg-[#00daf8]/20 border border-[#00daf8] text-white text-xs px-4 py-2.5 rounded-lg font-mono shadow-2xl z-50">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="glass-panel rounded-xl p-6 border-l-4 border-[#99cbff] flex justify-between items-center">
        <div>
          <span className="text-[10px] font-mono text-[#99cbff] font-bold uppercase tracking-widest">
            DIRECTORY & USER MANAGEMENT
          </span>
          <h2 className="text-2xl font-bold text-[#e2e2e6] mt-1">{tenant.name} Users & Roles</h2>
          <p className="text-xs text-[#bfc7d3] mt-1">
            Total {tenant.usersCount} Active Users • {tenant.mfaPercentage}% MFA Enrolled • {tenant.licensesTotal - tenant.licensesAvailable} Licenses Assigned
          </p>
        </div>
        <div className="w-64">
          <input
            type="text"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search users or roles..."
            className="w-full bg-[#111317] border border-[#3f4751]/40 rounded-lg px-3 py-1.5 text-xs text-[#e2e2e6] placeholder:text-[#bfc7d3]/50 focus:outline-none focus:border-[#99cbff]"
          />
        </div>
      </div>

      {/* User Table */}
      <div className="glass-panel rounded-xl p-6 border border-[#3f4751]/20">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#3f4751]/20 text-[10px] font-mono text-[#bfc7d3] uppercase">
                <th className="py-2.5">USER NAME</th>
                <th className="py-2.5">M365 ROLE</th>
                <th className="py-2.5">DEPARTMENT</th>
                <th className="py-2.5">MFA STATUS</th>
                <th className="py-2.5">ACCOUNT STATUS</th>
                <th className="py-2.5 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4751]/10 text-xs">
              {filteredUsers.map((u, idx) => (
                <tr key={idx} className="hover:bg-[#333538]/20">
                  <td className="py-3">
                    <div className="font-semibold text-[#e2e2e6]">{u.name}</div>
                    <div className="text-[10px] font-mono text-[#bfc7d3]">{u.email}</div>
                  </td>
                  <td className="py-3 font-mono text-[#99cbff] text-[11px]">{u.role}</td>
                  <td className="py-3 text-[#bfc7d3]">{u.department}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      u.mfa === 'Enforced' ? 'bg-[#00daf8]/20 text-[#00daf8]' : 'bg-[#93000a]/30 text-[#ffb4ab]'
                    }`}>
                      {u.mfa}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={`text-[10px] font-mono font-bold ${
                      u.status === 'Active' ? 'text-[#e2e2e6]' : 'text-[#ffb4ab]'
                    }`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {u.mfa !== 'Enforced' ? (
                      <button
                        onClick={() => enforceMFA(u.email)}
                        className="bg-[#99cbff]/20 hover:bg-[#99cbff]/30 text-[#99cbff] px-2.5 py-1 rounded font-mono text-[11px]"
                      >
                        Enforce MFA
                      </button>
                    ) : (
                      <span className="text-[10px] font-mono text-[#bfc7d3]/50">MFA Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
