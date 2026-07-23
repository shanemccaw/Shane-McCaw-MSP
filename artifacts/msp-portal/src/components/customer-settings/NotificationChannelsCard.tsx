import React from 'react';
import { BellRing } from 'lucide-react';
import { NotificationSetting } from '../types';

interface NotificationChannelsCardProps {
  notifications: NotificationSetting[];
  onToggleNotification: (id: string, enabled: boolean) => void;
}

export const NotificationChannelsCard: React.FC<NotificationChannelsCardProps> = ({
  notifications,
  onToggleNotification,
}) => {
  const categories: ('ALERTS' | 'REPORTS' | 'SYSTEM')[] = ['ALERTS', 'REPORTS', 'SYSTEM'];

  return (
    <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5 flex flex-col justify-between shadow-sm">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-2 pb-3 border-b border-[#282a2b]">
          <BellRing className="w-4 h-4 text-[#a0c9ff]" />
          <h2 className="font-display font-semibold text-base text-[#f1f3f5]">
            Notification Channels
          </h2>
        </div>

        {/* Categories */}
        <div className="flex flex-col gap-4">
          {categories.map((cat) => {
            const items = notifications.filter((n) => n.category === cat);
            return (
              <div key={cat} className="flex flex-col gap-2">
                <span className="font-mono text-[10px] font-semibold text-[#8a919d] tracking-widest uppercase">
                  {cat}
                </span>

                <div className="flex flex-col divide-y divide-[#282a2b]/60">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2 hover:bg-[#282a2b]/30 px-1 rounded transition-colors"
                    >
                      <span className="text-xs text-[#e2e2e2] font-medium">{item.title}</span>

                      {/* Switch */}
                      <button
                        type="button"
                        onClick={() => onToggleNotification(item.id, !item.enabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          item.enabled ? 'bg-[#3881e6]' : 'bg-[#333535]'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            item.enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
