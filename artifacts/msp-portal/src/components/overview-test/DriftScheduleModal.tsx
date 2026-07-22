import React, { useState } from 'react';
import { X, BellRing, Check, ShieldCheck, Mail, MessageSquare } from 'lucide-react';

interface DriftScheduleModalProps {
  onClose: () => void;
  addToast: (msg: string, type?: 'success' | 'info') => void;
}

export const DriftScheduleModal: React.FC<DriftScheduleModalProps> = ({
  onClose,
  addToast,
}) => {
  const [frequency, setFrequency] = useState('weekly');
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [teamsWebhook, setTeamsWebhook] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);

  const handleSave = () => {
    addToast('Weekly Drift Alert schedule updated successfully!', 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in">
      <div className="bg-[#1c2025] border border-white/10 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
              <BellRing className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">Weekly Drift Alert Settings</h3>
              <p className="text-xs text-slate-400">Configure configuration baseline triggers</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Options */}
        <div className="py-6 space-y-5 text-xs text-slate-300">
          
          <div>
            <label className="block font-bold text-white mb-1.5">Scan & Notification Frequency</label>
            <div className="grid grid-cols-3 gap-2">
              {['daily', 'weekly', 'realtime'].map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setFrequency(freq)}
                  className={`py-2 px-3 rounded-xl capitalize font-semibold border transition-all ${
                    frequency === freq
                      ? 'bg-[#479ef5]/20 border-[#479ef5] text-[#479ef5]'
                      : 'bg-[#101419] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {freq === 'realtime' ? 'Real-Time' : freq}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-white mb-2">Delivery Channels</label>
            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 bg-[#101419] rounded-xl border border-white/10 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-[#479ef5]" />
                  <span className="font-semibold text-white">Email Digest to Security Lead</span>
                </div>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  className="rounded border-white/20 text-[#479ef5] focus:ring-0 accent-[#479ef5]"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-[#101419] rounded-xl border border-white/10 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="w-4 h-4 text-purple-300" />
                  <span className="font-semibold text-white">Microsoft Teams Webhook Channel</span>
                </div>
                <input
                  type="checkbox"
                  checked={teamsWebhook}
                  onChange={(e) => setTeamsWebhook(e.target.checked)}
                  className="rounded border-white/20 text-[#479ef5] focus:ring-0 accent-[#479ef5]"
                />
              </label>
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={criticalOnly}
                onChange={(e) => setCriticalOnly(e.target.checked)}
                className="rounded border-white/20 text-[#479ef5] focus:ring-0 accent-[#479ef5]"
              />
              <span className="text-slate-300 font-medium">
                Only notify if health score drops below <span className="font-bold text-white">80%</span>
              </span>
            </label>
          </div>

        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-[#242830] hover:bg-[#2c313c] text-xs font-semibold text-slate-300"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl bg-[#479ef5] hover:bg-[#3b82f6] text-xs font-bold text-slate-950 flex items-center gap-2 shadow-lg shadow-[#479ef5]/20"
          >
            <Check className="w-4 h-4" />
            <span>Save Notification Preferences</span>
          </button>
        </div>

      </div>
    </div>
  );
};
