/**
 * Monitoring Packages body — the two-pane check assignment editor.
 *
 * Layout, copy and interaction are the design's `pkgView: "packages"` pane
 * (`Design/adminv2/Admin Shell.dc.html`, markup around line 3614, computed
 * values around line 11078): a header stating which package and whether it is
 * saved, a strip of consequence-first stats, then available checks on the left
 * and what is in the package on the right, each with its own search.
 *
 * Clicking a row toggles it. Nothing is written until Save — see
 * `packagesStore.ts` on why assignment stages rather than writing through.
 *
 * The design's two other sub-views ("Checks" and "Pillar matrix") are
 * deliberately not here. The Checks view is the monitor-check editor, which is
 * the M365 Endpoints screen's record, and the Pillar matrix edits
 * `signal_rules` impact weights — a different table, a different screen, and
 * building either from here would put two editors on one row of the database.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  addChecks,
  clearFilters,
  currentChecks,
  filtersActive,
  getSnapshot,
  isDirty,
  removeAllChecks,
  revert,
  saveChecks,
  setAvailQuery,
  setDomain,
  setInQuery,
  subscribe,
  toggleCheck,
  toggleFacet,
  type PackagesStoreState,
} from "./packagesStore";
import {
  checkDomain,
  checkMatches,
  domainsOf,
  lastRunNote,
  overlapsWith,
  packagesUsing,
  scriptNote,
  tallyChecks,
  whenShort,
  type MonitorCheckRow,
} from "./packagesTypes";

/** The rows each pane shows, and the numbers the header states about them. */
function derive(state: PackagesStoreState) {
  const key = state.selected;
  const pkg = state.packages.find((p) => p.key === key) ?? null;
  const assigned = currentChecks(key, state);
  const assignedSet = new Set(assigned);
  const catalog = new Map(state.checks.map((c) => [c.key, c]));

  const packaged = new Set<string>();
  for (const keys of Object.values(state.checksByPackage)) for (const k of keys) packaged.add(k);

  const available = state.checks.filter((c) => {
    if (assignedSet.has(c.key)) return false;
    // Archived checks are hidden by default: adding one links a row that
    // `loadOrderedPackageChecks` will filter straight back out.
    if (c.status !== "active" && !state.showArchived) return false;
    if (!checkMatches(c, state.availQuery)) return false;
    if (state.domain !== "All" && checkDomain(c.key) !== state.domain) return false;
    if (state.onlyNeedsScript && !c.requiresCustomerScript) return false;
    if (state.onlyUnpackaged && packaged.has(c.key)) return false;
    return true;
  });

  const inPackage = assigned
    .map((k) => catalog.get(k) ?? null)
    .filter((c): c is MonitorCheckRow => c !== null)
    .filter((c) => checkMatches(c, state.inQuery));

  // A junction row pointing at a key the catalog no longer has. It cannot
  // render as a check because there is no check — but hiding it would make an
  // unremovable row invisible, so it gets its own list.
  const orphans = assigned.filter((k) => !catalog.has(k));

  return {
    key,
    pkg,
    assigned,
    available,
    inPackage,
    orphans,
    catalog,
    packaged,
    tally: tallyChecks(assigned, catalog),
    dirty: isDirty(key, state),
  };
}

export function PackagesBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const d = derive(state);

  if (state.loading && state.packages.length === 0) {
    return <Notice>Loading the package catalog…</Notice>;
  }
  if (state.error && state.packages.length === 0) {
    return <Notice tone={ACCENT_TEXT.danger}>{state.error}</Notice>;
  }
  if (!d.pkg) {
    return (
      <Notice>
        There are no monitoring packages yet. Create one from the Home tab — it runs nothing until you add checks.
      </Notice>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} d={d} />
      <Stats state={state} d={d} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        <AvailablePane state={state} d={d} />
        <AssignedPane state={state} d={d} />
      </div>
    </div>
  );
}

type Derived = ReturnType<typeof derive>;

function Notice({ children, tone }: { children: string; tone?: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: SURFACE.app }}>
      <span style={{ maxWidth: 460, padding: "0 24px", fontSize: 12.5, lineHeight: 1.6, textAlign: "center", color: tone ?? TEXT.faint }}>
        {children}
      </span>
    </div>
  );
}

function Pill({ label, tone, border }: { label: string; tone: string; border: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 8px",
        borderRadius: 9,
        border: `1px solid ${border}`,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        color: tone,
      }}
    >
      {label}
    </span>
  );
}

function Header({ state, d }: { state: PackagesStoreState; d: Derived }) {
  const pkg = d.pkg!;
  const active = pkg.status === "active";
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{pkg.label}</span>
      <span style={{ fontFamily: "Menlo, Consolas, monospace", fontSize: 11, color: TEXT.caption }}>{pkg.key}</span>
      <Pill
        label={pkg.status}
        tone={active ? ACCENT_TEXT.green : TEXT.groupLabel}
        border={active ? "rgba(108,203,150,.34)" : LINE.control}
      />
      <Pill
        label={d.dirty ? "unsaved" : "saved"}
        tone={d.dirty ? ACCENT.amber : TEXT.groupLabel}
        border={d.dirty ? "rgba(233,185,73,.34)" : LINE.control}
      />
      <div style={{ flex: 1, minWidth: 4 }} />
      {state.message && (
        <span style={{ fontSize: 11.5, color: ACCENT_TEXT.green, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.message}
        </span>
      )}
      {d.dirty && (
        <button
          className="av2-ghost"
          onClick={revert}
          style={{
            flex: "none",
            padding: "5px 11px",
            borderRadius: 5,
            border: `1px solid ${LINE.strong}`,
            background: "transparent",
            color: TEXT.dim,
            fontFamily: "inherit",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Revert
        </button>
      )}
      <button
        onClick={() => void saveChecks()}
        disabled={!d.dirty || state.saving}
        title={d.dirty ? "Replaces this package's whole check list" : "Nothing has changed since the last save"}
        style={{
          flex: "none",
          padding: "5px 13px",
          borderRadius: 5,
          border: 0,
          background: d.dirty ? PRIMARY : SURFACE.wellHover,
          color: d.dirty ? "#fff" : TEXT.faintest,
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 600,
          cursor: d.dirty ? "pointer" : "default",
        }}
      >
        {state.saving ? "Saving…" : d.dirty ? "Save the check list" : "Saved"}
      </button>
    </div>
  );
}

function StatCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div
      style={{
        flex: "1 1 190px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "9px 12px",
        borderRadius: 6,
        border: `1px solid ${LINE.base}`,
        background: SURFACE.app,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: TEXT.meta }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: tone ?? TEXT.strong, textWrap: "pretty" }}>{value}</span>
      <span style={{ fontSize: 11, lineHeight: 1.45, color: TEXT.groupLabel, textWrap: "pretty" }}>{note}</span>
    </div>
  );
}

function Stats({ state, d }: { state: PackagesStoreState; d: Derived }) {
  const pkg = d.pkg!;
  const usage = state.usage[pkg.key];
  const overlaps = overlapsWith(pkg.key, d.assigned, state.checksByPackage, state.packages);
  const t = d.tally;

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "stretch",
        gap: 9,
        flexWrap: "wrap",
        padding: "11px 16px",
        borderBottom: `1px solid ${LINE.quiet}`,
      }}
    >
      <StatCard
        label="What will actually run"
        value={`${t.willRun} of ${t.linked} linked`}
        note={
          t.dead > 0
            ? `${t.dead} linked ${t.dead === 1 ? "check is" : "checks are"} archived or gone — a scan skips them silently`
            : t.linked === 0
              ? "nothing is linked, so a scan on this package collects nothing"
              : "every linked check resolves"
        }
        tone={t.dead > 0 || t.linked === 0 ? ACCENT.amber : TEXT.strong}
      />
      <StatCard
        label="Runs against"
        value={usage ? `${usage.tenants} tenant${usage.tenants === 1 ? "" : "s"}` : "no tenant yet"}
        note={
          usage
            ? `${usage.runs} run${usage.runs === 1 ? "" : "s"} on record${pkg.status === "active" ? "" : " · archived, so nothing schedules it now"}`
            : "no scan has ever resolved this package"
        }
      />
      <StatCard
        label="Shares checks with"
        value={overlaps.length ? overlaps.map((o) => `${o.label} (${o.shared})`).join(", ") : "nothing else"}
        note={
          overlaps.length
            ? "editing one of those checks changes what they find too"
            : "changes here affect only this package"
        }
      />
      <StatCard
        label="Last run"
        value={whenShort(usage?.lastRunAt)}
        note={lastRunNote(usage)}
      />
    </div>
  );
}

function Chip({ label, on, onClick, tone }: { label: string; on: boolean; onClick: () => void; tone?: string }) {
  const colour = tone ?? "rgba(255,255,255,.5)";
  return (
    <button
      onClick={onClick}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "3px 9px",
        borderRadius: 11,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
        border: `1px solid ${on ? colour : LINE.control}`,
        background: on ? (tone ? "rgba(233,185,73,.12)" : "rgba(255,255,255,.16)") : "transparent",
        color: on ? (tone ? ACCENT.amber : TEXT.strong) : TEXT.caption,
      }}
    >
      {label}
    </button>
  );
}

function SmallButton({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      className="av2-ghost"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "3px 10px",
        borderRadius: 4,
        border: `1px solid ${LINE.strong}`,
        background: "transparent",
        color: disabled ? TEXT.faintest : TEXT.quiet,
        fontFamily: "inherit",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function SearchInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: 29,
        padding: "0 10px",
        borderRadius: 5,
        border: `1px solid ${LINE.control}`,
        background: SURFACE.chrome,
        color: TEXT.strong,
        outline: "none",
        fontFamily: "inherit",
        fontSize: 12.5,
      }}
    />
  );
}

function Tag({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".04em",
        padding: "1px 6px",
        borderRadius: 9,
        border: `1px solid ${LINE.control}`,
        color: tone,
      }}
    >
      {label}
    </span>
  );
}

/**
 * One check row, in either pane.
 *
 * The tags are the design's, re-pointed at columns that exist: what stops this
 * check running (archived), what it needs beyond Graph consent (a customer
 * script, a non-Graph executor), and whether anything else already runs it.
 */
function CheckRow({
  check,
  inPackage,
  state,
  selectedKey,
}: {
  check: MonitorCheckRow;
  inPackage: boolean;
  state: PackagesStoreState;
  selectedKey: string;
}) {
  const others = packagesUsing(check.key, selectedKey, state.checksByPackage);
  const tags: Array<{ label: string; tone: string }> = [];
  if (check.status !== "active") tags.push({ label: "archived — will not run", tone: ACCENT.amber });
  if (check.requiresCustomerScript) tags.push({ label: "needs script", tone: ACCENT.amber });
  if (check.executorType !== "graph") tags.push({ label: check.executorType, tone: ACCENT.info });
  if (check.fanOutSource) tags.push({ label: "fan-out", tone: TEXT.groupLabel });
  if (!inPackage && others.length === 0) tags.push({ label: "in no package", tone: TEXT.groupLabel });
  if (!inPackage && others.length > 0) tags.push({ label: `${others.length} other${others.length === 1 ? "" : "s"}`, tone: TEXT.groupLabel });
  if (inPackage && others.length > 0) tags.push({ label: `shared with ${others.length}`, tone: TEXT.groupLabel });

  return (
    <div
      className="av2-row"
      role="button"
      tabIndex={0}
      onClick={() => toggleCheck(check.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCheck(check.key);
        }
      }}
      title={inPackage ? `Remove ${check.label} from this package` : `Add ${check.label} to this package`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "7px 11px",
        cursor: "pointer",
        borderBottom: `1px solid ${LINE.subtle}`,
      }}
    >
      <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 13, lineHeight: 1, color: inPackage ? ACCENT_TEXT.danger : ACCENT_TEXT.green }}>
        {inPackage ? "−" : "+"}
      </span>
      <span style={{ flex: "1 1 210px", minWidth: 0, fontSize: 12.5, color: TEXT.strong, textWrap: "pretty" }}>{check.label}</span>
      <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.caption }}>{checkDomain(check.key)}</span>
      <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.caption }}>{check.frequency}</span>
      {tags.map((t) => (
        <Tag key={t.label} label={t.label} tone={t.tone} />
      ))}
      <span style={{ flex: "1 1 100%", minWidth: 0, fontFamily: "Menlo, Consolas, monospace", fontSize: 10.5, color: TEXT.faintest }}>
        {check.key}
      </span>
    </div>
  );
}

function PaneEmpty({ children }: { children: string }) {
  return (
    <div style={{ padding: "14px 12px", fontSize: 11.5, lineHeight: 1.5, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>
  );
}

function AvailablePane({ state, d }: { state: PackagesStoreState; d: Derived }) {
  const domains = ["All", ...domainsOf(state.checks)];
  const activeTotal = state.checks.filter((c) => c.status === "active" || state.showArchived).length;

  return (
    <div style={{ flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${LINE.quiet}` }}>
      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <SearchInput
          value={state.availQuery}
          placeholder="Search every check by name, key or domain"
          onChange={setAvailQuery}
        />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {domains.map((dom) => (
            <Chip key={dom} label={dom} on={state.domain === dom} onClick={() => setDomain(dom)} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <Chip label="Needs the customer script" on={state.onlyNeedsScript} onClick={() => toggleFacet("onlyNeedsScript")} tone="rgba(233,185,73,.45)" />
          <Chip label="In no package anywhere" on={state.onlyUnpackaged} onClick={() => toggleFacet("onlyUnpackaged")} tone="rgba(233,185,73,.45)" />
          <Chip label="Show archived checks" on={state.showArchived} onClick={() => toggleFacet("showArchived")} tone="rgba(233,185,73,.45)" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 60, fontSize: 11, color: TEXT.groupLabel }}>
            {d.available.length} of {activeTotal} checks
          </span>
          {filtersActive(state) && <SmallButton label="Clear filters" onClick={clearFilters} />}
          <SmallButton
            label={`Add all ${d.available.length}`}
            disabled={d.available.length === 0}
            title="Stages every check listed here — still nothing is written until you save"
            onClick={() => addChecks(d.available.map((c) => c.key))}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {d.available.map((check) => (
          <CheckRow key={check.key} check={check} inPackage={false} state={state} selectedKey={d.key!} />
        ))}
        {d.available.length === 0 && <PaneEmpty>Nothing matches. Clear a filter or search something else.</PaneEmpty>}
      </div>
    </div>
  );
}

function AssignedPane({ state, d }: { state: PackagesStoreState; d: Derived }) {
  return (
    <div style={{ flex: "1 1 50%", minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderBottom: `1px solid ${LINE.subtle}` }}>
        <SearchInput value={state.inQuery} placeholder="Search what is already in this package" onChange={setInQuery} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 60, fontSize: 11, color: TEXT.groupLabel }}>
            {d.assigned.length} in this package · {d.tally.willRun} will run
          </span>
          <SmallButton label="Remove all" disabled={d.assigned.length === 0} onClick={removeAllChecks} />
        </div>
        <span style={{ fontSize: 11, lineHeight: 1.45, color: TEXT.groupLabel, textWrap: "pretty" }}>{scriptNote(d.tally)}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {d.orphans.map((key) => (
          <div
            key={key}
            className="av2-row"
            role="button"
            tabIndex={0}
            onClick={() => toggleCheck(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleCheck(key);
              }
            }}
            title="Remove this dangling assignment"
            style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "7px 11px", cursor: "pointer", borderBottom: `1px solid ${LINE.subtle}` }}
          >
            <span style={{ flex: "none", fontSize: 13, lineHeight: 1, color: ACCENT_TEXT.danger }}>−</span>
            <span style={{ flex: "1 1 210px", minWidth: 0, fontFamily: "Menlo, Consolas, monospace", fontSize: 12, color: TEXT.strong }}>{key}</span>
            <Tag label="no such check" tone={ACCENT_TEXT.danger} />
            <span style={{ flex: "1 1 100%", minWidth: 0, fontSize: 11, color: TEXT.faint }}>
              The catalog has no check with this key, so it collects nothing. Removing it is safe.
            </span>
          </div>
        ))}
        {d.inPackage.map((check) => (
          <CheckRow key={check.key} check={check} inPackage state={state} selectedKey={d.key!} />
        ))}
        {d.inPackage.length === 0 && d.orphans.length === 0 && (
          <PaneEmpty>
            {state.inQuery
              ? "Nothing in this package matches. Clear the search to see all of it."
              : "Nothing assigned yet. Add checks from the left — until you do, a scan on this package collects nothing."}
          </PaneEmpty>
        )}
      </div>
    </div>
  );
}
