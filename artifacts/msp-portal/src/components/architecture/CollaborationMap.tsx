import React from 'react';
import { Users, Folder, Unlink, Cloud } from 'lucide-react';
import { CollabItem } from '../types';

interface CollaborationMapProps {
  items: CollabItem[];
  onItemClick?: (item: CollabItem) => void;
}

export const CollaborationMap: React.FC<CollaborationMapProps> = ({
  items,
  onItemClick,
}) => {
  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'users':
        return <Users className="h-4 w-4 text-[#8a919d]" />;
      case 'folder':
        return <Folder className="h-4 w-4 text-[#f59e0b]" />;
      case 'unlink':
        return <Unlink className="h-4 w-4 text-[#f59e0b]" />;
      case 'cloud':
        return <Cloud className="h-4 w-4 text-[#8a919d]" />;
      default:
        return <Users className="h-4 w-4 text-[#8a919d]" />;
    }
  };

  return (
    <div className="mb-6">
      <h2 className="font-display text-base font-semibold text-[#e2e2e2] mb-3">
        Collaboration Structure Map
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => onItemClick?.(item)}
            className="relative flex flex-col justify-between overflow-hidden rounded-lg border border-[#333535] bg-[#1e2020] p-4 transition-all hover:border-[#8a919d]/40 hover:bg-[#282a2b]/60 cursor-pointer group"
          >
            {/* Subtle background graphic / watermark icon */}
            <div className="absolute -bottom-3 -right-3 opacity-[0.07] transition-opacity group-hover:opacity-[0.12]">
              {React.cloneElement(renderIcon(item.icon), { className: 'h-24 w-24 text-white' })}
            </div>

            <div className="relative z-10 flex items-center justify-between">
              {renderIcon(item.icon)}
              {item.statusText && (
                <span className="inline-flex rounded bg-[#f59e0b]/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#f59e0b] border border-[#f59e0b]/30">
                  {item.statusText}
                </span>
              )}
            </div>

            <div className="relative z-10 mt-6">
              <div className="font-display text-lg font-bold text-[#e2e2e2] group-hover:text-[#a0c9ff] transition-colors">
                {item.title}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
