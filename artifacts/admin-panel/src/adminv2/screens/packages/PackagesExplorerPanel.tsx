/**
 * The Monitoring Packages screen's left (Explorer) panel — the package catalog.
 *
 * Per-screen contextual content, not a global tree (`handoff.md` section 1).
 * This is the only place the open package is chosen, which is why it is here
 * rather than behind a ribbon dropdown: the design's header names one package,
 * and something on screen has to say which others exist.
 *
 * Each row states the two numbers that matter together — linked, and how many
 * of those will actually run — because a package whose checks are archived
 * looks identical to a healthy one until you subtract them.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, LINE, PRIMARY, TEXT } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { currentChecks, getSnapshot, isDirty, selectPackage, subscribe } from "./packagesStore";
import { tallyChecks, type MonitoringPackageRow } from "./packagesTypes";

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "12px 12px 6px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: TEXT.caption,
      }}
    >
      {children}
    </div>
  );
}

export function PackagesExplorerPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const catalog = new Map(state.checks.map((c) => [c.key, c]));

  const active = state.packages.filter((p) => p.status === "active");
  const archived = state.packages.filter((p) => p.status !== "active");

  function Row({ pkg }: { pkg: MonitoringPackageRow }) {
    const tally = tallyChecks(currentChecks(pkg.key, state), catalog);
    const selected = state.selected === pkg.key;
    const dirty = isDirty(pkg.key, state);
    const silent = tally.willRun === 0;
    const { menu, open, close } = useContextMenu();

    return (
      <>
      <button
        className="av2-row"
        onClick={() => selectPackage(pkg.key)}
        onContextMenu={(event) =>
          open(
            event,
            [
              { label: "Open", onSelect: () => selectPackage(pkg.key) },
              { label: "Copy package key", onSelect: () => navigator.clipboard?.writeText(pkg.key) },
              { label: "Copy package name", onSelect: () => navigator.clipboard?.writeText(pkg.label) },
            ],
            `Actions for ${pkg.label}`,
          )
        }
        title={silent ? `${pkg.label} resolves no runnable check — a scan on it collects nothing` : pkg.label}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          width: "100%",
          gap: 2,
          padding: "7px 12px",
          background: selected ? "rgba(15,108,189,.16)" : "transparent",
          border: 0,
          borderLeft: `2px solid ${selected ? PRIMARY : "transparent"}`,
          color: selected ? TEXT.bright : TEXT.body,
          fontFamily: "inherit",
          fontSize: 12.5,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pkg.label}
          </span>
          {dirty && <span style={{ flex: "none", fontSize: 10, fontWeight: 700, color: ACCENT.amber }}>unsaved</span>}
          <span style={{ flex: "none", fontFamily: "Menlo, Consolas, monospace", fontSize: 11, color: silent ? ACCENT.amber : TEXT.meta }}>
            {tally.willRun}/{tally.linked}
          </span>
        </span>
        <span style={{ fontSize: 10.5, color: silent ? ACCENT.amber : TEXT.meta, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {silent ? "runs nothing" : `${tally.willRun} check${tally.willRun === 1 ? "" : "s"} will run`}
        </span>
      </button>
      <ContextMenu menu={menu} onClose={close} />
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 12 }}>
      {state.packages.length === 0 && (
        <div style={{ padding: "14px 12px", fontSize: 11.5, lineHeight: 1.5, color: TEXT.faint, textWrap: "pretty" }}>
          {state.loading ? "Loading…" : state.error ? state.error : "No packages yet."}
        </div>
      )}

      {active.length > 0 && <SectionLabel>Live</SectionLabel>}
      {active.map((pkg) => (
        <Row key={pkg.key} pkg={pkg} />
      ))}

      {archived.length > 0 && <SectionLabel>Archived</SectionLabel>}
      {archived.map((pkg) => (
        <Row key={pkg.key} pkg={pkg} />
      ))}

      {archived.length > 0 && (
        <div style={{ padding: "8px 12px", borderTop: `1px solid ${LINE.subtle}`, fontSize: 10.5, lineHeight: 1.5, color: TEXT.faint, textWrap: "pretty" }}>
          An archived package is kept so old runs still resolve. No scan uses one.
        </div>
      )}

      {state.error && state.packages.length > 0 && (
        <div style={{ padding: "8px 12px", fontSize: 10.5, color: ACCENT_TEXT.danger }}>{state.error}</div>
      )}
    </div>
  );
}
