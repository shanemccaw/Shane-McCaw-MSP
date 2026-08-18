import React from 'react';
import { Lock, ExternalLink, MessageCircle } from 'lucide-react';
import { useSupportChat } from '@/lib/support-chat-context';

/**
 * #1132: locked-state treatment for an Enhanced-tier finding whose check hit a
 * real Microsoft Graph license gap, reusing TrendsRow.tsx's Copilot-readiness
 * locked-card visual pattern (Lock icon, muted explanation, pill CTA) rather
 * than the plain finding row. Two real CTAs, per Shane's confirmed hybrid
 * (#1132 comment 2026-08-18): a self-serve link straight to Microsoft's own
 * pricing page (license-gap-purchase-links.ts — this platform never resells
 * licensing), plus a sales-assisted path that opens ShaneBot with the
 * migration intent pre-sent. ShaneBot instance resolution is server-side and
 * route-keyed (portal's /api/msp/support/chat always resolves shanebot_paid —
 * see support-chat-context.tsx), so this card needs no instance selection.
 */

export interface LicenseGapUpsellCardProps {
  checkLabel: string | null;
  feature: string | null;
  sku: { name: string; url: string } | null;
  categoryLabel: string | null;
}

export const LicenseGapUpsellCard: React.FC<LicenseGapUpsellCardProps> = ({
  checkLabel,
  feature,
  sku,
  categoryLabel,
}) => {
  const { setSupportOpen, sendMessage } = useSupportChat();

  const requirement = sku?.name ?? feature ?? categoryLabel ?? 'an additional Microsoft 365 license';

  const talkToUs = () => {
    setSupportOpen(true);
    void sendMessage(
      `I have a finding that says I'm missing ${requirement}${
        checkLabel ? ` (${checkLabel})` : ''
      }. Can you help me migrate to get this covered?`,
    );
  };

  return (
    <div
      data-testid="license-gap-locked-card"
      className="flex flex-col items-center gap-3 px-6 py-6 text-center"
    >
      <Lock className="w-5 h-5 text-muted-foreground" />
      <p className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
        This finding requires <span className="font-semibold text-foreground">{requirement}</span>,
        which isn&apos;t part of your current Microsoft 365 licensing — it can&apos;t be evaluated
        until it is.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {sku && (
          <a
            data-testid="license-gap-selfserve-link"
            href={sku.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-secondary text-secondary-foreground font-mono text-[11px] font-semibold rounded-lg border border-border hover:bg-secondary/70 active:scale-95 transition-all flex items-center gap-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>View {sku.name} licensing</span>
          </a>
        )}
        <button
          data-testid="license-gap-chat-cta"
          onClick={talkToUs}
          className="px-4 py-2 bg-status-violet/10 text-status-violet font-mono text-[11px] font-semibold rounded-lg border border-status-violet/30 hover:bg-status-violet/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Talk to us about migrating</span>
        </button>
      </div>
    </div>
  );
};
