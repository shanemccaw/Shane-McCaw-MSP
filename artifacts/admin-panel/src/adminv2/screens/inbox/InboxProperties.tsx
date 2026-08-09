/**
 * Inbox's right panel — "Properties" for whichever message is open.
 *
 * A plain mounted component (unlike the ribbon closures elsewhere in this
 * screen), so it reads `recordId` straight off `useShell()` and fetches its
 * own CRM link data with `useAdminFetch()` — no store bridge needed here.
 */

import { useEffect, useState } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { useShell } from "../../shell/ShellContext";
import { ACCENT, LINE, TEXT } from "../../theme";
import { getCrm, getMessage, type InboxCrmData, type InboxMessageDetail } from "./inboxApi";
import { unlinkCrmAction } from "./inboxStore";

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ padding: "7px 12px" }}>
      <div style={{ fontSize: 10.5, color: TEXT.caption, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: accent ?? TEXT.soft, lineHeight: 1.4, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "10px 12px 4px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: TEXT.caption,
        borderTop: `1px solid ${LINE.subtle}`,
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}

export function InboxProperties() {
  const { adminFetch } = useAdminFetch();
  const { state } = useShell();
  const activeDoc = state.docs.find((d) => d.id === state.activeDocId);
  const messageId = activeDoc?.kind === "mail" ? activeDoc.recordId : undefined;

  const [message, setMessage] = useState<InboxMessageDetail | null>(null);
  const [crm, setCrm] = useState<InboxCrmData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!messageId) {
      setMessage(null);
      setCrm(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([getMessage(adminFetch, messageId), getCrm(adminFetch, messageId)]).then(([m, c]) => {
      if (cancelled) return;
      setMessage(m?.message ?? null);
      setCrm(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, state.docs.length]);

  if (!messageId) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: TEXT.meta, lineHeight: 1.5 }}>
        Open a message to see who it&rsquo;s filed under and its CRM links here.
      </div>
    );
  }

  if (loading && !message) {
    return <div style={{ padding: 14, fontSize: 12, color: TEXT.meta }}>Loading&hellip;</div>;
  }

  const from = message?.from?.emailAddress;
  const flagged = message?.flag?.flagStatus === "flagged";
  const linked = !!(crm?.lead || crm?.opportunity || crm?.customer);

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "auto", height: "100%" }}>
      <GroupLabel>Thread</GroupLabel>
      <Fact label="From" value={from ? `${from.name || from.address} <${from.address}>` : "—"} />
      <Fact label="Received" value={message?.receivedDateTime ? new Date(message.receivedDateTime).toLocaleString() : "—"} />
      <Fact label="Flag" value={flagged ? "Flagged" : "Not flagged"} accent={flagged ? ACCENT.amber : undefined} />
      <Fact label="Attachments" value={message?.hasAttachments ? String(message.attachments?.length ?? "yes") : "none"} />

      <GroupLabel>CRM</GroupLabel>
      {!linked ? (
        <Fact label="Filed as" value="Not linked to CRM" />
      ) : (
        <>
          {crm?.lead && <Fact label="Lead" value={`${crm.lead.name} — score ${crm.lead.score} / ${crm.lead.stage}`} accent={ACCENT.info} />}
          {crm?.opportunity && <Fact label="Opportunity" value={`#${crm.opportunity.id} — snapshot ${crm.opportunity.scoreSnapshot}`} accent={ACCENT.greenSoft} />}
          {crm?.customer && <Fact label="Customer" value={crm.customer.name || crm.customer.email} accent={ACCENT.greenSoft} />}
          {crm?.task && <Fact label="Task" value={`${crm.task.title} — ${crm.task.column}`} />}
          <div style={{ padding: "2px 12px 12px" }}>
            <button
              type="button"
              onClick={() => void unlinkCrmAction(messageId).then(() => getCrm(adminFetch, messageId).then(setCrm))}
              style={{
                border: `1px solid ${LINE.control}`,
                background: "transparent",
                color: TEXT.dim,
                borderRadius: 5,
                padding: "4px 10px",
                fontFamily: "inherit",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Unlink
            </button>
          </div>
        </>
      )}
    </div>
  );
}
