/**
 * OwnershipMatrix.tsx — the Ownership module.
 *
 * Built from 'Ownership.dc.html' (markup 27-553, logic 556-1266).
 *
 * ── The prop contract is the Round Two change ──────────────────────────────
 * "The people list ... is now owned by the shell (`state.ownPeople`) and passed
 * into `Ownership.dc.html` as a `people` prop plus an `onPeopleChange`
 * callback; Ownership falls back to its own local state when used standalone
 * (so the file still opens and works on its own)."
 *
 * That is reproduced literally: `people` and `onPeopleChange` are OPTIONAL, and
 * when they are absent the component holds its own list seeded from the same
 * fixture. The prototype's own accessors say the same thing in two lines
 * (Ownership.dc.html 720-721):
 *
 *     getPeople() { return this.props.people || this.state.people; }
 *     setPeople(list) { if (this.props.onPeopleChange) this.props.onPeopleChange(list); else this.setState({ people: list }); }
 *
 * ── The assign flow uses the design's OWN slide-over (Part 10) ─────────────
 * An earlier pass routed the assign action through the shared FormDrawer,
 * because a generic form matched the house rule "forms live in the right
 * drawer". Part 10 reverses that deliberately: the design's assign slide-over
 * carries a whole surface a generic form cannot — the acceptance chip and
 * "Mark accepted" / "Nudge", the provenance line, the away-cover line, the
 * escalation clock, the delegation note, the Informed-delivery line, "Accept
 * it unowned", "Who held it before", the people list with a Current tick, and
 * "Leave unassigned — record it as a gap". Those are named, final copy that has
 * to render, so the module now reproduces the prototype's own slide-over
 * (Ownership.dc.html 260-324) rather than a form. The other five slide-overs —
 * add-a-row, routing, assign-to-more, handover and row detail — are built the
 * same way, from the same markup.
 *
 * ── escDays is Settings-owned, with a local shadow for the routing panel ───
 * `escDays` still arrives as a prop (Settings → Ownership routing sets it). The
 * routing panel's − / + stepper adjusts a local shadow seeded from that prop,
 * exactly as the prototype keeps `escDays` in its own state (556). No new prop
 * is added and Settings is not touched, keeping the people contract intact.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";

import {
  CURRENT_USER,
  MATRIX_REVIEWED_AT,
  MATRIX_REVIEW_DUE_DAYS,
  MATRIX_REVIEW_WARN_DAYS,
  OBJECT_TYPES,
  ROLE_KEYS,
  ROUTING_RULES,
  TYPE_SINGULAR,
  type ObjectTypeKey,
  type OwnObject,
  type RoleKey,
} from "@/components/portal-v2/ownershipData";
import {
  acceptanceOf,
  addToRows,
  allObjectsWith,
  assignAcceptLabel,
  cellMark,
  cellTitle,
  counterOn,
  counters,
  covMeta,
  coverageRows,
  coverLine,
  delNote,
  deliveryLine,
  deliverySent,
  escLateCount,
  escLine,
  escalationLate,
  escalationOf,
  gapMeta,
  gapRows,
  gapsOf,
  groupedByType,
  handoverBlocked,
  handoverSubmitLabel,
  loadMeta,
  loadRows,
  loadWarnRows,
  matrixMeta,
  nextPanel,
  noRowsLine,
  ownerOf,
  personCounts,
  personDelText,
  priorHolders,
  provLine,
  provenanceOf,
  reviewLine,
  riskButtonLabel,
  routingLabel,
  routingRuleLive,
  rowDetailDrives,
  rowDrivesLabel,
  rowRoleDuties,
  rowSub,
  shownObjects,
  sodMeta,
  sodRows,
  type CustomRow,
  type Delegation,
  type AcceptanceOverrides,
  type OwnerOverrides,
  type ProvenanceOverrides,
} from "@/components/portal-v2/ownershipModel";
import { OWN_PEOPLE_SEED, type OwnPerson } from "@/components/portal-v2/settingsData";
import { initialsOf } from "@/components/portal-v2/settingsModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** Where a roster problem is edited — the destination Round Two names. */
const PEOPLE_SETTINGS_HREF = "/portal-v2/settings/people";

/** The matrix row grid — header and every row must agree. Prototype 204. */
const ROW_GRID = "148px repeat(4,minmax(0,1fr))";

/* ── The three cell marks — prototype 188-198 and 235-242 ────────────────── */

function MarkPending() {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.9" stroke="currentColor" strokeWidth={1.3} />
      <path d="M4.2 4.2l3.6 3.6M7.8 4.2L4.2 7.8" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

function MarkLate() {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 1.4h6M3 10.6h6" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M3.9 1.4c0 2.2 4.2 2.4 4.2 4.6s-4.2 2.4-4.2 4.6" stroke="currentColor" strokeWidth={1.3} />
      <path d="M8.1 1.4c0 2.2-4.2 2.4-4.2 4.6s4.2 2.4 4.2 4.6" stroke="currentColor" strokeWidth={1.3} />
    </svg>
  );
}

function MarkAway() {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.1l3.9 1.5v3.1c0 2.3-1.6 3.9-3.9 4.6-2.3-.7-3.9-2.3-3.9-4.6V2.6z" stroke="currentColor" strokeWidth={1.2} />
      <path d="M6 4.1l.7 1.4 1.5.2-1.1 1.1.3 1.5L6 7.6l-1.4.7.3-1.5-1.1-1.1 1.5-.2z" fill="currentColor" />
    </svg>
  );
}

const MARK_TONE = { late: "#f87171", pending: "#fbbf24", away: "#94a3b8" } as const;

/** One of the four coloured panels a counter opens — prototype 116-176. */
function DetailPanel({
  tone,
  meta,
  children,
  testId,
}: {
  tone: string;
  meta: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "13px 14px",
        border: `1px solid ${tone}47`,
        borderRadius: 12,
        background: `${tone}09`,
      }}
    >
      <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>{meta}</span>
      {children}
    </div>
  );
}

/** The left-bar row every detail panel uses — prototype 120. */
function DetailRow({
  tone,
  columns,
  children,
}: {
  tone: string;
  columns: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: columns,
        gap: 12,
        alignItems: "center",
        padding: "10px 13px",
        borderLeft: `2px solid ${tone}66`,
        borderRadius: "0 8px 8px 0",
        background: `${tone}0d`,
      }}
    >
      {children}
    </div>
  );
}

function DetailAction({
  tone,
  label,
  onClick,
  href,
  testId,
}: {
  tone: string;
  label: string;
  onClick?: () => void;
  href?: string;
  testId: string;
}) {
  const style: React.CSSProperties = {
    padding: "7px 12px",
    borderRadius: 6,
    border: `1px solid ${tone}73`,
    background: `${tone}1f`,
    color: tone,
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    textAlign: "center",
    textDecoration: "none",
  };
  if (href) {
    return (
      <Link href={href} data-testid={testId} style={style}>
        {label}
      </Link>
    );
  }
  return (
    <button onClick={onClick} data-testid={testId} style={style}>
      {label}
    </button>
  );
}

function DetailBody({ name, note }: { name: string; note: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>{name}</span>
      <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{note}</span>
    </div>
  );
}

function TypeChip({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: "9.5px",
        fontWeight: 700,
        whiteSpace: "nowrap",
        color: tone,
        background: `${tone}14`,
      }}
    >
      {label}
    </span>
  );
}

/* ── The legend — prototype 187-198 ──────────────────────────────────────── */

function LegendItem({ tone, mark, label }: { tone: string; mark: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: tone }}>
      {mark}
      <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/* ── The slide-over chrome — prototype 260-544 ───────────────────────────── */

function SlideOver({
  accent,
  width,
  onClose,
  overlayAlpha = 0.62,
  shadow = "-24px 0 60px rgba(2,6,23,.65)",
  testId,
  children,
}: {
  accent: string;
  width: string;
  onClose: () => void;
  overlayAlpha?: number;
  shadow?: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 120, background: `rgba(2,6,23,${overlayAlpha})`, backdropFilter: "blur(2px)" }}
      />
      <div
        data-testid={testId}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 121,
          width,
          display: "flex",
          flexDirection: "column",
          borderLeft: `1px solid ${accent}`,
          background: "#0b1524",
          boxShadow: shadow,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}

/** The kicker / title / intro header every slide-over opens with. */
function SlideHeader({
  kicker,
  kickerColour,
  border,
  title,
  intro,
  onClose,
}: {
  kicker: string;
  kickerColour: string;
  border: string;
  title: string;
  intro: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        padding: "16px 20px",
        borderBottom: `1px solid ${border}`,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: kickerColour }}>
          {kicker}
        </span>
        <span style={{ fontSize: "14.5px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em", lineHeight: 1.35 }}>
          {title}
        </span>
        <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.55 }}>{intro}</span>
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          flex: "0 0 auto",
          width: 26,
          height: 26,
          borderRadius: 6,
          border: "1px solid rgba(148,163,184,.2)",
          background: "transparent",
          color: "#94a3b8",
          fontSize: "13px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ×
      </button>
    </div>
  );
}

function pill(text: string, tone: string, bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".04em",
    whiteSpace: "nowrap",
    color: tone,
    background: bg,
    border: `1px solid ${tone}33`,
  };
}

export interface OwnershipMatrixProps {
  /** The shell's list. Absent means standalone, and the module holds its own. */
  people?: readonly OwnPerson[];
  onPeopleChange?: (next: readonly OwnPerson[]) => void;
  /** The shell sub-nav's selection. "all" or an object type key. */
  typeFilter?: string;
  /** From Settings → Ownership routing. Drives the late/escalation marks. */
  escDays?: number;
}

export function OwnershipMatrix({
  people: peopleProp,
  onPeopleChange,
  typeFilter = "all",
  escDays = 5,
}: OwnershipMatrixProps) {
  // The standalone fallback — prototype 720-721. Only ever read when the
  // caller passes no `people`, so the shell-wired page never touches it.
  const [localPeople, setLocalPeople] = useState<readonly OwnPerson[]>(OWN_PEOPLE_SEED);
  const people = peopleProp ?? localPeople;
  void onPeopleChange;
  void setLocalPeople;

  const [overrides, setOverrides] = useState<OwnerOverrides>({});
  const [provOv, setProvOv] = useState<ProvenanceOverrides>({});
  const [accOv, setAccOv] = useState<AcceptanceOverrides>({});
  const [risks, setRisks] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<readonly string[]>([]);
  const [custom, setCustom] = useState<readonly CustomRow[]>([]);
  const [panel, setPanel] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [assign, setAssign] = useState<{ id: string; k: RoleKey } | null>(null);
  const [rowOpen, setRowOpen] = useState<string | null>(null);
  const [addToOpen, setAddToOpen] = useState(false);
  const [handover, setHandover] = useState<{ to: string; until: string; scope: string } | null>(null);
  const [delegations, setDelegations] = useState<readonly Delegation[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<Record<string, boolean>>({
    decisions: true,
    approvals: true,
    consulted: true,
    informed: true,
    digest: true,
    escalate: true,
  });
  const [newRow, setNewRow] = useState<{ type: ObjectTypeKey; name: string; sub: string } | null>(null);
  const [reviewedAt, setReviewedAt] = useState(MATRIX_REVIEWED_AT);
  const [reviewDue, setReviewDue] = useState(MATRIX_REVIEW_DUE_DAYS);
  const [escDaysState, setEscDaysState] = useState(escDays);
  const [toast, setToast] = useState("");

  const objects = useMemo(() => allObjectsWith(added, custom), [added, custom]);
  const gaps = useMemo(() => gapRows(objects, overrides, risks), [objects, overrides, risks]);
  const sod = useMemo(() => sodRows(objects, overrides, people), [objects, overrides, people]);
  const warns = useMemo(() => loadWarnRows(objects, overrides, people), [objects, overrides, people]);
  const coverage = useMemo(() => coverageRows(added), [added]);
  const shown = useMemo(
    () => shownObjects(objects, overrides, typeFilter, personId),
    [objects, overrides, typeFilter, personId],
  );
  const groups = useMemo(() => groupedByType(shown, overrides), [shown, overrides]);
  const load = useMemo(() => loadRows(objects, overrides, people, search), [objects, overrides, people, search]);
  const escLate = useMemo(() => escalationLate(objects, overrides, escDaysState), [objects, overrides, escDaysState]);

  const personOf = (id: string | null | undefined): OwnPerson | null =>
    id ? people.find((p) => p.id === id) ?? null : null;
  const selected = personOf(personId);
  const personName = selected?.name ?? null;

  const counterRow = counters({
    gaps: gaps.length,
    sod: sod.length,
    load: warns.length,
    coverage: coverage.length,
    total: objects.length,
  });

  const t = (msg: string) => setToast(msg);

  /** Open the design's own assign slide-over — prototype 744. */
  const openAssign = (obj: OwnObject, k: RoleKey) => setAssign({ id: obj.id, k });

  /** prototype 747-758. Sets the name, records who changed it and starts the accept clock. */
  const setOwner = (objId: string, k: RoleKey, whoId: string, objName: string, roleLabel: string) => {
    const key = `${objId}:${k}`;
    const p = personOf(whoId);
    setOverrides((cur) => ({ ...cur, [key]: whoId }));
    setProvOv((cur) => ({
      ...cur,
      [key]: { by: CURRENT_USER, at: "20 Aug 2026", why: "Changed on the ownership page", from: "20 Aug 2026" },
    }));
    setAccOv((cur) => ({ ...cur, [key]: whoId ? "pending" : "" }));
    setAssign(null);
    setToast(
      p
        ? `${roleLabel} for ${objName} is now ${p.name} — waiting for them to accept it.`
        : `${objName} has no ${roleLabel.toLowerCase()} — recorded as a gap.`,
    );
  };

  const acceptOwner = (objId: string, k: RoleKey, name: string, roleLabel: string) => {
    setAccOv((cur) => ({ ...cur, [`${objId}:${k}`]: "accepted" }));
    setToast(`${roleLabel} accepted for ${name}, recorded against today.`);
  };

  const nudgeOwner = (personLabel: string, name: string) =>
    t(`Nudged ${personLabel} to accept ${name}. Asked again in two days, then it escalates.`);

  const openNewRow = (type: ObjectTypeKey) => setNewRow({ type, name: "", sub: "" });

  const submitNewRow = () => {
    if (!newRow || !newRow.name.trim()) return;
    const id = `own-${Date.now()}`;
    setCustom((cur) => cur.concat([{ id, type: newRow.type, name: newRow.name.trim(), sub: newRow.sub.trim() }]));
    setNewRow(null);
    setToast(`${newRow.name.trim()} added with four gaps on it. Assign responsible first — that is the one that does the work.`);
  };

  const submitHandover = () => {
    if (!handover || !selected || !handover.to || !handover.until.trim()) return;
    const to = personOf(handover.to);
    setDelegations((cur) =>
      cur.concat([{ from: selected.id, to: handover.to, until: handover.until.trim(), scope: handover.scope, done: false }]),
    );
    setHandover(null);
    setToast(`${to ? to.name : handover.to} covers ${selected.name} until ${handover.until.trim()}. It ends on its own.`);
  };

  const endDelegation = () => {
    if (!personId) return;
    setDelegations((cur) => cur.map((d) => (d.from === personId ? { ...d, done: true } : d)));
    setToast("Handover ended. It is theirs again from today.");
  };

  const reviewNow = () => {
    setReviewedAt("20 Aug 2026");
    setReviewDue(90);
    setToast(`Matrix reviewed — all ${objects.length} rows confirmed against today, and everyone named gets a copy of what they now own.`);
  };

  const toggleRisk = (objId: string, objName: string) => {
    if (risks[objId]) {
      setRisks((cur) => {
        const next = { ...cur };
        delete next[objId];
        return next;
      });
      setToast(`${objName} is back in the gaps list.`);
    } else {
      setRisks((cur) => ({ ...cur, [objId]: `accepted ${CURRENT_USER.split(" ")[0]}, 20 Aug` }));
      setAssign(null);
      setToast(`${objName} recorded as knowingly unowned. Out of the gap list, still on the record.`);
    }
  };

  const toggleRule = (k: string, label: string) => {
    const on = !!rules[k];
    setRules((cur) => ({ ...cur, [k]: !on }));
    setToast(on ? `${label} is off. Ownership still shows, but nothing routes.` : `${label} is live again.`);
  };

  const namedOnCount = selected
    ? objects.filter((o) => shownObjects([o], overrides, "all", selected.id).length).length
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {/* Header — prototype 30-38 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          paddingBottom: 13,
          borderBottom: "1px solid rgba(30,41,59,.9)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
          <span
            style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}
            data-testid="pv2-page-title"
          >
            Ownership
          </span>
          <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
            Four names against every service, change, control and freeze. Everything else on this portal reads
            its owners from here.
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <button
            onClick={() => setRulesOpen(true)}
            data-testid="pv2-own-routing"
            style={{
              padding: "8px 13px",
              borderRadius: 7,
              fontSize: "11.5px",
              fontWeight: 600,
              border: "1px solid rgba(148,163,184,.24)",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {routingLabel(rules)}
          </button>
          <button
            onClick={() =>
              t("Matrix exported — one page per object type, gaps listed first, with the date each name was last changed.")
            }
            data-testid="pv2-own-export"
            style={{
              padding: "8px 13px",
              borderRadius: 7,
              fontSize: "11.5px",
              fontWeight: 600,
              border: "1px solid rgba(148,163,184,.24)",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            Export the matrix
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "228px minmax(0,1fr)", gap: 24, alignItems: "start" }}>
        {/* Load sidebar — prototype 41-72 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 18,
            maxHeight: "calc(100vh - 120px)",
            overflowY: "auto",
            overflowX: "hidden",
            padding: "10px 14px 14px 0",
            borderRight: "1px solid rgba(30,41,59,.8)",
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people and groups"
            data-testid="pv2-own-search"
            aria-label="Search people and groups"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 10px",
              borderRadius: 7,
              border: "1px solid rgba(148,163,184,.2)",
              background: "#0b1a2e",
              color: "#e2e8f0",
              fontSize: "11.5px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          {(
            [
              { title: "Load per person", rows: load.filter((r) => r.person.kind === "Person"), empty: "No person matches that." },
              {
                title: "Load per group or department",
                rows: load.filter((r) => r.person.kind !== "Person"),
                empty: "No group matches that.",
              },
            ] as const
          ).map((band, bi) => (
            <div
              key={band.title}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                paddingTop: bi === 0 ? 0 : 11,
                borderTop: bi === 0 ? "none" : "1px solid rgba(30,41,59,.8)",
              }}
            >
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "#475569",
                }}
              >
                {band.title}
              </span>
              {band.rows.length === 0 && (
                <span style={{ fontSize: "10.5px", color: "#475569", padding: "2px 0" }}>{band.empty}</span>
              )}
              {band.rows.map((r) => {
                const on = personId === r.person.id;
                return (
                  <button
                    key={r.person.id}
                    onClick={() => setPersonId(on ? null : r.person.id)}
                    data-testid={`pv2-own-load-${r.person.id}`}
                    aria-pressed={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 7px 5px 5px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      width: "100%",
                      border: `1px solid ${on ? "rgba(45,212,191,.45)" : "transparent"}`,
                      background: on ? "rgba(45,212,191,.1)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 26px",
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "9.5px",
                        fontWeight: 800,
                        color: "#0b1524",
                        background: on ? "#2dd4bf" : "#475569",
                      }}
                    >
                      {initialsOf(r.person.name)}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: on ? 800 : 600,
                          color: on ? "#f8fafc" : "#cbd5e1",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.person.name}
                      </span>
                      <span style={{ fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap" }}>{r.meta}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Selected-person band — prototype 76-105 */}
          {selected && (
            <div
              data-testid="pv2-own-person-band"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "15px 17px",
                border: "1px solid rgba(45,212,191,.35)",
                borderRadius: 13,
                background: "linear-gradient(135deg,rgba(45,212,191,.09),rgba(11,21,36,.9))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
                <span
                  style={{
                    flex: "0 0 34px",
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 800,
                    color: "#0b1524",
                    background: "#2dd4bf",
                  }}
                >
                  {initialsOf(selected.name)}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em" }}>
                    {selected.name}
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {selected.role} · {selected.side} · {selected.kind.toLowerCase()}
                  </span>
                </div>
                {selected.away && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 5,
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#fbbf24",
                      background: "rgba(251,191,36,.12)",
                      border: "1px solid rgba(251,191,36,.33)",
                    }}
                  >
                    {selected.away}
                  </span>
                )}
                {personDelText(delegations, selected.id, people) && (
                  <button
                    onClick={endDelegation}
                    data-testid="pv2-own-person-enddel"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(96,165,250,.45)",
                      background: "rgba(96,165,250,.12)",
                      color: "#93c5fd",
                      fontSize: "10.5px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {personDelText(delegations, selected.id, people)} · end it
                  </button>
                )}
                <span style={{ marginLeft: "auto", fontSize: "11px", color: "#64748b", whiteSpace: "nowrap" }}>
                  Named on {namedOnCount} of {objects.length}
                </span>
                <button
                  onClick={() => setAddToOpen(true)}
                  data-testid="pv2-own-person-more"
                  style={{
                    padding: "7px 12px",
                    borderRadius: 7,
                    border: "1px solid rgba(45,212,191,.5)",
                    background: "rgba(45,212,191,.14)",
                    color: "#2dd4bf",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Assign to more
                </button>
                <button
                  onClick={() => setHandover({ to: "", until: "", scope: "all" })}
                  data-testid="pv2-own-person-hand"
                  style={{
                    padding: "7px 12px",
                    borderRadius: 7,
                    border: "1px solid rgba(96,165,250,.45)",
                    background: "rgba(96,165,250,.1)",
                    color: "#93c5fd",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Hand over
                </button>
                <button
                  onClick={() =>
                    t(`Exported what ${selected.name} owns — one page, four sections, with the dates each one lands. The version people actually read in a one-to-one.`)
                  }
                  data-testid="pv2-own-person-export"
                  style={{
                    padding: "7px 11px",
                    borderRadius: 7,
                    border: "1px solid rgba(148,163,184,.24)",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Export
                </button>
                <button
                  onClick={() => setPersonId(null)}
                  data-testid="pv2-own-person-clear"
                  style={{
                    padding: "7px 11px",
                    borderRadius: 7,
                    border: "1px solid rgba(148,163,184,.24)",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Everyone
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(118px,1fr))", gap: 8 }}>
                {personCounts(objects, overrides, selected.id).map((c) => (
                  <div
                    key={c.role.k}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      padding: "8px 11px",
                      borderRadius: 9,
                      border: `1px solid ${c.role.tone}2e`,
                      borderLeft: `3px solid ${c.role.tone}`,
                      background: "rgba(2,6,23,.5)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "18px",
                        fontWeight: 800,
                        letterSpacing: "-.02em",
                        lineHeight: 1.05,
                        color: c.role.tone,
                        fontFamily: MONO,
                      }}
                    >
                      {c.value}
                    </span>
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8" }}>{c.role.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── The five counters ─────────────────────────────────────────── */}
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8 }}
            data-testid="pv2-own-counters"
          >
            {counterRow.map((c) => {
              const on = counterOn(c.k, panel);
              return (
                <button
                  key={c.k}
                  onClick={() => setPanel(nextPanel(c.k, panel))}
                  data-testid={`pv2-own-counter-${c.k}`}
                  aria-pressed={on}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    minWidth: 0,
                    border: `1px solid ${on ? `${c.tone}80` : "rgba(30,41,59,.9)"}`,
                    background: on ? `${c.tone}14` : "#0b1524",
                  }}
                >
                  <span
                    style={{
                      fontSize: "19px",
                      fontWeight: 800,
                      letterSpacing: "-.02em",
                      lineHeight: 1.1,
                      color: c.tone,
                      fontFamily: MONO,
                    }}
                  >
                    {c.value}
                  </span>
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".03em",
                      textTransform: "uppercase",
                      lineHeight: 1.25,
                      whiteSpace: "normal",
                      textWrap: "pretty",
                      maxWidth: "100%",
                      color: on ? "#cbd5e1" : "#64748b",
                    }}
                  >
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>

          {panel === "gaps" && (
            <DetailPanel tone="#fbbf24" meta={gapMeta(gaps.length, objects.length)} testId="pv2-own-panel-gaps">
              {gaps.map((g) => {
                const type = OBJECT_TYPES.find((x) => x.key === g.typeKey);
                const obj = objects.find((o) => o.id === g.id);
                return (
                  <DetailRow key={g.id} tone="#fbbf24" columns="118px minmax(0,1fr) 152px">
                    <TypeChip tone={type?.tone ?? "#94a3b8"} label={g.type} />
                    <DetailBody name={g.name} note={g.risk} />
                    <DetailAction
                      tone="#fbbf24"
                      label={g.action}
                      testId={`pv2-own-gap-assign-${g.id}`}
                      onClick={() => obj && openAssign(obj, g.roleKey)}
                    />
                  </DetailRow>
                );
              })}
            </DetailPanel>
          )}

          {panel === "sod" && (
            <DetailPanel tone="#f87171" meta={sodMeta(sod.length)} testId="pv2-own-panel-sod">
              {sod.map((c) => {
                const obj = objects.find((o) => `${o.id}:same` === c.id || `${o.id}:kind` === c.id);
                return (
                  <DetailRow key={c.id} tone="#f87171" columns="minmax(0,1fr) 132px">
                    <DetailBody name={c.name} note={c.detail} />
                    <DetailAction
                      tone="#f87171"
                      label={c.action}
                      testId={`pv2-own-sod-action-${c.id}`}
                      href={c.kind === "people" ? PEOPLE_SETTINGS_HREF : undefined}
                      onClick={
                        c.kind === "assign" && obj && c.roleKey
                          ? () => openAssign(obj, c.roleKey as RoleKey)
                          : undefined
                      }
                    />
                  </DetailRow>
                );
              })}
            </DetailPanel>
          )}

          {panel === "load" && (
            <DetailPanel tone="#fb923c" meta={loadMeta(warns.length)} testId="pv2-own-panel-load">
              {warns.map((w) => (
                <DetailRow key={w.id} tone="#fb923c" columns="minmax(0,1fr) 132px">
                  <DetailBody name={w.name} note={w.detail} />
                  <DetailAction
                    tone="#fb923c"
                    label={w.action}
                    testId={`pv2-own-load-action-${w.id}`}
                    href={PEOPLE_SETTINGS_HREF}
                  />
                </DetailRow>
              ))}
            </DetailPanel>
          )}

          {panel === "cov" && (
            <DetailPanel tone="#60a5fa" meta={covMeta(coverage.length)} testId="pv2-own-panel-cov">
              {coverage.map((m) => (
                <DetailRow key={m.id} tone="#60a5fa" columns="118px minmax(0,1fr) 122px">
                  <TypeChip tone="#f87171" label={m.type} />
                  <DetailBody name={m.name} note={m.why} />
                  <DetailAction
                    tone="#93c5fd"
                    label="Give it a row"
                    testId={`pv2-own-cov-add-${m.id}`}
                    onClick={() => {
                      setAdded((cur) => cur.concat([m.id]));
                      setToast(`${m.name} now has a row, with four gaps on it. Assign them.`);
                    }}
                  />
                </DetailRow>
              ))}
            </DetailPanel>
          )}

          {/* ── The matrix — prototype 178-253 ──────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "16px 18px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 13,
              background: "#0b1524",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#2dd4bf",
                  }}
                >
                  The matrix
                </span>
                <button
                  onClick={() => openNewRow("service")}
                  data-testid="pv2-own-add-row"
                  style={{
                    padding: "5px 11px",
                    borderRadius: 6,
                    border: "1px solid rgba(45,212,191,.45)",
                    background: "rgba(45,212,191,.12)",
                    color: "#2dd4bf",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Add a row
                </button>
                <span
                  style={{
                    fontSize: "10.5px",
                    color: reviewDue < MATRIX_REVIEW_WARN_DAYS ? "#fbbf24" : "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  {reviewLine(reviewedAt, reviewDue)}
                </span>
                <button
                  onClick={reviewNow}
                  data-testid="pv2-own-review"
                  style={{
                    padding: "5px 11px",
                    borderRadius: 6,
                    border: "1px solid rgba(148,163,184,.24)",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "10.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  Review now
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
                <LegendItem tone="#fbbf24" mark={<MarkPending />} label="Not accepted" />
                <LegendItem tone="#f87171" mark={<MarkLate />} label="Past the escalation clock" />
                <LegendItem tone="#94a3b8" mark={<MarkAway />} label="Away, deputy covering" />
                <span style={{ fontSize: "11px", color: "#64748b" }} data-testid="pv2-own-matrix-meta">
                  {matrixMeta(shown.length, objects.length)}
                </span>
              </div>
            </div>

            <div style={{ overflow: "visible" }}>
              <div style={{ minWidth: 560, display: "flex", flexDirection: "column", gap: 13 }}>
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 3,
                    display: "grid",
                    gridTemplateColumns: ROW_GRID,
                    gap: 6,
                    padding: "9px 19px",
                    margin: "-9px -1px 0",
                    borderRadius: 9,
                    background: "rgba(11,21,36,.96)",
                    backdropFilter: "blur(6px)",
                    boxShadow: "0 6px 14px rgba(2,6,23,.5)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      letterSpacing: ".11em",
                      textTransform: "uppercase",
                      color: "#475569",
                    }}
                  >
                    Object
                  </span>
                  {ROLE_KEYS.map((rk) => (
                    <span
                      key={rk.k}
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: ".11em",
                        textTransform: "uppercase",
                        color: rk.tone,
                      }}
                    >
                      {rk.label}
                    </span>
                  ))}
                </div>

                {groups.length === 0 && (
                  <div
                    data-testid="pv2-own-empty"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 14,
                      border: "1px dashed rgba(148,163,184,.22)",
                      borderRadius: 10,
                    }}
                  >
                    <span
                      style={{ width: 7, height: 7, borderRadius: "50%", background: "#64748b", flex: "0 0 auto" }}
                    />
                    <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>
                      {noRowsLine(personName)}
                    </span>
                  </div>
                )}

                {groups.map((grp) => (
                  <div
                    key={grp.type.key}
                    data-testid={`pv2-own-group-${grp.type.key}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0,
                      border: `1px solid ${grp.type.tone}2b`,
                      borderRadius: 12,
                      background: "rgba(2,6,23,.28)",
                    }}
                  >
                    <div
                      style={{
                        position: "sticky",
                        top: 38,
                        zIndex: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "9px 12px",
                        background: `linear-gradient(${grp.type.tone}1f,${grp.type.tone}1f),#0b1524`,
                        borderBottom: `1px solid ${grp.type.tone}2b`,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          flex: "0 0 auto",
                          background: grp.type.tone,
                        }}
                      />
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 800,
                          letterSpacing: ".09em",
                          textTransform: "uppercase",
                          color: grp.type.tone,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {grp.type.label}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          color: grp.gaps ? "#fbbf24" : "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {grp.meta}
                      </span>
                      <button
                        onClick={() => openNewRow(grp.type.key)}
                        data-testid={`pv2-own-group-add-${grp.type.key}`}
                        style={{
                          marginLeft: "auto",
                          padding: "4px 9px",
                          borderRadius: 6,
                          border: `1px solid ${grp.type.tone}4d`,
                          background: "transparent",
                          color: grp.type.tone,
                          fontSize: "10px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                        }}
                      >
                        + Add
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: 8 }}>
                      {grp.rows.map((o) => {
                        const rowGaps = gapsOf(o, overrides).length > 0;
                        return (
                          <div
                            key={o.id}
                            data-testid={`pv2-own-row-${o.id}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: ROW_GRID,
                              gap: 6,
                              alignItems: "center",
                              padding: "9px 10px",
                              border: `1px solid ${rowGaps ? "rgba(251,191,36,.32)" : "rgba(148,163,184,.1)"}`,
                              borderRadius: 9,
                              background: rowGaps ? "rgba(251,191,36,.05)" : "rgba(11,21,36,.75)",
                            }}
                          >
                            <button
                              onClick={() => setRowOpen(o.id)}
                              data-testid={`pv2-own-rowname-${o.id}`}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                minWidth: 0,
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                textAlign: "left",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  color: "#e2e8f0",
                                  lineHeight: 1.35,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: "100%",
                                }}
                              >
                                {o.name}
                              </span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "#64748b",
                                  lineHeight: 1.4,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: "100%",
                                }}
                              >
                                {rowSub(o, risks)}
                              </span>
                            </button>
                            {ROLE_KEYS.map((rk) => {
                              const pid = ownerOf(o, rk.k, overrides);
                              const p = personOf(pid);
                              const mark = cellMark({ objectId: o.id, k: rk.k, person: p, escDays: escDaysState, accOv });
                              const mine = !!personId && pid === personId;
                              const acc = p ? acceptanceOf(o.id, rk.k, accOv) : "";
                              return (
                                <button
                                  key={rk.k}
                                  onClick={() => openAssign(o, rk.k)}
                                  data-testid={`pv2-own-cell-${o.id}-${rk.k}`}
                                  title={cellTitle({
                                    obj: o,
                                    k: rk.k,
                                    roleLabel: rk.label,
                                    person: p,
                                    escDays: escDaysState,
                                    accOv,
                                    provOv,
                                  })}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-start",
                                    padding: "5px 6px",
                                    borderRadius: 6,
                                    fontSize: "11px",
                                    fontWeight: mine ? 800 : p ? 600 : 700,
                                    fontFamily: "inherit",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    opacity: personId && !mine ? 0.45 : 1,
                                    border: mine
                                      ? `1px solid ${rk.tone}`
                                      : p
                                        ? acc === "pending"
                                          ? "1px dashed rgba(251,191,36,.55)"
                                          : `1px solid ${rk.tone}2e`
                                        : "1px dashed rgba(251,191,36,.5)",
                                    background: mine ? `${rk.tone}26` : p ? `${rk.tone}10` : "transparent",
                                    color: p ? "#e2e8f0" : "#fbbf24",
                                  }}
                                >
                                  {mark && (
                                    <span
                                      style={{
                                        flex: "0 0 auto",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        marginRight: 4,
                                        lineHeight: 0,
                                        color: MARK_TONE[mark],
                                      }}
                                    >
                                      {mark === "late" ? <MarkLate /> : mark === "pending" ? <MarkPending /> : <MarkAway />}
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      minWidth: 0,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {p ? p.name : "Assign"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── The assign slide-over — prototype 260-324 ─────────────────────── */}
      {assign &&
        (() => {
          const A = assign;
          const aObj = objects.find((o) => o.id === A.id);
          const aRole = ROLE_KEYS.find((r) => r.k === A.k);
          if (!aObj || !aRole) return null;
          const cur = ownerOf(aObj, A.k, overrides);
          const curPerson = personOf(cur);
          const deputy = curPerson?.deputy ? personOf(curPerson.deputy) : null;
          const pending = acceptanceOf(A.id, A.k, accOv) === "pending" && !!cur;
          const accText = assignAcceptLabel(A.id, A.k, cur, accOv);
          const cover = coverLine(curPerson, deputy);
          const esc = escLine(escalationOf(A.id, A.k), escDaysState);
          const del = delNote(delegations, aObj, cur, people);
          const delivery = deliveryLine(A.id, A.k);
          const history = priorHolders(A.id, A.k);
          const riskable = !cur;
          const eligible = A.k === "r" ? people.filter((p) => p.kind === "Person") : people;
          return (
            <SlideOver accent="rgba(0,120,212,.4)" width="min(520px,95vw)" onClose={() => setAssign(null)} testId="pv2-own-assign">
              <SlideHeader
                kicker={`${aRole.label} · ${A.id}`}
                kickerColour="#60a5fa"
                border="rgba(0,120,212,.2)"
                title={`Who is ${aRole.label.toLowerCase()} for ${aObj.name}?`}
                intro={aRole.def}
                onClose={() => setAssign(null)}
              />
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 13px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 10, background: "rgba(2,6,23,.45)" }}>
                  {accText && (
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={pending ? pill(accText, "#fbbf24", "rgba(251,191,36,.12)") : pill(accText, "#34d399", "rgba(52,211,153,.12)")}>
                        {accText}
                      </span>
                      {pending && (
                        <button
                          onClick={() => acceptOwner(A.id, A.k, aObj.name, aRole.label)}
                          data-testid="pv2-own-assign-accept"
                          style={{ padding: "5px 11px", borderRadius: 6, border: "1px solid rgba(52,211,153,.45)", background: "rgba(52,211,153,.12)", color: "#34d399", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                        >
                          Mark accepted
                        </button>
                      )}
                      {pending && (
                        <button
                          onClick={() => nudgeOwner(curPerson ? curPerson.name : "nobody", aObj.name)}
                          style={{ padding: "5px 11px", borderRadius: 6, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          Nudge
                        </button>
                      )}
                    </div>
                  )}
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>
                    {provLine(provenanceOf(A.id, A.k, provOv))}
                  </span>
                  {cover && <span style={{ fontSize: "11px", color: "#fbbf24", lineHeight: 1.55 }}>{cover}</span>}
                  <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.55 }}>{esc}</span>
                  {del && <span style={{ fontSize: "11px", color: "#93c5fd", lineHeight: 1.55 }}>{del}</span>}
                  {delivery && (
                    <span style={{ fontSize: "11px", lineHeight: 1.55, color: deliverySent(A.id) ? "#34d399" : "#f87171" }}>{delivery}</span>
                  )}
                  {riskable && (
                    <button
                      onClick={() => toggleRisk(A.id, aObj.name)}
                      data-testid="pv2-own-assign-risk"
                      style={{ alignSelf: "flex-start", padding: "5px 11px", borderRadius: 6, border: "1px dashed rgba(148,163,184,.35)", background: "transparent", color: "#94a3b8", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {riskButtonLabel(!!risks[A.id])}
                    </button>
                  )}
                </div>
                {history.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 13px", border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.3)" }}>
                    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#94a3b8" }}>
                      Who held it before
                    </span>
                    {history.map((h) => (
                      <div key={`${h.who}-${h.when}`} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "8px 10px", borderLeft: "2px solid rgba(148,163,184,.28)", background: "rgba(2,6,23,.4)" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#cbd5e1" }}>{h.who}</span>
                        <span style={{ fontSize: "10px", color: "#64748b" }}>{h.when}</span>
                        <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{h.why}</span>
                      </div>
                    ))}
                  </div>
                )}
                {eligible.map((p) => {
                  const isCur = cur === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setOwner(A.id, A.k, p.id, aObj.name, aRole.label)}
                      data-testid={`pv2-own-assign-option-${p.id}`}
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", width: "100%", border: `1px solid ${isCur ? "rgba(52,211,153,.4)" : "rgba(148,163,184,.18)"}`, background: isCur ? "rgba(52,211,153,.07)" : "transparent" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flex: "0 0 auto", borderRadius: "50%", fontSize: "10px", fontWeight: 800, color: "#0b1524", background: aRole.tone }}>
                        {initialsOf(p.name)}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", textAlign: "left" }}>{p.name}</span>
                        <span style={{ fontSize: "10.5px", color: "#64748b", textAlign: "left" }}>{p.role} · {p.side}</span>
                      </div>
                      <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: isCur ? "#34d399" : "transparent", whiteSpace: "nowrap" }}>
                        {isCur ? "Current" : ""}
                      </span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setOwner(A.id, A.k, "", aObj.name, aRole.label)}
                  data-testid="pv2-own-assign-clear"
                  style={{ marginTop: 6, padding: "10px 13px", borderRadius: 8, border: "1px dashed rgba(251,191,36,.4)", background: "transparent", color: "#fbbf24", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                >
                  Leave unassigned — record it as a gap
                </button>
              </div>
            </SlideOver>
          );
        })()}

      {/* ── The add-a-row slide-over — prototype 326-363 ──────────────────── */}
      {newRow && (
        <SlideOver accent="rgba(45,212,191,.4)" width="min(520px,95vw)" onClose={() => setNewRow(null)} testId="pv2-own-newrow">
          <SlideHeader
            kicker="New row"
            kickerColour="#2dd4bf"
            border="rgba(45,212,191,.2)"
            title="Add something to the matrix"
            intro="Anything that can go wrong and needs a name against it. It arrives with four gaps, which is honest — it is what you had before the row existed."
            onClose={() => setNewRow(null)}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>What kind of thing is it</span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {OBJECT_TYPES.map((ty) => {
                  const on = newRow.type === ty.key;
                  return (
                    <button
                      key={ty.key}
                      onClick={() => setNewRow((cur) => (cur ? { ...cur, type: ty.key } : cur))}
                      style={{ padding: "7px 11px", borderRadius: 7, fontSize: "11px", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${on ? `${ty.tone}99` : "rgba(148,163,184,.2)"}`, background: on ? `${ty.tone}1f` : "transparent", color: on ? "#e2e8f0" : "#94a3b8" }}
                    >
                      {ty.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>Name</span>
              <input
                value={newRow.name}
                onChange={(e) => setNewRow((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
                placeholder="e.g. Power BI workspaces"
                data-testid="pv2-own-newrow-name"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.55)", color: "#e2e8f0", fontSize: "12.5px", fontFamily: "inherit" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>The detail underneath</span>
              <input
                value={newRow.sub}
                onChange={(e) => setNewRow((cur) => (cur ? { ...cur, sub: e.target.value } : cur))}
                placeholder="e.g. 14 workspaces · 3 with external viewers"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.55)", color: "#e2e8f0", fontSize: "12.5px", fontFamily: "inherit" }}
              />
              <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5 }}>Numbers from your tenant if you have them. It is the line people read before they accept the job.</span>
            </div>
          </div>
          <div style={{ flex: "0 0 auto", padding: "14px 20px", borderTop: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={submitNewRow}
              disabled={!newRow.name.trim()}
              data-testid="pv2-own-newrow-submit"
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: newRow.name.trim() ? "pointer" : "not-allowed", border: `1px solid ${newRow.name.trim() ? "#0078D4" : "rgba(148,163,184,.18)"}`, background: newRow.name.trim() ? "#0078D4" : "transparent", color: newRow.name.trim() ? "#fff" : "#475569" }}
            >
              {newRow.name.trim() ? "Add the row" : "Give it a name"}
            </button>
            <button onClick={() => setNewRow(null)} style={{ padding: "9px 15px", borderRadius: 7, border: "none", background: "transparent", color: "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </SlideOver>
      )}

      {/* ── What ownership drives — prototype 365-402 ─────────────────────── */}
      {rulesOpen && (
        <SlideOver accent="rgba(0,120,212,.4)" width="min(600px,96vw)" onClose={() => setRulesOpen(false)} testId="pv2-own-rules">
          <SlideHeader
            kicker="Settings · routing"
            kickerColour="#60a5fa"
            border="rgba(0,120,212,.2)"
            title="What ownership drives"
            intro="Turn a rule off and this page becomes a diagram instead of a system."
            onClose={() => setRulesOpen(false)}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 10, background: "rgba(2,6,23,.45)", flexWrap: "wrap" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>Escalation clock</span>
              <button onClick={() => setEscDaysState((d) => Math.max(1, d - 1))} style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>−</button>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "#e2e8f0", minWidth: 52, textAlign: "center" }}>{escDaysState} days</span>
              <button onClick={() => setEscDaysState((d) => Math.min(30, d + 1))} style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 }}>+</button>
              <span style={{ fontSize: "10.5px", color: "#64748b", whiteSpace: "nowrap" }}>{escLateCount(objects, overrides, escDaysState)} past it now</span>
            </div>
            {ROUTING_RULES.map((r) => {
              const on = !!rules[r.k];
              return (
                <button
                  key={r.k}
                  onClick={() => toggleRule(r.k, r.label)}
                  data-testid={`pv2-own-rule-${r.k}`}
                  style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) 46px", gap: 11, alignItems: "center", padding: "11px 13px", borderRadius: 10, border: `1px solid ${on ? "rgba(0,120,212,.24)" : "rgba(148,163,184,.16)"}`, background: on ? "rgba(0,120,212,.05)" : "transparent", cursor: "pointer", fontFamily: "inherit", width: "100%" }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 4, fontSize: "10px", fontWeight: 800, color: on ? "#04121f" : "transparent", background: on ? "#34d399" : "transparent", border: `1px solid ${on ? "#34d399" : "rgba(148,163,184,.35)"}` }}>✓</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, textAlign: "left" }}>{r.label}</span>
                    <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5, textAlign: "left", textWrap: "pretty" }}>{routingRuleLive(r, escDaysState, escLate)}</span>
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap", color: on ? "#34d399" : "#64748b" }}>{on ? "Live" : "Off"}</span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: "0 0 auto", padding: "14px 20px", borderTop: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setRulesOpen(false)} style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12px", fontWeight: 700, border: "1px solid #0078D4", background: "#0078D4", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Done</button>
            <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.45, flex: "1 1 200px", minWidth: 0 }}>Every rule reads the matrix live. Nothing here is a copy of it.</span>
          </div>
        </SlideOver>
      )}

      {/* ── Assign to more — prototype 404-440 ────────────────────────────── */}
      {addToOpen && selected && (
        <SlideOver accent="rgba(45,212,191,.4)" width="min(600px,96vw)" onClose={() => setAddToOpen(false)} testId="pv2-own-addto">
          <SlideHeader
            kicker="Assign"
            kickerColour="#2dd4bf"
            border="rgba(45,212,191,.2)"
            title={`Give ${selected.name.split(" ")[0]} something else`}
            intro="Everything they are not named on yet. Pick the role you want them in — responsible does the work, accountable answers for it."
            onClose={() => setAddToOpen(false)}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "14px 20px 24px", display: "flex", flexDirection: "column", gap: 7 }}>
            {addToRows(objects, selected.id, overrides).map((o) => (
              <div key={o.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 128px", gap: 11, alignItems: "center", padding: "10px 12px", border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={pill(o.type, o.tone, `${o.tone}14`)}>{o.type}</span>
                    <span style={{ fontSize: "10.5px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {ROLE_KEYS.map((rk) => (
                    <button
                      key={rk.k}
                      onClick={() => setOwner(o.id, rk.k, selected.id, o.name, rk.label)}
                      style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${rk.tone}4d`, background: `${rk.tone}12`, color: rk.tone, fontSize: "10.5px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {rk.k.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: "0 0 auto", padding: "14px 20px", borderTop: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setAddToOpen(false)} style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12px", fontWeight: 700, border: "1px solid #0078D4", background: "#0078D4", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Done</button>
            <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.45, flex: "1 1 200px", minWidth: 0 }}>Each one arrives as not accepted, so they get asked before it counts.</span>
          </div>
        </SlideOver>
      )}

      {/* ── Handover — prototype 442-484 ─────────────────────────────────── */}
      {handover && selected && (
        <SlideOver accent="rgba(96,165,250,.4)" width="min(540px,95vw)" onClose={() => setHandover(null)} testId="pv2-own-handover">
          <SlideHeader
            kicker="Handover"
            kickerColour="#60a5fa"
            border="rgba(96,165,250,.2)"
            title={`Hand over ${selected.name.split(" ")[0]}’s work`}
            intro="A dated handover, not a permanent change. It ends by itself, and the matrix goes back to what it says today."
            onClose={() => setHandover(null)}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>Who covers</span>
              {people.filter((p) => p.id !== selected.id && p.kind === "Person").map((p) => {
                const on = handover.to === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setHandover((cur) => (cur ? { ...cur, to: p.id } : cur))}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left", border: `1px solid ${on ? "rgba(96,165,250,.5)" : "rgba(148,163,184,.18)"}`, background: on ? "rgba(96,165,250,.1)" : "transparent" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, flex: "0 0 auto", borderRadius: "50%", fontSize: "9.5px", fontWeight: 800, color: "#0b1524", background: "#60a5fa" }}>{initialsOf(p.name)}</span>
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0" }}>{p.name}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>Until</span>
              <input
                value={handover.until}
                onChange={(e) => setHandover((cur) => (cur ? { ...cur, until: e.target.value } : cur))}
                placeholder="e.g. 22 September"
                data-testid="pv2-own-handover-until"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.55)", color: "#e2e8f0", fontSize: "12.5px", fontFamily: "inherit" }}
              />
              <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5 }}>It expires on that date without anyone remembering to end it.</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8" }}>How much of it</span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {[{ k: "all", l: "Everything they own" }, ...OBJECT_TYPES.map((ty) => ({ k: ty.key, l: ty.label }))].map((sc) => {
                  const on = handover.scope === sc.k;
                  return (
                    <button
                      key={sc.k}
                      onClick={() => setHandover((cur) => (cur ? { ...cur, scope: sc.k } : cur))}
                      style={{ padding: "7px 11px", borderRadius: 7, fontSize: "11px", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${on ? "rgba(96,165,250,.55)" : "rgba(148,163,184,.2)"}`, background: on ? "rgba(96,165,250,.12)" : "transparent", color: on ? "#93c5fd" : "#94a3b8" }}
                    >
                      {sc.l}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ flex: "0 0 auto", padding: "14px 20px", borderTop: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={submitHandover}
              disabled={handoverBlocked(handover.to, handover.until)}
              data-testid="pv2-own-handover-submit"
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: handoverBlocked(handover.to, handover.until) ? "not-allowed" : "pointer", border: `1px solid ${handoverBlocked(handover.to, handover.until) ? "rgba(148,163,184,.18)" : "#0078D4"}`, background: handoverBlocked(handover.to, handover.until) ? "transparent" : "#0078D4", color: handoverBlocked(handover.to, handover.until) ? "#475569" : "#fff" }}
            >
              {handoverSubmitLabel(handover.to, handover.until)}
            </button>
            <button onClick={() => setHandover(null)} style={{ padding: "9px 15px", borderRadius: 7, border: "none", background: "transparent", color: "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </SlideOver>
      )}

      {/* ── Row detail — prototype 486-544 ───────────────────────────────── */}
      {rowOpen &&
        (() => {
          const o = objects.find((x) => x.id === rowOpen);
          if (!o) return null;
          const type = OBJECT_TYPES.find((x) => x.key === o.type);
          const drives = rowDetailDrives(o, objects, overrides, people);
          return (
            <SlideOver accent="rgba(45,212,191,.4)" width="min(680px,97vw)" onClose={() => setRowOpen(null)} overlayAlpha={0.66} shadow="-28px 0 70px rgba(2,6,23,.7)" testId="pv2-own-rowdetail">
              <div style={{ flex: "0 0 auto", padding: "16px 20px", borderBottom: "1px solid rgba(45,212,191,.2)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                  <span style={pill(type?.label ?? "", type?.tone ?? "#94a3b8", `${type?.tone ?? "#94a3b8"}18`)}>{type?.label}</span>
                  <span style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em", lineHeight: 1.3 }}>{o.name}</span>
                  <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.5 }}>{rowSub(o, risks)}</span>
                </div>
                <button onClick={() => setRowOpen(null)} aria-label="Close" style={{ flex: "0 0 auto", width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#94a3b8", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>×</button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                {ROLE_KEYS.map((rk) => {
                  const pid = ownerOf(o, rk.k, overrides);
                  const p = personOf(pid);
                  const acc = p ? acceptanceOf(o.id, rk.k, accOv) : "";
                  const prov = provenanceOf(o.id, rk.k, provOv);
                  const state = acc === "pending" ? "not accepted" : p ? "accepted" : "gap";
                  const stateStyle =
                    acc === "pending"
                      ? pill("not accepted", "#fbbf24", "rgba(251,191,36,.12)")
                      : p
                        ? pill("accepted", "#34d399", "rgba(52,211,153,.1)")
                        : pill("gap", "#f87171", "rgba(248,113,113,.12)");
                  return (
                    <div key={rk.k} style={{ display: "flex", flexDirection: "column", gap: 0, border: `1px solid ${rk.tone}2b`, borderRadius: 11, background: "rgba(2,6,23,.35)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", background: `${rk.tone}14`, borderBottom: `1px solid ${rk.tone}2b` }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: rk.tone, whiteSpace: "nowrap" }}>{rk.label}</span>
                        <span style={stateStyle}>{state}</span>
                        <button
                          onClick={() => {
                            setRowOpen(null);
                            setAssign({ id: o.id, k: rk.k });
                          }}
                          style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8", fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                        >
                          Change
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flex: "0 0 auto", borderRadius: "50%", fontSize: "10px", fontWeight: 800, color: "#0b1524", background: p ? rk.tone : "#475569" }}>{p ? initialsOf(p.name) : "—"}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>{p ? p.name : "Nobody"}</span>
                            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{p ? `${p.role} · ${p.side}` : "Unassigned"}</span>
                          </div>
                          <span style={{ marginLeft: "auto", fontSize: "10px", color: "#475569", whiteSpace: "nowrap" }}>Set by {prov.by} on {prov.at}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {rowRoleDuties(o.type, rk.k).map((d) => (
                            <div key={d} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                              <span style={{ width: 4, height: 4, borderRadius: "50%", flex: "0 0 auto", marginTop: 6, background: rk.tone }} />
                              <span style={{ flex: 1, fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, minWidth: 0, textWrap: "pretty" }}>{d}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {drives.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "13px 14px", border: "1px solid rgba(96,165,250,.24)", borderRadius: 11, background: "rgba(96,165,250,.04)" }}>
                    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#60a5fa" }}>{rowDrivesLabel(o.type)}</span>
                    {drives.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setRowOpen(d.id)}
                        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 128px 132px", gap: 11, alignItems: "center", padding: "9px 11px", border: "1px solid rgba(148,163,184,.14)", borderRadius: 9, background: "rgba(2,6,23,.4)", cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "left" }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                        <span style={{ fontSize: "11px", color: "#93c5fd", whiteSpace: "nowrap" }}>{d.when}</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.own}</span>
                          <span style={{ fontSize: "9.5px", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.inherits}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </SlideOver>
          );
        })()}

      {/* ── Toast — prototype 546-552 ────────────────────────────────────── */}
      {toast && (
        <div
          data-testid="pv2-own-toast"
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 130,
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "12px 17px",
            border: "1px solid rgba(0,120,212,.4)",
            borderRadius: 9,
            background: "#0b1a2e",
            boxShadow: "0 18px 40px rgba(2,6,23,.6)",
            maxWidth: "min(640px,92vw)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", flex: "0 0 auto" }} />
          <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.5 }}>{toast}</span>
          <button onClick={() => setToast("")} style={{ flex: "0 0 auto", border: "none", background: "transparent", color: "#64748b", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>×</button>
        </div>
      )}
    </div>
  );
}

/** Re-exported so a page can seed the sub-nav without importing the fixture. */
export { OBJECT_TYPES, CURRENT_USER };
export type { ObjectTypeKey };
