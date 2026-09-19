/**
 * ExistingAccountDecisionPanel — the operator's decision point when a config-pack
 * run finds an existing break-glass account (#4532).
 *
 * quickstart-v1 skips creating a break-glass account that already exists (#4514), so
 * the password the run generated was never applied to it. The run pauses rather than
 * guess, and this panel is where it waits. The operator asks the customer which they
 * want, records the customer's actual answer, and exactly that path runs:
 *
 *   - reset and redeliver — the same reset the "Force a reset" action performs
 *     (`performBreakGlassAdminOverride`, #4015); the replacement is then delivered
 *     through the normal verify-and-claim flow;
 *   - resume without delivering — the existing credential is treated as already held.
 *
 * Real data only: `GET/POST /api/msp/customers/:id/break-glass-decisions`. It renders
 * nothing when there are no decisions. It has its own hooks so it never disturbs
 * BreakGlassPage's hook order.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, text } from "@/console/tokens";
import {
  BreakGlassApiError,
  useDecideExistingAccount,
  useExistingAccountDecisions,
  type ExistingAccountChoice,
  type ExistingAccountDecision,
} from "@/api/break-glass-api";

import { MAX_INVITES, isDecisionReady, parseEmails } from "./existing-account-decision-form";

const CARD_BG = "rgba(15,23,42,.6)";

const CHOICES: readonly { id: ExistingAccountChoice; title: string; body: string }[] = [
  {
    id: "reset_and_redeliver",
    title: "Reset and redeliver a new password",
    body: "Sets a new password on the existing account and hands it over through the normal verification flow. Whatever credential the customer has stored for this account stops working.",
  },
  {
    id: "resume_without_delivery",
    title: "Resume without delivering",
    body: "Treats the customer's existing credential as already held. The pack carries on and nobody receives a credential from this run. Only correct if the customer confirms they still have it.",
  },
];

const CHOICE_LABEL: Record<ExistingAccountChoice, string> = {
  reset_and_redeliver: "Reset and redeliver",
  resume_without_delivery: "Resumed without delivering",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ExistingAccountDecisionPanel({ customerId }: { customerId: number }) {
  const query = useExistingAccountDecisions(customerId);

  if (query.isError) {
    return (
      <div data-testid="existing-account-decisions-error" style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
        <Icon name="triangle-alert" size={15} color={signal.warning.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
        <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>
          Decisions for existing break-glass accounts could not be loaded. A run may be waiting on one — try again shortly.
        </span>
      </div>
    );
  }

  const decisions = query.data?.decisions ?? [];
  const pending = decisions.filter((d) => d.status === "pending");
  const decided = decisions.filter((d) => d.status !== "pending");
  if (pending.length === 0 && decided.length === 0) return null;

  return (
    <div data-testid="existing-account-decisions" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {pending.map((d) => (
        <PendingDecisionCard key={d.id} decision={d} customerId={customerId} />
      ))}
      {decided.length > 0 && (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: CARD_BG, padding: 15, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>RECORDED ANSWERS</span>
          {decided.map((d) => (
            <DecidedRow key={d.id} decision={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingDecisionCard({ decision, customerId }: { decision: ExistingAccountDecision; customerId: number }) {
  const decide = useDecideExistingAccount(customerId);
  const [choice, setChoice] = useState<ExistingAccountChoice | null>(null);
  const [customerAnswer, setCustomerAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [emailsRaw, setEmailsRaw] = useState("");

  const account = decision.existingAccountUpn ?? decision.existingAccountId ?? "an existing account";
  const { emails, valid: emailsValid } = parseEmails(emailsRaw);
  const ready = isDecisionReady({ choice, customerAnswer, reason, emailsValid });

  const submit = () => {
    if (!choice || !ready) return;
    decide.mutate(
      {
        decisionId: decision.id,
        decision: choice,
        customerAnswer: customerAnswer.trim(),
        reason: reason.trim(),
        emails: choice === "reset_and_redeliver" && emails.length > 0 ? emails : undefined,
      },
      {
        onSuccess: (res) => {
          if (res.decision === "reset_and_redeliver") {
            toast.success(`Password reset. Replacement credential #${res.newPendingSecretId} is waiting to be claimed; ${res.sent} of ${res.reissued} invite${res.reissued === 1 ? "" : "s"} sent.`);
          } else {
            toast.success(`Recorded. Run #${res.runId} is resuming without delivering a credential.`);
          }
        },
        onError: (err) => {
          toast.error(err instanceof BreakGlassApiError ? err.message : "Could not record that answer.");
        },
      },
    );
  };

  return (
    <div data-testid="existing-account-decision-pending" style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 12, background: signal.warning.tint, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: signal.warning.tint, border: `1px solid ${signal.warning.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="shield-alert" size={15} color={signal.warning.strong} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.warning.text }}>DECISION NEEDED</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: text.strong, textWrap: "pretty", overflowWrap: "anywhere" }}>
            {account} is already a break-glass account
          </span>
          <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
            Run #{decision.runId} is paused. The pack found this account and did not create it, so the password it generated was never set on it and cannot be delivered.
            Ask the customer which they want, then record their answer here. The run does exactly what you record.
          </span>
        </div>
      </div>

      <div role="radiogroup" aria-label="What the customer wants" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {CHOICES.map((c) => {
          const picked = choice === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-testid={`existing-account-choice-${c.id}`}
              onClick={() => setChoice(c.id)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 9, textAlign: "left", cursor: "pointer", minWidth: 0,
                border: `1px solid ${picked ? "rgba(96,165,250,.4)" : border.sidebar}`,
                background: picked ? "rgba(37,99,235,.16)" : "rgba(2,6,23,.4)",
              }}
            >
              <Icon name={picked ? "circle-check-big" : "circle-dashed"} size={15} color={picked ? "#60a5fa" : text.faint} style={{ flex: "0 0 15px", marginTop: 1 }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: text.strong }}>{c.title}</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{c.body}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor={`bg-answer-${decision.id}`} style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>The customer's answer</label>
        <textarea
          id={`bg-answer-${decision.id}`}
          data-testid="existing-account-customer-answer"
          value={customerAnswer}
          onChange={(e) => setCustomerAnswer(e.target.value)}
          rows={3}
          placeholder="Who at the customer answered, how they answered, and what they said"
          style={{ padding: "9px 11px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }}
        />
        <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Required. Goes on the permanent record next to your name.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor={`bg-reason-${decision.id}`} style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Reason</label>
        <input
          id={`bg-reason-${decision.id}`}
          data-testid="existing-account-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this path"
          style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
        />
      </div>

      {choice === "reset_and_redeliver" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor={`bg-emails-${decision.id}`} style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>Who should get the new invite</label>
            <input
              id={`bg-emails-${decision.id}`}
              data-testid="existing-account-emails"
              value={emailsRaw}
              onChange={(e) => setEmailsRaw(e.target.value)}
              placeholder="Optional. Up to five addresses, separated by commas"
              style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${emailsValid ? border.sidebar : signal.critical.border}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
            />
            <span style={{ fontSize: 11, color: emailsValid ? text.label : signal.critical.text, textWrap: "pretty" }}>
              {emailsValid
                ? "Leave empty to send invites yourself afterwards from the waiting credential."
                : `Enter up to ${MAX_INVITES} valid email addresses.`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint }}>
            <Icon name="triangle-alert" size={15} color={signal.critical.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
              This changes the password on {account} in the customer's tenant, right now. Whatever the customer has stored for it stops working.
              If the tenant is not set up to accept writes, or consent has not been given, this is refused outright rather than half-done.
            </span>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        <button
          type="button"
          data-testid="existing-account-submit"
          onClick={submit}
          disabled={!ready || decide.isPending}
          title={ready ? "" : "Pick an option and fill in the customer's answer and your reason"}
          style={{
            flex: 1, height: 38, borderRadius: 8,
            border: `1px solid ${ready ? (choice === "reset_and_redeliver" ? "rgba(248,113,113,.4)" : "rgba(96,165,250,.4)") : border.sidebar}`,
            background: ready ? (choice === "reset_and_redeliver" ? "rgba(248,113,113,.18)" : "rgba(37,99,235,.28)") : "transparent",
            color: ready ? (choice === "reset_and_redeliver" ? "#fca5a5" : "#bfdbfe") : text.label,
            fontSize: 13, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed", opacity: ready ? 1 : 0.6,
          }}
        >
          {decide.isPending
            ? "Recording…"
            : choice === "reset_and_redeliver"
              ? "Record answer and reset the password"
              : choice === "resume_without_delivery"
                ? "Record answer and resume the run"
                : "Record the customer's answer"}
        </button>
      </div>
    </div>
  );
}

function DecidedRow({ decision }: { decision: ExistingAccountDecision }) {
  const choice = decision.status as ExistingAccountChoice;
  return (
    <div data-testid="existing-account-decision-recorded" style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: `1px solid ${border.faint}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name={choice === "reset_and_redeliver" ? "rotate-ccw" : "fast-forward"} size={13} color={text.muted} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>{CHOICE_LABEL[choice] ?? decision.status}</span>
        <span style={{ fontSize: 11.5, color: text.muted, overflowWrap: "anywhere" }}>{decision.existingAccountUpn ?? decision.existingAccountId ?? ""}</span>
        <span style={{ fontSize: 11.5, color: text.label }}>
          run #{decision.runId}{decision.decidedByName ? ` · ${decision.decidedByName}` : ""}{decision.decidedAt ? ` · ${formatDateTime(decision.decidedAt)}` : ""}
        </span>
      </div>
      {decision.customerAnswer && (
        <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>Customer's answer: {decision.customerAnswer}</span>
      )}
      {decision.reason && (
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>Reason: {decision.reason}</span>
      )}
    </div>
  );
}
