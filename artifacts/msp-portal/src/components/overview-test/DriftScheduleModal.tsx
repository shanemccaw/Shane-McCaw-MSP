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
      <div className="bg-card border border-border rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
              <BellRing className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground tracking-tight">Weekly Drift Alert Settings</h3>
              <p className="text-xs text-muted-foreground">Configure configuration baseline triggers</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Options */}
        <div className="py-6 space-y-5 text-xs text-muted-foreground">

          <div>
            <label className="block font-bold text-foreground mb-1.5">Scan & Notification Frequency</label>
            <div className="grid grid-cols-3 gap-2">
              {['daily', 'weekly', 'realtime'].map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setFrequency(freq)}
                  className={`py-2 px-3 rounded-xl capitalize font-semibold border transition-all ${
                    frequency === freq
                      ? 'bg-primary/20 border-primary text-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {freq === 'realtime' ? 'Real-Time' : freq}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-foreground mb-2">Delivery Channels</label>
            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 bg-background rounded-xl border border-border cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-foreground">Email Digest to Security Lead</span>
                </div>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-0 accent-primary"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-background rounded-xl border border-border cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-foreground">Microsoft Teams Webhook Channel</span>
                </div>
                <input
                  type="checkbox"
                  checked={teamsWebhook}
                  onChange={(e) => setTeamsWebhook(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-0 accent-primary"
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
                className="rounded border-border text-primary focus:ring-0 accent-primary"
              />
              <span className="text-muted-foreground font-medium">
                Only notify if health score drops below <span className="font-bold text-foreground">80%</span>
              </span>
            </label>
          </div>

        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 text-xs font-semibold text-muted-foreground"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-xs font-bold text-primary-foreground flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <Check className="w-4 h-4" />
            <span>Save Notification Preferences</span>
          </button>
        </div>

      </div>
    </div>
  );
};
