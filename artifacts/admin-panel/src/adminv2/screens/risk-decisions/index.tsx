/**
 * Risk-Based Decisions screen (Git #1294).
 *
 * PlatformAdmin-only surface to view/manage a customer's Risk-Based Decisions:
 * list them, create them, edit them, and — the point of #1294 — link each one
 * to an automated check so #1279's accepted-risk alert suppression is reachable
 * from a real workflow instead of only a raw API call.
 *
 * A fresh AdminV2 rebuild, not a port of the msp-portal
 * RiskBasedDecisionConsole.tsx (which leaves the live app with #1297). Lives on
 * the Watch tab — a risk knowingly accepted, or one pending a signature, is
 * exactly "what needs a decision".
 */

import { ShieldAlert, Plus } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem, PeekModel } from "../../registry/types";
import { RiskDecisionsBody } from "./RiskDecisionsBody";
import { STATUS_LABEL, statusTone } from "./RiskDecisionsBody";
import {
  getSnapshot,
  selectCustomer,
  decisionById,
  checkLabel,
  updateDecision,
  totalLinkedActive,
  type RbdStatus,
  type RawRiskLevel,
  type ResidualRiskLevel,
} from "./riskDecisionsStore";

export const ROUTE = "/risk-decisions";
const SCREEN_ID = "risk-decisions";

const STATUS_ORDER: RbdStatus[] = ["active", "pending_signature", "expired", "revoked"];
const RAW_ORDER: RawRiskLevel[] = ["critical", "high", "medium"];
const RESIDUAL_ORDER: ResidualRiskLevel[] = ["high", "medium", "low"];

function openScreenForCustomer(customerId: number): void {
  selectCustomer(customerId);
  getShellApi()?.navigate(ROUTE);
}

registerScreen({
  id: SCREEN_ID,
  title: "Risk-Based Decisions",
  area: "risk-decisions",
  icon: ShieldAlert,
  route: ROUTE,
  render: () => <RiskDecisionsBody />,

  ribbon: [
    // Primary group on the Watch tab.
    {
      tab: "watch",
      order: 40,
      group: {
        label: "Risk decisions",
        large: [
          {
            label: "Risk-based decisions",
            icon: ShieldAlert,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "View and manage the risk acceptances on file for each customer",
          },
        ],
        small: [
          {
            label: "New risk decision",
            icon: Plus,
            intent: "create",
            color: ACCENT.amber,
            onSelect: () => {
              getShellApi()?.navigate(ROUTE);
              window.dispatchEvent(new CustomEvent("rbd:new-decision"));
            },
            title: "Record a new Risk-Based Decision for the selected customer",
          },
        ],
      },
    },
    // Mirror the single most-reached action on Home, per SHELL.md.
    {
      tab: "home",
      order: 70,
      group: {
        label: "Risk decisions",
        large: [
          {
            label: "Risk decisions",
            icon: ShieldAlert,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate(ROUTE),
          },
        ],
      },
    },
  ],

  peeks: {
    // One Risk-Based Decision. Simple fields edit straight through; the linked
    // check (a 157-entry catalog) is changed via the body's <select> panel,
    // opened by the "Change linked check…" action below.
    riskDecision: (id): PeekModel | null => {
      const d = decisionById(Number(id));
      if (!d) return null;
      const customerId = getSnapshot().detail?.customer.customerId;
      const linked = checkLabel(d.checkKey);
      const suppressing = !!d.checkKey && d.status === "active";
      return {
        kind: "riskDecision",
        eyebrow: "RISK DECISION",
        title: d.title,
        sub: `${d.tenantName} · ${d.rbdId}`,
        icon: ShieldAlert,
        tone: statusTone(d.status),
        tag: STATUS_LABEL[d.status] ?? d.status,
        tagTone: statusTone(d.status),
        facts: [
          { label: "Raw risk", value: d.rawRiskLevel, prose: true },
          { label: "Residual", value: d.residualRiskLevel, prose: true },
          { label: "Liability", value: `$${d.liabilityValueUsd.toLocaleString()}` },
          { label: "Expires", value: d.expirationDate, prose: true },
          { label: "Linked check", value: linked ?? "Not linked", prose: true, color: suppressing ? ACCENT.green : undefined },
          { label: "Suppressing alerts", value: suppressing ? "Yes" : "No", prose: true, color: suppressing ? ACCENT.green : undefined },
        ],
        edits: customerId
          ? [
              { key: "title", label: "Title", value: d.title, onChange: (v) => { if (v.trim()) void updateDecision(customerId, d.id, { title: v.trim() }); } },
              { key: "framework", label: "Framework", value: d.framework, onChange: (v) => void updateDecision(customerId, d.id, { framework: v.trim() }) },
              { key: "status", label: "Status", value: STATUS_LABEL[d.status] ?? d.status, options: STATUS_ORDER.map((s) => STATUS_LABEL[s]),
                onChange: (v) => {
                  const next = STATUS_ORDER.find((s) => STATUS_LABEL[s] === v);
                  if (next) void updateDecision(customerId, d.id, { status: next });
                } },
              { key: "rawRiskLevel", label: "Raw risk", value: d.rawRiskLevel, options: RAW_ORDER,
                onChange: (v) => void updateDecision(customerId, d.id, { rawRiskLevel: v as RawRiskLevel }) },
              { key: "residualRiskLevel", label: "Residual risk", value: d.residualRiskLevel, options: RESIDUAL_ORDER,
                onChange: (v) => void updateDecision(customerId, d.id, { residualRiskLevel: v as ResidualRiskLevel }) },
              { key: "expirationDate", label: "Expiration date", value: d.expirationDate, mono: true,
                onChange: (v) => { if (v.trim()) void updateDecision(customerId, d.id, { expirationDate: v.trim() }); } },
              { key: "liabilityValueUsd", label: "Liability (USD)", value: String(d.liabilityValueUsd), mono: true,
                onChange: (v) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n >= 0) void updateDecision(customerId, d.id, { liabilityValueUsd: n }); } },
              { key: "rationale", label: "Rationale", value: d.rationale ?? "", area: true,
                onChange: (v) => void updateDecision(customerId, d.id, { rationale: v.trim() || null }) },
            ]
          : undefined,
        body: d.hazardDescription ? { title: "Hazard", content: d.hazardDescription } : undefined,
        actions: customerId
          ? [
              {
                label: "Change linked check…",
                tone: "primary",
                onSelect: () => window.dispatchEvent(new CustomEvent<number>("rbd:relink", { detail: d.id })),
              },
            ]
          : undefined,
      };
    },
  },

  commands: () => {
    const snap = getSnapshot();
    const items: CommandItem[] = [];
    for (const c of snap.customers) {
      if (c.decisionCount === 0) continue;
      items.push({
        id: `rec:rbd-cust-${c.customerId}`,
        type: "record",
        kind: "customer",
        name: `${c.name} — risk decisions`,
        sub: `${c.decisionCount} on file · ${c.activeCount} active · ${c.linkedCount} linked`,
        area: "risk-decisions",
        run: () => openScreenForCustomer(c.customerId),
      });
    }
    if (snap.customersLoaded) {
      items.push({
        id: "ans:rbd-linked-active",
        type: "answer",
        kind: "answer",
        name: "Active risk decisions suppressing an alert",
        sub: "Linked to an automated check and currently active",
        area: "risk-decisions",
        live: String(totalLinkedActive()),
        run: () => getShellApi()?.navigate(ROUTE),
      });
    }
    return items;
  },
});
