import React from 'react';
import { Mail, AlertCircle } from 'lucide-react';
import {
  ResolvedMetric,
  resolvedValue,
  riskCountBand,
  BAND_TEXT_CLASS,
} from '@/components/health-suite/useTopicHealthLive';

/**
 * Email & Mailbox Posture — REAL Exchange collaboration checks, replacing the
 * mock sent/received/backlog figures (per-user message volumes aren't
 * collected by any check). What IS real: mailbox inventory, active email
 * users, and the mailbox-hygiene risk counts (external auto-forwarding,
 * inbox rules, delegation grants, signed-in shared mailboxes).
 */

interface EmailProductivityProps {
  metrics: Record<string, ResolvedMetric>;
}

const HYGIENE_ROWS: { key: string; label: string; risky: boolean }[] = [
  { key: 'collaboration.forwardingMailboxCount', label: 'External auto-forwarding mailboxes', risky: true },
  { key: 'collaboration.sharedMailboxSigninEnabledCount', label: 'Shared mailboxes with sign-in enabled', risky: true },
  { key: 'collaboration.inboxRuleCount', label: 'Inbox rules', risky: false },
  { key: 'collaboration.delegationGrantCount', label: 'Mailbox delegation grants', risky: false },
];

export const EmailProductivity: React.FC<EmailProductivityProps> = ({ metrics }) => {
  const mailboxes = resolvedValue(metrics['collaboration.mailboxCount']);
  const activeUsers = resolvedValue(metrics['collaboration.activeEmailUserCount']);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5 text-status-teal" />
          EMAIL &amp; MAILBOX POSTURE
        </h4>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-border bg-secondary/40">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Mailboxes</p>
          <p className="text-2xl font-bold font-mono mt-1 text-foreground">
            {mailboxes != null ? mailboxes.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {mailboxes != null ? 'Total in your tenant' : 'No data yet'}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-border bg-secondary/40">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Active Email Users</p>
          <p className="text-2xl font-bold font-mono mt-1 text-status-teal">
            {activeUsers != null ? activeUsers.toLocaleString() : '—'}
          </p>
          <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
            {activeUsers != null ? 'Recently active on email' : 'No data yet'}
          </p>
        </div>
      </div>

      <ul className="mt-4 pt-3 border-t border-border space-y-2 flex-grow">
        {HYGIENE_ROWS.map(({ key, label, risky }) => {
          const value = resolvedValue(metrics[key]);
          const band = value != null && risky ? riskCountBand(value) : null;
          return (
            <li key={key} className="flex justify-between items-center text-[11px] font-mono gap-2">
              <span className="text-muted-foreground flex items-center gap-1 min-w-0">
                {risky && <AlertCircle className="w-3 h-3 text-status-amber flex-shrink-0" />}
                <span className="truncate">{label}</span>
              </span>
              <span
                className={`font-bold flex-shrink-0 ${
                  band ? BAND_TEXT_CLASS[band] : value != null ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {value != null ? value.toLocaleString() : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground leading-relaxed">
        Per-user message volumes aren&apos;t collected — these are your real
        mailbox inventory &amp; hygiene checks.
      </div>
    </div>
  );
};
