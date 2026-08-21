/**
 * portal-v2-settings.tsx — the Settings page.
 *
 * Built from the prototype's own `isSettings` section
 * ('Customer Portal Shell.dc.html' 4345-4576) and its `renderVals()` block
 * (19923-20020), not from the README, which does not describe this page at all
 * beyond naming its four sections.
 *
 * ── This page is NEW, and so is most of what Round Two says moved into it ───
 * The round-one handoff had no Settings page. `Ownership routing` returns 0
 * hits in the round-one shell and 5 here; `People & roles` 0 and 1; `Change
 * control policy` 0 and 4. So the Round Two entries that read as MOVES —
 * "Change control policy moved into global Settings", "People & roles moved
 * from Ownership into Settings" — are, for this build, the FIRST appearance of
 * both. Nothing was relocated; the destination is being built.
 *
 * ── Four sections, and the two the changelog says are gone ─────────────────
 * `setNav` (19923-19927) lists exactly: Ownership routing, Change control
 * policy, People & roles, Departments. Round Two records "Scans and alerting"
 * and "Tenant and billing" as removed placeholders — both strings return ZERO
 * hits in BOTH shells, so there is nothing here to remove and nothing was.
 *
 * ── Selecting a section does not navigate away ─────────────────────────────
 * The prototype's `sn.go` is `this.setState({ setSection: n.k })` (19932) — it
 * changes a field, it does not change `active`. That is the Round Two sentence
 * "selecting it in Settings no longer navigates away from Settings", and here
 * it is a URL under the same page rather than a state key, so the section is a
 * real deep link (`/portal-v2/settings/change`) exactly as the prototype's own
 * hash parser treats it (20049: `bits[1] === 'settings'` sets `setSection` from
 * `bits[2]`).
 *
 * ── The change-control policy lives in BOTH places, on purpose ─────────────
 * Round Two: "Entry points elsewhere (the header change-control badge, alerts,
 * etc.) still deep-link into the Change Control module's own equivalent view."
 * The shell keeps that branch alive at 19420-19421
 * (`isCcSettings: isChangeControl && ccView === 'settings'`). Only the Change
 * Control module's OWN left nav dropped the item. This page is the Settings
 * copy; the module's deep-link view is not built here.
 */

import { useCallback, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { usePortalV2EscDays, usePortalV2People } from "@/components/portal-v2/portalV2People";
import {
  CC_APPROVAL_OPTS,
  CC_APPROVER_BANDS,
  CC_APPROVER_IDS,
  CC_GATES,
  CC_NOTIF_SEED,
  CC_POLICY_SEED,
  CC_RULES,
  DEPT_ROWS,
  DEPT_UNMAPPED,
  OWN_ROLE_DEFS,
  RACI_PEOPLE,
  SET_NAV,
  SET_ROUTING_RULES,
  SET_SECTION_DEFAULT,
  type CcNotifRule,
  type CcPolicy,
  type SetSectionKey,
} from "@/components/portal-v2/settingsData";
import {
  awayLabel,
  ccMasterNote,
  ccMasterTitle,
  cycleDeputy,
  cycleKind,
  cycleSide,
  deptSrcLabel,
  deputyLabel,
  initialsOf,
  newOwnPerson,
  ownPeopleFoot,
  routingRuleOn,
  toggleApprover,
  toggleAway,
} from "@/components/portal-v2/settingsModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const SECTION_KEYS = new Set<string>(SET_NAV.map((n) => n.k));

function isSectionKey(v: string | undefined): v is SetSectionKey {
  return !!v && SECTION_KEYS.has(v);
}

/* ── Shared bits of the section chrome — prototype 4364-4368 ─────────────── */

function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>{title}</span>
      <span
        style={{
          fontSize: "12px",
          color: "#94a3b8",
          lineHeight: 1.6,
          maxWidth: "76ch",
          textWrap: "pretty",
        }}
      >
        {blurb}
      </span>
    </div>
  );
}

/** The `padding:18px 20px` bordered card the policy section is built from. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 11,
        padding: "18px 20px",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 13,
        background: "#0b1524",
      }}
    >
      {children}
    </div>
  );
}

/** The 9.5px/800/.14em uppercase kicker each policy card opens with. */
function Kicker({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 800,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/**
 * The tick box shared by the gate rows and the rule rows — prototype 19345 /
 * 19360. Same geometry, different accent, and the mark is a real glyph rather
 * than an icon because the prototype prints the character.
 */
function TickBox({ on, accent }: { on: boolean; accent: string }) {
  return (
    <span
      style={{
        flex: "0 0 18px",
        width: 18,
        height: 18,
        marginTop: 1,
        borderRadius: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "11px",
        fontWeight: 800,
        color: "#0b1524",
        border: `1px solid ${on ? accent : "rgba(148,163,184,.3)"}`,
        background: on ? accent : "transparent",
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

/** A gate/rule row: tick box, label, sub. Prototype 4433-4439 and 4482-4488. */
function TickRow({
  label,
  sub,
  on,
  accent,
  dimmed,
  onClick,
  testId,
}: {
  label: string;
  sub: string;
  on: boolean;
  accent: string;
  /** The gate rows fade to .5 when the master switch is off — prototype 19344. */
  dimmed?: boolean;
  onClick: () => void;
  testId: string;
}) {
  const border = accent === "#60a5fa" ? "rgba(96,165,250,.4)" : "rgba(251,191,36,.32)";
  const bg = accent === "#60a5fa" ? "rgba(96,165,250,.06)" : "rgba(251,191,36,.05)";
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={on}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: accent === "#60a5fa" ? "12px 13px" : "11px 12px",
        borderRadius: 10,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        opacity: dimmed ? 0.5 : 1,
        border: `1px solid ${on ? border : "rgba(30,41,59,.9)"}`,
        background: on ? bg : "rgba(2,6,23,.4)",
      }}
    >
      <TickBox on={on} accent={accent} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.35 }}>
          {label}
        </span>
        <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45, textWrap: "pretty" }}>
          {sub}
        </span>
      </div>
    </button>
  );
}

/* ── Ownership routing — prototype 4362-4384 ─────────────────────────────── */

function RoutingSection({
  rules,
  onToggle,
  escDays,
  onEscDays,
}: {
  rules: Record<string, boolean>;
  onToggle: (k: string) => void;
  escDays: number;
  onEscDays: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionHead
        title="Ownership routing"
        blurb="What the four names actually do. Every rule reads the ownership matrix live — none of this is a copy of it, so a name changed there changes who gets chased here."
      />
      {SET_ROUTING_RULES.map((r) => {
        const on = routingRuleOn(rules, r.k);
        return (
          <button
            key={r.k}
            onClick={() => onToggle(r.k)}
            data-testid={`pv2-set-routing-${r.k}`}
            aria-pressed={on}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "12px 14px",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: "inherit",
              width: "100%",
              border: `1px solid ${on ? "rgba(0,120,212,.24)" : "rgba(148,163,184,.16)"}`,
              background: on ? "rgba(0,120,212,.05)" : "transparent",
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: 4,
                fontSize: "10px",
                fontWeight: 800,
                color: on ? "#04121f" : "transparent",
                background: on ? "#34d399" : "transparent",
                border: `1px solid ${on ? "#34d399" : "rgba(148,163,184,.35)"}`,
              }}
            >
              ✓
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, textAlign: "left" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}>
                {r.label}
              </span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>
                {r.live}
              </span>
            </div>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                color: on ? "#34d399" : "#64748b",
              }}
            >
              {on ? "Live" : "Off"}
            </span>
          </button>
        );
      })}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderRadius: 10,
          border: "1px solid rgba(148,163,184,.16)",
          background: "rgba(15,23,42,.4)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "12px", color: "#cbd5e1" }}>Escalate to the accountable name after</span>
        <input
          type="number"
          min={1}
          value={escDays}
          // A cleared or non-numeric field would make every escalation
          // comparison NaN, which reads as "nothing is ever late" — a silent
          // wrong answer on the Ownership matrix rather than a visible error.
          // The last good number is kept instead.
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) onEscDays(n);
          }}
          data-testid="pv2-set-esc-days"
          aria-label="Escalate to the accountable name after this many days"
          style={{
            width: 58,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(148,163,184,.22)",
            background: "#0b1a2e",
            color: "#e2e8f0",
            fontSize: "12px",
            fontFamily: MONO,
          }}
        />
        <span style={{ fontSize: "12px", color: "#cbd5e1" }}>days of no movement</span>
      </div>
    </div>
  );
}

/* ── Change control policy — prototype 4409-4531 ─────────────────────────── */

function ChangePolicySection({
  policy,
  setPolicy,
  notif,
  setNotif,
}: {
  policy: CcPolicy;
  setPolicy: (patch: Partial<CcPolicy>) => void;
  notif: readonly CcNotifRule[];
  setNotif: (next: readonly CcNotifRule[]) => void;
}) {
  const { openForm, formElement } = useFormDrawer();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHead
        title="Change control policy"
        blurb="What must pass through a change request before it runs, how many signatures it needs, and who is allowed to give them. Switching change control off does not switch off the record — actions still land in the register, marked as run without approval."
      />

      {/* Master band — prototype 4416-4423. Its border and wash carry the state,
          and its note interpolates the live signature count. */}
      <div
        data-testid="pv2-set-cc-master"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          padding: "18px 20px",
          borderRadius: 13,
          border: `1px solid ${policy.on ? "rgba(52,211,153,.35)" : "rgba(251,191,36,.4)"}`,
          background: policy.on ? "rgba(52,211,153,.06)" : "rgba(251,191,36,.07)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em" }}>
            {ccMasterTitle(policy)}
          </span>
          <span
            style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "70ch", textWrap: "pretty" }}
          >
            {ccMasterNote(policy)}
          </span>
        </div>
        <button
          onClick={() => setPolicy({ on: !policy.on })}
          data-testid="pv2-set-cc-toggle"
          role="switch"
          aria-checked={policy.on}
          aria-label={ccMasterTitle(policy)}
          style={{
            flex: "0 0 auto",
            position: "relative",
            width: 56,
            height: 30,
            borderRadius: 999,
            border: `1px solid ${policy.on ? "rgba(52,211,153,.5)" : "rgba(148,163,184,.3)"}`,
            background: policy.on ? "rgba(52,211,153,.22)" : "rgba(148,163,184,.12)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: policy.on ? 29 : 3,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: policy.on ? "#34d399" : "#94a3b8",
              transition: "left 160ms",
            }}
          />
        </button>
      </div>

      {/* What is gated — prototype 4425-4442 */}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Kicker colour="#60a5fa">What is gated</Kicker>
          <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
            Anything ticked cannot run until the change request is approved.
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
            gap: 9,
          }}
        >
          {CC_GATES.map((g) => (
            <TickRow
              key={g.k}
              label={g.label}
              sub={g.sub}
              on={!!policy.gated[g.k]}
              accent="#60a5fa"
              dimmed={!policy.on}
              testId={`pv2-set-cc-gate-${g.k}`}
              onClick={() => setPolicy({ gated: { ...policy.gated, [g.k]: !policy.gated[g.k] } })}
            />
          ))}
        </div>
      </Card>

      {/* Notification rules — prototype 4444-4470.
          This table KEEPS its horizontal scroll. Round Two removed the scroll
          wrapper from the Gantt rows and the task board, and the README names
          this table as one of the two it deliberately did NOT change: "Some
          dense tables (the CR register, the notification-rules table) still
          assume a reasonably wide desktop viewport — flag if the target
          breakpoint needs them redesigned as cards instead." The prototype
          still carries `overflow-x:auto` and `min-width:820px` at 4448-4449, so
          both are reproduced, and the flag is raised in the build log rather
          than answered here by inventing a card layout. */}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Kicker colour="#a78bfa">Who gets told, and how far ahead</Kicker>
          <span
            style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "78ch", textWrap: "pretty" }}
          >
            Most tenants find out about a Microsoft change from a user complaining. Lead time is the whole
            point of these rules — thirty days is a change, one day is an incident.
          </span>
        </div>
        <div
          style={{
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 11,
            background: "rgba(2,6,23,.4)",
            overflowX: "auto",
            overflowY: "hidden",
          }}
          data-testid="pv2-set-cc-notif"
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(200px,1.6fr) minmax(120px,1fr) minmax(130px,1fr) minmax(140px,1fr) 54px 66px",
              gap: 12,
              padding: "10px 14px",
              borderBottom: "1px solid rgba(30,41,59,.9)",
              minWidth: 820,
            }}
          >
            {["Event", "Channel", "Who", "Lead time", "State"].map((h) => (
              <span
                key={h}
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".11em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                {h}
              </span>
            ))}
            <span />
          </div>
          {notif.map((n, i) => (
            <div
              key={n.event}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(200px,1.6fr) minmax(120px,1fr) minmax(130px,1fr) minmax(140px,1fr) 54px 66px",
                gap: 12,
                padding: "10px 14px",
                alignItems: "center",
                borderBottom: i === notif.length - 1 ? "none" : "1px solid rgba(30,41,59,.9)",
                minWidth: 820,
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#f1f5f9", lineHeight: 1.45, minWidth: 0 }}>
                {n.event}
              </span>
              <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.45, minWidth: 0 }}>{n.channel}</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45, minWidth: 0 }}>{n.to}</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45, minWidth: 0 }}>{n.lead}</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  color: n.on ? "#34d399" : "#64748b",
                }}
              >
                {n.on ? "On" : "Off"}
              </span>
              <button
                data-testid={`pv2-set-cc-notif-edit-${i}`}
                onClick={() =>
                  openForm({
                    kicker: "Notification rule",
                    title: n.event,
                    intro:
                      "Lead time is the whole point of these rules — thirty days is a change, one day is an incident.",
                    submitLabel: "Save the rule",
                    fields: [
                      { id: "channel", label: "Channel", value: n.channel },
                      { id: "to", label: "Who", value: n.to },
                      { id: "lead", label: "Lead time", value: n.lead, wide: true },
                      {
                        id: "on",
                        label: "State",
                        kind: "select",
                        value: n.on ? "On" : "Off",
                        options: [
                          { value: "On", label: "On" },
                          { value: "Off", label: "Off" },
                        ],
                      },
                    ],
                    doneNote: "Saved. The rule applies to the next event of this kind.",
                    onSubmit: (v) =>
                      setNotif(
                        notif.map((x, k) =>
                          k === i
                            ? { ...x, channel: v.channel, to: v.to, lead: v.lead, on: v.on === "On" }
                            : x,
                        ),
                      ),
                  })
                }
                style={{
                  padding: "5px 9px",
                  borderRadius: 5,
                  border: "1px solid rgba(148,163,184,.22)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* The rules + Who may approve — prototype 4472-4515, side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "18px 20px",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 13,
            background: "#0b1524",
          }}
        >
          <Kicker colour="#fbbf24">The rules</Kicker>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#cbd5e1" }}>Signatures required</span>
            <div style={{ display: "flex", gap: 7 }}>
              {CC_APPROVAL_OPTS.map((o) => {
                const on = policy.approvals === o.n;
                return (
                  <button
                    key={o.n}
                    onClick={() => setPolicy({ approvals: o.n })}
                    data-testid={`pv2-set-cc-approvals-${o.n}`}
                    aria-pressed={on}
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: `1px solid ${on ? "rgba(251,191,36,.5)" : "rgba(30,41,59,.9)"}`,
                      background: on ? "rgba(251,191,36,.1)" : "transparent",
                      color: on ? "#fbbf24" : "#94a3b8",
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          {CC_RULES.map((r) => {
            const on = !!policy[r.k as "separate" | "freeze" | "emergency"];
            return (
              <TickRow
                key={r.k}
                label={r.label}
                sub={r.sub}
                on={on}
                accent="#fbbf24"
                testId={`pv2-set-cc-rule-${r.k}`}
                onClick={() => setPolicy({ [r.k]: !on } as Partial<CcPolicy>)}
              />
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "18px 20px",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: 13,
            background: "#0b1524",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Kicker colour="#a78bfa">Who may approve</Kicker>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
              Names come from the RACI. Anyone accountable for a service can sign for it.
            </span>
          </div>
          {CC_APPROVER_BANDS.map((b) => (
            <div key={b.band} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#cbd5e1" }}>{b.label}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {CC_APPROVER_IDS.map((id) => {
                  const p = RACI_PEOPLE[id];
                  const on = policy.approvers[b.band].includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() =>
                        setPolicy({
                          approvers: {
                            ...policy.approvers,
                            [b.band]: toggleApprover(policy.approvers[b.band], id),
                          },
                        })
                      }
                      data-testid={`pv2-set-cc-approver-${b.band}-${id}`}
                      aria-pressed={on}
                      title={`${p.name} · ${p.role} · ${p.org}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "5px 11px 5px 5px",
                        borderRadius: 999,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: `1px solid ${on ? `${p.tone}80` : "rgba(30,41,59,.9)"}`,
                        background: on ? `${p.tone}14` : "rgba(2,6,23,.4)",
                        color: on ? "#f1f5f9" : "#64748b",
                      }}
                    >
                      <span
                        style={{
                          flex: "0 0 20px",
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "8.5px",
                          fontWeight: 800,
                          color: "#0b1524",
                          background: on ? p.tone : "#475569",
                        }}
                      >
                        {initialsOf(p.name)}
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap" }}>{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What has run from this portal — prototype 4517-4530.
          `ccLog` seeds EMPTY (7211) and the prototype only ever appends to it
          from actions on other pages, none of which is built. So this renders
          its empty state, which is the honest result — inventing log rows would
          be claiming actions ran that did not. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "18px 20px",
          border: "1px solid rgba(30,41,59,.9)",
          borderRadius: 13,
          background: "#0b1524",
        }}
        data-testid="pv2-set-cc-log"
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
          <Kicker colour="#34d399">What has run from this portal</Kicker>
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>
            Every gated action and every ungated one, in the order they happened.
          </span>
        </div>
        <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
          Nothing yet this session. Fix a finding, run a procedure or change a Copilot setting and it appears
          here.
        </span>
      </div>

      {formElement}
    </div>
  );
}

/* ── People & roles — prototype 4532-4565 ────────────────────────────────── */

function PeopleSection() {
  const { people, setPeople, sides } = usePortalV2People();

  const patch = useCallback(
    (i: number, next: Partial<(typeof people)[number]>) => {
      setPeople(people.map((p, k) => (k === i ? { ...p, ...next } : p)));
    },
    [people, setPeople],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionHead
        title="People & roles"
        blurb="Names and roles used everywhere ownership appears. A person removed here keeps their history and shows as a gap wherever they were named."
      />
      {people.map((p, i) => (
        <div
          key={p.id}
          data-testid={`pv2-set-person-${p.id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 11px",
            border: "1px solid rgba(148,163,184,.14)",
            borderRadius: 10,
            background: "rgba(2,6,23,.35)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 28px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              value={p.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              data-testid={`pv2-set-person-name-${p.id}`}
              aria-label={`Name for ${p.name}`}
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,.2)",
                background: "rgba(2,6,23,.55)",
                color: "#e2e8f0",
                fontSize: "12px",
                fontFamily: "inherit",
                minWidth: 0,
              }}
            />
            <input
              value={p.role}
              onChange={(e) => patch(i, { role: e.target.value })}
              data-testid={`pv2-set-person-role-${p.id}`}
              aria-label={`Role for ${p.name}`}
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,.2)",
                background: "rgba(2,6,23,.55)",
                color: "#e2e8f0",
                fontSize: "12px",
                fontFamily: "inherit",
                minWidth: 0,
              }}
            />
            <button
              onClick={() => setPeople(people.filter((_, k) => k !== i))}
              data-testid={`pv2-set-person-remove-${p.id}`}
              aria-label={`Remove ${p.name}`}
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid rgba(248,113,113,.28)",
                background: "transparent",
                color: "#f87171",
                fontSize: "13px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>
          {/* Four cycling chips. Each advances one step per click — the
              prototype has no dropdown here, and the cycle IS the control. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 7 }}>
            <button
              onClick={() => patch(i, { kind: cycleKind(p.kind) })}
              data-testid={`pv2-set-person-kind-${p.id}`}
              style={{
                padding: "8px 6px",
                borderRadius: 7,
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                border: `1px solid ${p.kind === "Person" ? "rgba(148,163,184,.3)" : "rgba(251,191,36,.4)"}`,
                background: "transparent",
                color: p.kind === "Person" ? "#94a3b8" : "#fbbf24",
              }}
            >
              {p.kind}
            </button>
            <button
              onClick={() => patch(i, { side: cycleSide(p.side, sides) })}
              data-testid={`pv2-set-person-side-${p.id}`}
              style={{
                padding: "8px 6px",
                borderRadius: 7,
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                border: `1px solid ${
                  p.side === "MSP"
                    ? "rgba(0,120,212,.4)"
                    : p.side === "External"
                      ? "rgba(167,139,250,.35)"
                      : "rgba(45,212,191,.35)"
                }`,
                background: "transparent",
                color: p.side === "MSP" ? "#93c5fd" : p.side === "External" ? "#a78bfa" : "#2dd4bf",
              }}
            >
              {p.side}
            </button>
            <button
              onClick={() => patch(i, { away: toggleAway(p) })}
              data-testid={`pv2-set-person-away-${p.id}`}
              style={{
                padding: "8px 6px",
                borderRadius: 7,
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                border: `1px solid ${p.away ? "rgba(251,191,36,.4)" : "rgba(52,211,153,.3)"}`,
                background: "transparent",
                color: p.away ? "#fbbf24" : "#34d399",
              }}
            >
              {awayLabel(p)}
            </button>
            <button
              onClick={() => patch(i, { deputy: cycleDeputy(p, people) })}
              data-testid={`pv2-set-person-deputy-${p.id}`}
              style={{
                padding: "8px 6px",
                borderRadius: 7,
                fontSize: "10.5px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                border: `1px solid ${p.deputy ? "rgba(96,165,250,.35)" : "rgba(248,113,113,.3)"}`,
                background: "transparent",
                color: p.deputy ? "#93c5fd" : "#f87171",
              }}
            >
              {deputyLabel(p, people)}
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => setPeople(people.concat([newOwnPerson(`p${people.length + 1}-${people.length}`)]))}
        data-testid="pv2-set-person-add"
        style={{
          alignSelf: "flex-start",
          padding: "9px 14px",
          borderRadius: 7,
          border: "1px solid rgba(0,120,212,.45)",
          background: "rgba(0,120,212,.12)",
          color: "#93c5fd",
          fontSize: "11.5px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Add a person
      </button>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "13px 14px",
          border: "1px solid rgba(45,212,191,.26)",
          borderRadius: 10,
          background: "rgba(45,212,191,.05)",
        }}
      >
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#2dd4bf",
          }}
        >
          What each role means here
        </span>
        {OWN_ROLE_DEFS.map((d) => (
          <div key={d.tag} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                borderRadius: 5,
                fontSize: "9.5px",
                fontWeight: 800,
                color: d.tone,
                background: `${d.tone}1f`,
              }}
            >
              {d.tag}
            </span>
            <span style={{ flex: 1, fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.55, minWidth: 0 }}>
              {d.text}
            </span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: "10.5px", color: "#475569" }} data-testid="pv2-set-people-foot">
        {ownPeopleFoot(people)}
      </span>
    </div>
  );
}

/* ── Departments — prototype 4385-4408 ───────────────────────────────────── */

function DepartmentsSection() {
  const { openForm, formElement } = useFormDrawer();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionHead
        title="Departments"
        blurb="Adoption, workload and licence figures are grouped by department. By default that comes from the Entra department attribute, which is only as reliable as whoever filled it in. Point a department at a security group and the numbers stop being indicative."
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 13px",
          borderRadius: 10,
          border: "1px solid rgba(194,166,61,.3)",
          background: "rgba(194,166,61,.06)",
        }}
      >
        <span style={{ fontSize: "15px", fontWeight: 800, color: "#e8c96a", fontFamily: MONO }}>
          {DEPT_UNMAPPED}
        </span>
        <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.55 }}>
          people have no usable department and sit outside every figure grouped by one.
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          border: "1px solid rgba(30,41,59,.9)",
          borderRadius: 11,
          background: "rgba(15,23,42,.4)",
          overflow: "hidden",
        }}
      >
        {DEPT_ROWS.map((d, i) => {
          const isGroup = d.src === "group";
          return (
            <div
              key={d.name}
              data-testid={`pv2-set-dept-${d.name.toLowerCase().replace(/ /g, "-")}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 14px",
                borderBottom: i === DEPT_ROWS.length - 1 ? "none" : "1px solid rgba(30,41,59,.8)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{d.name}</span>
                <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>
                  {d.n} people · {d.group}
                </span>
              </div>
              <span
                style={{
                  flex: "0 0 auto",
                  padding: "2px 8px",
                  borderRadius: 5,
                  border: `1px solid ${isGroup ? "rgba(52,211,153,.45)" : "rgba(148,163,184,.28)"}`,
                  background: isGroup ? "rgba(52,211,153,.1)" : "transparent",
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: isGroup ? "#34d399" : "#94a3b8",
                  whiteSpace: "nowrap",
                }}
              >
                {deptSrcLabel(d.src)}
              </span>
              <button
                onClick={() =>
                  openForm({
                    kicker: "Departments",
                    title: `Set ${d.name} by group`,
                    intro:
                      "The department attribute is an indicator, not a source of truth. Pointing a department at a security group makes the numbers exact.",
                    submitLabel: "Map it",
                    fields: [
                      { id: "group", label: "Security group", value: isGroup ? d.group : "" },
                      {
                        id: "fallback",
                        label: "People in neither",
                        kind: "select",
                        value: "Keep the attribute as a fallback",
                        options: [
                          { value: "Leave them unmapped", label: "Leave them unmapped" },
                          { value: "Keep the attribute as a fallback", label: "Keep the attribute as a fallback" },
                        ],
                      },
                    ],
                    doneNote: `${d.name} now reads from the group. Adoption recalculates on the next scan.`,
                  })
                }
                data-testid={`pv2-set-dept-map-${d.name.toLowerCase().replace(/ /g, "-")}`}
                style={{
                  flex: "0 0 auto",
                  padding: "6px 11px",
                  borderRadius: 7,
                  border: "1px solid rgba(148,163,184,.24)",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Set by group
              </button>
            </div>
          );
        })}
      </div>
      {formElement}
    </div>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default function PortalV2SettingsPage() {
  const [, params] = useRoute("/portal-v2/settings/:section");
  const section: SetSectionKey = isSectionKey(params?.section) ? params.section : SET_SECTION_DEFAULT;

  // Policy, routing rules and notification rules are all client state until a
  // settings endpoint exists. Held here rather than in the store because,
  // unlike the people list, nothing outside this page reads them yet.
  const [policy, setPolicyState] = useState<CcPolicy>(CC_POLICY_SEED);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [notif, setNotif] = useState<readonly CcNotifRule[]>(CC_NOTIF_SEED);

  // The escalation threshold is the ONE routing value another page reads: the
  // Ownership matrix marks a cell late when its idle days exceed it. It
  // therefore lives in the shell-owned store beside the people list, not in
  // this component — held here it would change the input and nothing else.
  const { escDays, setEscDays } = usePortalV2EscDays();

  const setPolicy = useCallback(
    (p: Partial<CcPolicy>) => setPolicyState((cur) => ({ ...cur, ...p })),
    [],
  );

  const body = useMemo(() => {
    switch (section) {
      case "routing":
        return (
          <RoutingSection
            rules={rules}
            onToggle={(k) => setRules((cur) => ({ ...cur, [k]: !routingRuleOn(cur, k) }))}
            escDays={escDays}
            onEscDays={setEscDays}
          />
        );
      case "change":
        return (
          <ChangePolicySection policy={policy} setPolicy={setPolicy} notif={notif} setNotif={setNotif} />
        );
      case "people":
        return <PeopleSection />;
      case "departments":
        return <DepartmentsSection />;
    }
  }, [section, rules, escDays, policy, setPolicy, notif]);

  return (
    <PortalV2Shell eyebrow="Settings" title="Settings">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 28px 60px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}
              data-testid="pv2-page-title"
            >
              Settings
            </span>
            <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "80ch" }}>
              How the portal behaves for this tenant. Anything set here applies everywhere, and every change is
              logged with your name against it.
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "210px minmax(0,1fr)", gap: 24, alignItems: "start" }}>
            {/* The page's own nav. Keeps its LEFT BAR — Round Two's "↳" change
                names Change Control, Ownership, SOPs and Microsoft Changes, and
                this is none of them. Prototype 19933. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                position: "sticky",
                top: 18,
                paddingRight: 14,
                borderRight: "1px solid rgba(30,41,59,.8)",
              }}
              data-testid="pv2-set-nav"
            >
              {SET_NAV.map((n) => {
                const on = section === n.k;
                return (
                  <Link
                    key={n.k}
                    href={`/portal-v2/settings/${n.k}`}
                    data-testid={`pv2-set-nav-${n.k}`}
                    aria-current={on ? "page" : undefined}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      padding: "8px 11px",
                      borderRadius: 8,
                      border: "none",
                      borderLeft: `2px solid ${on ? "#0078D4" : "transparent"}`,
                      background: on ? "rgba(0,120,212,.1)" : "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      width: "100%",
                      textDecoration: "none",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: on ? 800 : 600,
                        color: on ? "#f8fafc" : "#cbd5e1",
                      }}
                    >
                      {n.label}
                    </span>
                    <span style={{ fontSize: "9.5px", color: "#64748b", lineHeight: 1.4 }}>{n.sub}</span>
                  </Link>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{body}</div>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
