/**
 * OwnershipMatrix.tsx — the Ownership module.
 *
 * Built from 'Ownership.dc.html' (markup 27-260, logic 556-1269).
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
 * (Ownership.dc.html 702-703):
 *
 *     getPeople() { return this.props.people || this.state.people; }
 *     setPeople(list) { if (this.props.onPeopleChange) this.props.onPeopleChange(list); else this.setState({ people: list }); }
 *
 * ── What Round Two REMOVED from this module ────────────────────────────────
 * The People & roles button and slide-over are gone. Two things confirm it in
 * the artefact rather than only in the changelog: there is no people-editing
 * markup left in the file at all, and `peopleRows` is still COMPUTED at 1032
 * while nothing renders it — dead plumbing left behind by the move.
 *
 * The same is true of `typeNav` (785, returned at 1055, never rendered): the
 * type filter moved up to the shell's own sub-nav, which drives it through the
 * `typeFilter` prop. This component therefore takes `typeFilter` from its
 * caller and renders no type switcher of its own.
 *
 * ── Two dead ends the prototype leaves, and what is done about them ────────
 * `sod`'s "Review" action (873) and `loadWarn`'s "Set cover" action (905) both
 * still call `setState({ peopleOpen: true })` — a state key whose UI no longer
 * exists, so in the prototype they do nothing at all. The README's own rule is
 * "No dead ends. Every button opens a form, gates a CR, or escalates to
 * ShaneBot", and Round Two says where people editing lives now. Both are
 * therefore pointed at Settings → People & roles, which is the destination the
 * changelog itself names. This is the one place the module deviates from the
 * artefact, and it deviates TOWARDS the changelog rather than away from it.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";

import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import {
  CURRENT_USER,
  MATRIX_REVIEW_DUE_DAYS,
  MATRIX_REVIEW_WARN_DAYS,
  MATRIX_REVIEWED_AT,
  OBJECT_TYPES,
  ROLE_KEYS,
  TYPE_SINGULAR,
  type ObjectTypeKey,
  type OwnObject,
  type RoleKey,
} from "@/components/portal-v2/ownershipData";
import {
  acceptanceOf,
  allObjects,
  cellMark,
  cellTitle,
  counterOn,
  counters,
  covMeta,
  coverageRows,
  gapMeta,
  gapRows,
  gapsOf,
  groupedByType,
  loadMeta,
  loadRows,
  loadWarnRows,
  matrixMeta,
  nextPanel,
  noRowsLine,
  ownerOf,
  personCounts,
  reviewLine,
  rowSub,
  shownObjects,
  sodMeta,
  sodRows,
  type OwnerOverrides,
} from "@/components/portal-v2/ownershipModel";
import { OWN_PEOPLE_SEED, type OwnPerson } from "@/components/portal-v2/settingsData";
import { initialsOf } from "@/components/portal-v2/settingsModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** Where people editing lives now — the destination Round Two names. */
const PEOPLE_SETTINGS_HREF = "/portal-v2/settings/people";

/** The matrix row grid — header and every row must agree. Prototype 214. */
const ROW_GRID = "148px repeat(4,minmax(0,1fr))";

/* ── The three cell marks — prototype 190-198 and 236-244 ────────────────── */

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

/** The left-bar row every detail panel uses — prototype 119. */
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

/* ── The legend — prototype 183-199 ──────────────────────────────────────── */

function LegendItem({ tone, mark, label }: { tone: string; mark: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, color: tone }}>
      {mark}
      <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
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
  // The standalone fallback — prototype 702-703. Only ever read when the
  // caller passes no `people`, so the shell-wired page never touches it.
  const [localPeople, setLocalPeople] = useState<readonly OwnPerson[]>(OWN_PEOPLE_SEED);
  const people = peopleProp ?? localPeople;
  const setPeople = onPeopleChange ?? setLocalPeople;

  const [overrides, setOverrides] = useState<OwnerOverrides>({});
  const [acceptedRisks, setAcceptedRisks] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<readonly string[]>([]);
  const [panel, setPanel] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { openForm, formElement } = useFormDrawer();

  const objects = useMemo(() => allObjects(added), [added]);
  const gaps = useMemo(() => gapRows(objects, overrides, acceptedRisks), [objects, overrides, acceptedRisks]);
  const sod = useMemo(() => sodRows(objects, overrides, people), [objects, overrides, people]);
  const warns = useMemo(() => loadWarnRows(objects, overrides, people), [objects, overrides, people]);
  const coverage = useMemo(() => coverageRows(added), [added]);
  const shown = useMemo(
    () => shownObjects(objects, overrides, typeFilter, personId),
    [objects, overrides, typeFilter, personId],
  );
  const groups = useMemo(() => groupedByType(shown, overrides), [shown, overrides]);
  const load = useMemo(() => loadRows(objects, overrides, people, search), [objects, overrides, people, search]);

  const selected = personId ? people.find((p) => p.id === personId) ?? null : null;
  const personName = selected?.name ?? null;

  const counterRow = counters({
    gaps: gaps.length,
    sod: sod.length,
    load: warns.length,
    coverage: coverage.length,
    total: objects.length,
  });

  /**
   * The assign form — prototype 1000-1029 renders this as its own slide-over.
   * Here it is the portal's one form primitive, which is the house rule
   * ("Forms live in the right drawer, never inline") and gives the same
   * choose-then-confirm shape without a second drawer implementation.
   */
  const openAssign = (obj: OwnObject, k: RoleKey) => {
    const role = ROLE_KEYS.find((r) => r.k === k);
    if (!role) return;
    const current = ownerOf(obj, k, overrides);
    const eligible = k === "r" ? people.filter((p) => p.kind === "Person") : people;
    openForm({
      kicker: `${TYPE_SINGULAR[obj.type]} · ${role.label}`,
      title: obj.name,
      intro:
        k === "r"
          ? "Responsible has to be one person, so groups and vendors are not offered here."
          : `${role.def} Changing it records who changed it, and the new name has to accept.`,
      submitLabel: "Set the name",
      fields: [
        {
          id: "who",
          label: role.label,
          kind: "select",
          value: current,
          wide: true,
          required: false,
          options: [{ value: "", label: "Nobody — record it as a gap" }].concat(
            eligible.map((p) => ({ value: p.id, label: `${p.name} · ${p.role}` })),
          ),
        },
        {
          id: "why",
          label: "Why this name",
          kind: "textarea",
          wide: true,
          required: false,
          placeholder: "Recorded against the cell, and shown on hover.",
        },
      ],
      doneNote:
        "Recorded, and the new name has been asked to accept it. Until they do, the cell shows as not accepted.",
      onSubmit: (v) => setOverrides((cur) => ({ ...cur, [`${obj.id}:${k}`]: v.who ?? "" })),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {/* Header — prototype 30-37 */}
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
        <button
          onClick={() =>
            openForm({
              kicker: "Ownership",
              title: "Export the matrix",
              intro:
                "One page per object type, gaps listed first, with the date each name was last changed.",
              submitLabel: "Export it",
              fields: [
                {
                  id: "format",
                  label: "Format",
                  kind: "select",
                  value: "PDF",
                  options: [
                    { value: "PDF", label: "PDF" },
                    { value: "CSV", label: "CSV" },
                  ],
                },
              ],
              doneNote:
                "Matrix exported — one page per object type, gaps listed first, with the date each name was last changed.",
            })
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

      <div style={{ display: "grid", gridTemplateColumns: "228px minmax(0,1fr)", gap: 24, alignItems: "start" }}>
        {/* Load sidebar — prototype 39-70 */}
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
          {/* Selected-person band — prototype 73-104 */}
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
                <span style={{ marginLeft: "auto", fontSize: "11px", color: "#64748b", whiteSpace: "nowrap" }}>
                  Named on {objects.filter((o) => shownObjects([o], overrides, "all", selected.id).length).length} of{" "}
                  {objects.length}
                </span>
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

          {/* ── The five counters ────────────────────────────────────────────
              Round Two: pill-shaped inline buttons became box-shaped cards in
              a FIXED five-column grid so they never wrap, and the labels wrap
              to two lines rather than truncating. Both halves are the
              prototype's own values — the grid at Ownership.dc.html 107, and
              the label's `white-space:normal;text-wrap:pretty` at 919 where a
              pill would have carried `nowrap`. `repeat(5,minmax(0,1fr))` is
              used rather than `repeat(5,1fr)`: they differ when a label is
              long, and only the minmax form actually holds five columns
              instead of letting a wide word push the track out. */}
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
                const t = OBJECT_TYPES.find((x) => x.key === g.typeKey);
                const obj = objects.find((o) => o.id === g.id);
                return (
                  <DetailRow key={g.id} tone="#fbbf24" columns="118px minmax(0,1fr) 152px">
                    <TypeChip tone={t?.tone ?? "#94a3b8"} label={g.type} />
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
                    {/* "Review" has no assign target — it is a roster problem,
                        so it goes where the roster is edited. */}
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
                  {/* Cover is a property of the person, so "Set cover" goes to
                      People & roles, where the deputy chip lives. */}
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
                    onClick={() => setAdded((cur) => cur.concat([m.id]))}
                  />
                </DetailRow>
              ))}
            </DetailPanel>
          )}

          {/* ── The matrix — prototype 178-256 ──────────────────────────── */}
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                <span
                  style={{
                    fontSize: "10.5px",
                    color: MATRIX_REVIEW_DUE_DAYS < MATRIX_REVIEW_WARN_DAYS ? "#fbbf24" : "#64748b",
                    whiteSpace: "nowrap",
                  }}
                >
                  {reviewLine(MATRIX_REVIEWED_AT, MATRIX_REVIEW_DUE_DAYS)}
                </span>
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

            {/* `overflow:visible` and no scroll wrapper — the prototype's own
                value at 202. This is the Round Two "horizontal scroll removed"
                shape: fluid `minmax(0,1fr)` columns and no `overflow-x:auto`. */}
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
                            <div
                              style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}
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
                                {rowSub(o, acceptedRisks)}
                              </span>
                            </div>
                            {ROLE_KEYS.map((rk) => {
                              const pid = ownerOf(o, rk.k, overrides);
                              const p = pid ? people.find((x) => x.id === pid) ?? null : null;
                              const mark = cellMark({ objectId: o.id, k: rk.k, person: p, escDays });
                              const mine = !!personId && pid === personId;
                              const acc = p ? acceptanceOf(o.id, rk.k) : "";
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
                                    escDays,
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

      {formElement}
    </div>
  );
}

/** Re-exported so a page can seed the sub-nav without importing the fixture. */
export { OBJECT_TYPES, CURRENT_USER };
export type { ObjectTypeKey };
