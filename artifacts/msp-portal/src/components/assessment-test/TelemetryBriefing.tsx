import React, { useState } from 'react';
import { TelemetryItem } from '../types';
import {
  ShieldAlert,
  Users,
  CreditCard,
  Bot,
  Brain,
  Pause,
  Play,
  Key,
  UserCheck,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
} from 'lucide-react';

interface TelemetryBriefingProps {
  items: TelemetryItem[];
  onSelectItem: (item: TelemetryItem) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
}

export const TelemetryBriefing: React.FC<TelemetryBriefingProps> = ({
  items,
  onSelectItem,
  selectedCategory,
  setSelectedCategory,
}) => {
  const [isPaused, setIsPaused] = useState(false);

  // Filter items by category if selected
  const filteredItems = selectedCategory === 'all'
    ? items
    : items.filter((item) => item.type === selectedCategory);

  // Duplicate list to create a seamless infinite loop
  const displayItems = [...filteredItems, ...filteredItems];

  const getIconComponent = (iconName: string, color: string) => {
    const colorClasses = {
      green: 'text-[#34d399]',
      amber: 'text-[#f59e0b]',
      blue: 'text-[#479ef5]',
      red: 'text-[#ef4444]',
    }[color] || 'text-[#479ef5]';

    switch (iconName) {
      case 'security':
        return <ShieldAlert className={`w-5 h-5 ${colorClasses}`} />;
      case 'hub':
        return <Users className={`w-5 h-5 ${colorClasses}`} />;
      case 'payments':
        return <CreditCard className={`w-5 h-5 ${colorClasses}`} />;
      case 'auto_awesome':
        return <Bot className={`w-5 h-5 ${colorClasses}`} />;
      case 'key_off':
        return <Key className={`w-5 h-5 ${colorClasses}`} />;
      case 'manage_accounts':
        return <UserCheck className={`w-5 h-5 ${colorClasses}`} />;
      default:
        return <Sparkles className={`w-5 h-5 ${colorClasses}`} />;
    }
  };

  const renderArchitectTheme = (item: TelemetryItem, idx: number) => {
    const status = item.architectStatus || (['success', 'warning', 'error', 'info'][idx % 4] as any);

    switch (status) {
      case 'success':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          badgeStyle: 'bg-[#101419] border-[#34d399] text-[#34d399]',
          boxStyle: 'border-[#34d399]/35',
          textStyle: 'text-[#34d399]',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          badgeStyle: 'bg-[#101419] border-[#f59e0b] text-[#f59e0b]',
          boxStyle: 'border-[#f59e0b]/35',
          textStyle: 'text-[#f59e0b]',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          badgeStyle: 'bg-[#101419] border-[#ef4444] text-[#ef4444]',
          boxStyle: 'border-[#ef4444]/35',
          textStyle: 'text-[#ef4444]',
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-3.5 h-3.5" />,
          badgeStyle: 'bg-[#101419] border-[#38bdf8] text-[#38bdf8]',
          boxStyle: 'border-[#38bdf8]/35',
          textStyle: 'text-[#38bdf8]',
        };
    }
  };

  return (
    <div className="bg-[#242424] rounded-xl card-border p-4 md:p-6 flex flex-col relative overflow-hidden h-[580px] shadow-lg">
      
      {/* Background ambient grid mesh */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(#479ef5_1px,transparent_1px)] [background-size:16px_16px]" />

      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 relative z-10">
        <div>
          <h2 className="text-lg font-semibold text-[#e0e2ea] flex items-center gap-2">
            Telemetry Briefing
            <span className="text-xs font-normal text-[#8a919d]">({filteredItems.length} active findings)</span>
          </h2>
          <p className="text-xs text-[#8a919d]">Real-time tenant signal stream & AI Architect commentary</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Pause/Play scroll toggle button */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="flex items-center gap-1 text-[11px] font-medium bg-[#101419]/80 border border-white/10 px-2.5 py-1 rounded-full text-[#c0c7d3] hover:text-white transition-colors cursor-pointer"
            title={isPaused ? "Resume auto-scroll" : "Pause auto-scroll"}
          >
            {isPaused ? <Play className="w-3 h-3 text-[#34d399]" /> : <Pause className="w-3 h-3 text-[#479ef5]" />}
            <span>{isPaused ? 'Paused' : 'Auto-Scroll'}</span>
          </button>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 relative z-10 no-scrollbar">
        {[
          { id: 'all', label: 'All Signals' },
          { id: 'security', label: 'Security' },
          { id: 'groups', label: 'Groups' },
          { id: 'licenses', label: 'Licenses' },
          { id: 'copilot', label: 'Copilot' },
          { id: 'identity', label: 'Identity' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
              selectedCategory === cat.id
                ? 'bg-[#479ef5]/20 text-[#479ef5] border border-[#479ef5]/40 font-semibold'
                : 'bg-[#101419]/50 text-[#8a919d] border border-white/5 hover:text-[#e0e2ea] hover:bg-[#101419]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Vertical Scrolling Container */}
      <div className="flex-grow overflow-hidden relative z-10 mask-image-vertical">
        <div
          className={`flex flex-col gap-4 absolute w-full top-0 ${
            isPaused ? '' : 'animate-scroll-vertical'
          }`}
          style={{
            animationPlayState: isPaused ? 'paused' : 'running',
          }}
        >
          {displayItems.map((item, idx) => {
            const archTheme = renderArchitectTheme(item, idx);
            return (
              <div
                key={`${item.id}-${idx}`}
                onClick={() => onSelectItem(item)}
                className="bg-[#1a1a1a] hover:bg-[#1f2329] rounded-xl p-4 border border-white/10 flex flex-col md:flex-row gap-4 transition-all duration-200 hover:border-[#479ef5]/40 cursor-pointer shadow-md group"
              >
                {/* Finding Info */}
                <div className="flex-grow">
                  <div className="flex items-center gap-2 mb-1.5">
                    {getIconComponent(item.icon, item.iconColor)}
                    <h3 className="text-sm font-semibold text-[#e0e2ea] group-hover:text-[#479ef5] transition-colors">
                      {item.title}
                    </h3>
                    {item.affectedCount && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-[#c0c7d3] border border-white/10 ml-auto md:ml-0">
                        {item.affectedCount} items
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#c0c7d3] leading-relaxed">
                    {item.description}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-[#479ef5] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Click to view remediation script</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </div>

                {/* Architect Commentary Badge Box */}
                <div className={`bg-[#242424] border ${archTheme.boxStyle} rounded-lg p-3 md:w-[40%] relative flex-shrink-0 flex flex-col justify-center`}>
                  <div className={`absolute -top-3 -left-3 w-7 h-7 rounded-full flex items-center justify-center border z-10 shadow-lg ${archTheme.badgeStyle}`}>
                    {archTheme.icon}
                  </div>
                  <div className={`text-[11px] font-bold mb-1 pl-4 uppercase tracking-wider flex items-center gap-1 ${archTheme.textStyle}`}>
                    Architect Says
                  </div>
                  <p className="text-xs text-[#c0c7d3] italic leading-snug">
                    "{item.architectSays}"
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
