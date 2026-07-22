import React from 'react';
import { RoleInventoryItem } from './types';
import { BadgeCheck } from 'lucide-react';

interface RoleInventoryProps {
  roles: RoleInventoryItem[];
  onSelectRole?: (role: RoleInventoryItem) => void;
}

export const RoleInventory: React.FC<RoleInventoryProps> = ({ roles, onSelectRole }) => {
  return (
    <div className="bg-card border border-border p-6 rounded-xl h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-headline text-lg font-semibold flex items-center gap-2 text-[#e2e2e2]">
          <BadgeCheck className="w-5 h-5 text-[#479ef5]" />
          Role Inventory
        </h3>
        <span className="font-mono text-xs text-[#8a919d]">4 ACTIVE ROLES</span>
      </div>

      <div className="space-y-4">
        {roles.map((role) => {
          const percentage = Math.min(100, Math.round((role.count / role.maxRecommended) * 100));
          return (
            <div 
              key={role.id}
              onClick={() => onSelectRole?.(role)}
              className="space-y-1.5 cursor-pointer group p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <div className="flex justify-between font-mono text-xs text-[#e2e2e2]">
                <span className="group-hover:text-[#479ef5] transition-colors">{role.roleName}</span>
                <span className="font-semibold">{role.count}</span>
              </div>
              <div className="h-2 bg-[#333535] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: role.barColor,
                    boxShadow: `0 0 8px ${role.barColor}80`
                  }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
