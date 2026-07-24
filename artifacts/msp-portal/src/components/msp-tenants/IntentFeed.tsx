import React, { useState } from 'react';
import { IntentFeedItem, IntentType } from '@/components/msp-tenants/types';

interface IntentFeedProps {
  feedItems: IntentFeedItem[];
  onAddLogNote: (note: string) => void;
}

export const IntentFeed: React.FC<IntentFeedProps> = ({ feedItems, onAddLogNote }) => {
  const [filter, setFilter] = useState<IntentType | 'ALL'>('ALL');
  const [isLive, setIsLive] = useState(true);
  const [customNote, setCustomNote] = useState('');
  const [showInput, setShowInput] = useState(false);

  const filteredItems = feedItems.filter((item) => filter === 'ALL' || item.type === filter);

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (customNote.trim()) {
      onAddLogNote(customNote.trim());
      setCustomNote('');
      setShowInput(false);
    }
  };

  return (
    <div className="flex-1 glass-dark rounded-xl p-5 border border-white/5 flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-mono text-[#bfc7d3] uppercase tracking-widest font-bold">
              Real-time Intent Feed
            </h3>
            <button
              onClick={() => setIsLive(!isLive)}
              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isLive ? 'bg-[#a5eeff] animate-pulse' : 'bg-gray-500'
                }`}
              ></span>
              <span className="text-[#bfc7d3]/70">{isLive ? 'LIVE' : 'PAUSED'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex text-[9px] font-mono bg-[#1a1c1f] rounded border border-white/10 p-0.5">
              <button
                onClick={() => setFilter('ALL')}
                className={`px-2 py-0.5 rounded ${
                  filter === 'ALL' ? 'bg-[#99cbff]/20 text-[#99cbff]' : 'text-[#bfc7d3]/50'
                }`}
              >
                ALL
              </button>
              <button
                onClick={() => setFilter('AUTO-FIX')}
                className={`px-2 py-0.5 rounded ${
                  filter === 'AUTO-FIX' ? 'bg-[#99cbff]/20 text-[#99cbff]' : 'text-[#bfc7d3]/50'
                }`}
              >
                AUTO-FIX
              </button>
              <button
                onClick={() => setFilter('ALERT')}
                className={`px-2 py-0.5 rounded ${
                  filter === 'ALERT' ? 'bg-[#ffb4ab]/20 text-[#ffb4ab]' : 'text-[#bfc7d3]/50'
                }`}
              >
                ALERTS
              </button>
              <button
                onClick={() => setFilter('SIGNAL')}
                className={`px-2 py-0.5 rounded ${
                  filter === 'SIGNAL' ? 'bg-[#a5eeff]/20 text-[#a5eeff]' : 'text-[#bfc7d3]/50'
                }`}
              >
                SIGNALS
              </button>
            </div>

            <button
              onClick={() => setShowInput(!showInput)}
              className="p-1 rounded bg-white/5 hover:bg-white/10 text-[#bfc7d3] text-xs"
              title="Add admin note to feed"
            >
              <span className="material-symbols-outlined text-sm">add_comment</span>
            </button>

            <span className="text-[10px] font-mono text-[#99cbff]/50 hidden sm:inline">
              LIVE_STREAM_ACTIVE
            </span>
          </div>
        </div>

        {/* Input Form for Admin Note */}
        {showInput && (
          <form onSubmit={handleAddNote} className="mb-3 flex gap-2">
            <input
              type="text"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Enter manual admin log note..."
              className="flex-1 bg-[#1a1c1f] border border-white/10 rounded px-3 py-1.5 text-xs text-[#e2e2e6] focus:outline-none focus:border-[#99cbff]"
            />
            <button
              type="submit"
              className="bg-[#99cbff] text-[#003355] px-3 py-1.5 rounded text-xs font-bold font-mono"
            >
              Post
            </button>
          </form>
        )}

        {/* Items List */}
        <div className="space-y-2.5 max-h-[160px] overflow-y-auto pr-1">
          {filteredItems.map((item) => {
            const isAlert = item.type === 'ALERT';
            const isSignal = item.type === 'SIGNAL';

            return (
              <div
                key={item.id}
                className={`flex gap-3 text-[11px] border-l-2 pl-3 py-1 font-sans transition-all ${
                  isAlert
                    ? 'border-[#ffb4ab] text-[#e2e2e6] bg-[#ffb4ab]/5'
                    : isSignal
                    ? 'border-[#a5eeff] text-[#e2e2e6] bg-[#a5eeff]/5'
                    : 'border-[#99cbff] text-[#e2e2e6] bg-[#99cbff]/5'
                }`}
              >
                <span className="text-[#bfc7d3]/40 font-mono text-[10px] shrink-0">
                  {item.timestamp}
                </span>
                <span
                  className={`font-mono text-[10px] font-bold shrink-0 ${
                    isAlert
                      ? 'text-[#ffb4ab]'
                      : isSignal
                      ? 'text-[#a5eeff]'
                      : 'text-[#99cbff]'
                  }`}
                >
                  [{item.type}]
                </span>
                <span className="text-[#bfc7d3] text-xs leading-tight">
                  {item.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
