import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, ChevronRight } from "lucide-react";

import { useRunbooks } from "@/components/holds/useRunbooks";
import {
  useSops,
  type SopLibraryItem,
  type SopMeta,
  type SopQueueItem,
  type SopSource,
} from "@/components/sops/useSops";
import {
  PanelCta,
  PanelInput,
  PanelKVRow,
  PanelNote,
  PanelStepRow,
  PanelTextarea,
  SlidePanel,
} from "@/components/shell/SlidePanel";

const HAIRLINE = "rgba(255,255,255,.09)";

/**
 * SOPs & Runbooks — Library / Queue / History (#2994, carried forward from
 * #1730/#1493). Design: `Design/portal/design_handoff_full_site/screens/SOPs.dc.html`
 * (`view: "sops"`), contract: `.../docs/portal/sops-contract-pack.md`.
 *
 * Every row on this page comes from `GET /api/portal/sops` and
 * `GET /api/portal/sop-runs` (`useSops`) — both real, both previously
 * orphaned from any page (contract pack §0.1). The one cross-module read is
 * the hold-window summary from `GET /api/portal/runbooks` (`useRunbooks`,
 * shared with the Runbooks page), used only for the banner that links across
 * to that page — the same summary already drives that page's own badge.
 *
 * No execution starts from this page. Authoring a new procedure and adding a
 * step to an existing one are the only writes here (contract pack §1.3/§1.4);
 * everything else is read-only, matching the backend's own "no execution
 * write in this file" rule.
 */
export default function SopsPage() {
  const [, navigate] = useLocation();
  const { sops, runs, loading, loaded, error, tierGated, createSop, addCustomStep } = useSops();
  const { payload: runbooksPayload } = useRunbooks();

  const [tab, setTab] = useState<"lib" | "queue" | "hist">("lib");
  const [srcFilter, setSrcFilter] = useState<"all" | SopSource>("all");
  const [catFilter, setCatFilter] = useState("All");
  const [search, setSearch] = useState("");

  type Panel =
    | { readonly kind: "sop"; readonly sop: SopLibraryItem }
    | { readonly kind: "addCustomStep"; readonly sop: SopLibraryItem }
    | { readonly kind: "queue"; readonly item: SopQueueItem }
    | { readonly kind: "newProc" };
  const [panel, setPanel] = useState<Panel | null>(null);

  const meta = sops?.meta ?? {};
  const library = sops?.library ?? [];
  const queue = runs?.queue ?? [];
  const audit = runs?.audit ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter((p) => {
      if (srcFilter !== "all" && p.source !== srcFilter) return false;
      if (catFilter !== "All" && p.category !== catFilter) return false;
      if (q && !p.title.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, srcFilter, catFilter, search]);

  const categories = useMemo(() => {
    const out: string[] = [];
    for (const p of library) if (!out.includes(p.category)) out.push(p.category);
    return out;
  }, [library]);

  const groups = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, rows: filtered.filter((p) => p.category === c) }))
        .filter((g) => g.rows.length > 0),
    [categories, filtered],
  );

  const ratio = sops && sops.stats.totalCount ? Math.round((sops.stats.automatedCount / sops.stats.totalCount) * 100) : 0;

  const summary = runbooksPayload?.summary ?? null;
  const hasBanner = !!summary && summary.openCount > 0;
  const bannerTone = summary && summary.due > 0 ? "#f87171" : "#34d399";
  const bannerBorder = summary && summary.due > 0 ? "rgba(248,113,113,.35)" : "rgba(52,211,153,.35)";
  const bannerBg = summary && summary.due > 0 ? "rgba(248,113,113,.06)" : "rgba(52,211,153,.06)";

  if (loading && !loaded) {
    return (
      <div className="flex flex-col gap-[16px]" style={{ padding: "24px 30px 48px" }}>
        <Header title="SOPs & Runbooks" hint="Loading your procedure library…" />
        <div className="flex flex-col gap-[10px]">
          {["34%", "26%", "42%"].map((w, i) => (
            <div
              key={i}
              className="flex flex-col gap-[9px] rounded-[14px] border"
              style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)", padding: 16 }}
            >
              <div className="h-[10px] rounded-full" style={{ width: w, background: "rgba(255,255,255,.07)" }} />
              <div className="h-[9px] w-[70%] rounded-full" style={{ background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tierGated) {
    return (
      <div className="flex flex-col gap-[16px]" style={{ padding: "24px 30px 48px" }}>
        <Header title="SOPs & Runbooks" hint="Procedures your MSP maintains and runs against your tenant." />
        <EmptyPanel
          title="Not included in your plan"
          body="SOPs & Runbooks is not part of your current Monitoring tier. Ask your MSP about upgrading to see your procedure library."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-[16px]" style={{ padding: "24px 30px 48px" }}>
        <Header title="SOPs & Runbooks" hint="Procedures your MSP maintains and runs against your tenant." />
        <EmptyPanel title="Could not load" body={error} />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1" data-testid="sops-page">
      <div
        className="flex flex-1 flex-col gap-[16px] overflow-y-auto"
        style={{ padding: "24px 30px 48px", minWidth: 0 }}
      >
        <div className="flex flex-wrap items-center gap-[12px]">
          <Header
            title="SOPs & Runbooks"
            hint="Procedures your MSP maintains and runs against your tenant. Nothing executes from this page."
          />
          <button
            type="button"
            onClick={() => setPanel({ kind: "newProc" })}
            data-testid="sops-new-procedure"
            className="ml-auto rounded-md text-[12px] font-semibold text-white"
            style={{ background: "#0078D4", padding: "7px 16px" }}
          >
            New procedure
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <StatCard
            label="PROCEDURES IN YOUR LIBRARY"
            value={String(sops?.stats.totalCount ?? 0)}
            sub={
              sops && sops.stats.totalCount
                ? `${sops.stats.baselineCount} from your MSP · ${sops.stats.oursCount} yours`
                : "—"
            }
            color="#60a5fa"
          />
          <StatCard
            label="CAN RUN THROUGH GRAPH"
            value={`${ratio}%`}
            sub={`${sops?.stats.automatedCount ?? 0} of ${sops?.stats.totalCount ?? 0} · counted from the procedure's own steps only`}
            color="#34d399"
          />
          <StatCard
            label="RUN AGAINST YOUR TENANT"
            value={String(queue.length)}
            sub={queue.length === 0 ? "No procedure has been run here yet" : `${queue.length} in flight now`}
            color="#22d3ee"
          />
          <StatCard
            label="AVERAGE RUN TIME"
            value={sops?.stats.avgExecTime ?? "—"}
            sub={
              !sops || sops.stats.avgExecTime === "—"
                ? "Nothing has completed, so there is no average"
                : "Across completed runs"
            }
            color="#a78bfa"
          />
        </div>

        {hasBanner && summary ? (
          <div
            onClick={() => navigate("/runbooks")}
            className="flex cursor-pointer items-center gap-[10px] rounded-[10px] border hover:opacity-90"
            style={{ borderColor: bannerBorder, background: bannerBg, padding: "10px 14px" }}
            data-testid="sops-holds-banner"
          >
            <span
              className="flex-none rounded-full text-[9.5px] font-bold"
              style={{ color: bannerTone, border: `1px solid ${bannerBorder}`, letterSpacing: ".1em", padding: "2px 9px" }}
            >
              {summary.due > 0 ? `${summary.due} DECISION DUE` : "CAN CLOSE EARLY"}
            </span>
            <span className="min-w-0 text-[12px]" style={{ color: "#cbd5e1" }}>
              {summary.openCount} procedure{summary.openCount === 1 ? "" : "s"} in a hold window — a step that
              waits on elapsed time rather than on work. {summary.text}.
            </span>
            <ChevronRight size={13} color="#64748b" className="ml-auto flex-none" />
          </div>
        ) : null}

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-[6px]">
          {(
            [
              { k: "lib", label: "Library" },
              { k: "queue", label: `Queue${queue.length ? ` · ${queue.length}` : ""}` },
              { k: "hist", label: "History" },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              data-testid={`sops-tab-${t.k}`}
              className="rounded-full text-[12px] font-semibold"
              style={{
                color: tab === t.k ? "#f8fafc" : "#64748b",
                background: tab === t.k ? "rgba(255,255,255,.07)" : "transparent",
                padding: "5px 14px",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "lib" ? (
          <LibraryTab
            search={search}
            setSearch={setSearch}
            srcFilter={srcFilter}
            setSrcFilter={setSrcFilter}
            catFilter={catFilter}
            setCatFilter={setCatFilter}
            library={library}
            meta={meta}
            categories={categories}
            groups={groups}
            onOpen={(sop) => setPanel({ kind: "sop", sop })}
          />
        ) : null}

        {tab === "queue" ? (
          <QueueTab queue={queue} onOpen={(item) => setPanel({ kind: "queue", item })} />
        ) : null}

        {tab === "hist" ? <HistoryTab audit={audit} totalExecs={sops?.stats.totalExecs ?? 0} /> : null}
      </div>

      {panel?.kind === "sop" ? (
        <SopDetailPanel
          sop={panel.sop}
          meta={meta[panel.sop.id]}
          onClose={() => setPanel(null)}
          onAddStep={() => setPanel({ kind: "addCustomStep", sop: panel.sop })}
        />
      ) : null}
      {panel?.kind === "addCustomStep" ? (
        <AddCustomStepPanel
          sop={panel.sop}
          onClose={() => setPanel(null)}
          onSave={addCustomStep}
        />
      ) : null}
      {panel?.kind === "queue" ? <QueueDetailPanel item={panel.item} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === "newProc" ? (
        <NewProcedurePanel onClose={() => setPanel(null)} onCreate={createSop} />
      ) : null}
    </div>
  );
}

function Header({ title, hint }: { readonly title: string; readonly hint: string }) {
  return (
    <div className="flex items-center gap-[12px]">
      <span className="text-[20px] font-bold" style={{ color: "#f8fafc", letterSpacing: "-.01em" }}>
        {title}
      </span>
      <span
        title={hint}
        className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold"
        style={{ border: "1px solid rgba(148,163,184,.35)", color: "#64748b" }}
      >
        i
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="flex flex-col gap-[4px] rounded-[14px] border"
      style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "13px 16px 14px" }}
    >
      <span className="text-[10px] font-bold" style={{ color: "#475569", letterSpacing: ".1em" }}>
        {label}
      </span>
      <span className="text-[22px] font-extrabold" style={{ color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <span className="text-[11px]" style={{ color: "#64748b" }}>
        {sub}
      </span>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col items-center gap-[5px] rounded-[12px] border border-dashed text-center"
      style={{ borderColor: "rgba(148,163,184,.25)", padding: 26 }}
    >
      <span className="text-[12.5px] font-semibold" style={{ color: "#cbd5e1" }}>
        {title}
      </span>
      <span className="max-w-[520px] text-[11.5px] leading-[1.55]" style={{ color: "#64748b" }}>
        {body}
      </span>
    </div>
  );
}

// ── Library tab ────────────────────────────────────────────────────────────

function LibraryTab({
  search,
  setSearch,
  srcFilter,
  setSrcFilter,
  catFilter,
  setCatFilter,
  library,
  meta,
  categories,
  groups,
  onOpen,
}: {
  readonly search: string;
  readonly setSearch: (v: string) => void;
  readonly srcFilter: "all" | SopSource;
  readonly setSrcFilter: (v: "all" | SopSource) => void;
  readonly catFilter: string;
  readonly setCatFilter: (v: string) => void;
  readonly library: readonly SopLibraryItem[];
  readonly meta: Readonly<Record<string, SopMeta>>;
  readonly categories: readonly string[];
  readonly groups: readonly { readonly category: string; readonly rows: readonly SopLibraryItem[] }[];
  readonly onOpen: (sop: SopLibraryItem) => void;
}) {
  const srcOptions: readonly { k: "all" | SopSource; label: string }[] = [
    { k: "all", label: "All" },
    { k: "baseline", label: "Baseline" },
    { k: "ours", label: "Yours" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-[8px]">
        <div
          className="flex min-w-[200px] items-center gap-[7px] rounded-md border"
          style={{ borderColor: "rgba(255,255,255,.10)", background: "rgba(255,255,255,.03)", padding: "7px 12px" }}
        >
          <Search size={13} color="#475569" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search procedures"
            data-testid="sops-search"
            className="w-full bg-transparent text-[12px] outline-none"
            style={{ color: "#e2e8f0" }}
          />
        </div>
        <div className="flex overflow-hidden rounded-md border" style={{ borderColor: "rgba(255,255,255,.10)" }}>
          {srcOptions.map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setSrcFilter(o.k)}
              data-testid={`sops-src-${o.k}`}
              className="whitespace-nowrap text-[11.5px] font-semibold"
              style={{
                color: srcFilter === o.k ? "#f8fafc" : "#64748b",
                background: srcFilter === o.k ? "rgba(0,120,212,.25)" : "transparent",
                padding: "6px 13px",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-[6px]">
          <CategoryChip label="Everything" n={library.length} active={catFilter === "All"} onClick={() => setCatFilter("All")} />
          {categories.map((c) => (
            <CategoryChip
              key={c}
              label={c.charAt(0) + c.slice(1).toLowerCase()}
              n={library.filter((p) => p.category === c).length}
              active={catFilter === c}
              onClick={() => setCatFilter(c)}
            />
          ))}
        </div>
      </div>

      {library.length === 0 ? (
        <EmptyPanel title="No procedures yet" body="Your MSP's baseline library appears after onboarding." />
      ) : groups.length === 0 ? (
        <EmptyPanel title="No procedures match" body="Try a different search, source or category." />
      ) : (
        <div className="flex flex-col gap-[14px]">
          {groups.map((g) => (
            <div
              key={g.category}
              className="rounded-[14px] border"
              style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "5px 18px 8px" }}
            >
              <span
                className="block text-[9.5px] font-bold"
                style={{ color: "#475569", letterSpacing: ".13em", padding: "11px 0 5px" }}
              >
                {g.category} · {g.rows.length}
              </span>
              {g.category === "LIFECYCLE" ? (
                <span className="block max-w-[620px] text-[11px] leading-[1.5]" style={{ color: "#64748b", padding: "0 0 7px" }}>
                  These four exist as procedures your MSP can run by hand. Nothing in the portal fires them
                  automatically from a decision made elsewhere yet.
                </span>
              ) : g.category === "YOUR PROCEDURES" ? (
                <span className="block max-w-[620px] text-[11px] leading-[1.5]" style={{ color: "#64748b", padding: "0 0 7px" }}>
                  Written by your team. These stay reference-only — an authored procedure never gains an
                  automated step.
                </span>
              ) : null}
              {g.rows.map((r) => (
                <div
                  key={r.id}
                  onClick={() => onOpen(r)}
                  data-testid={`sops-row-${r.id}`}
                  className="flex cursor-pointer items-center gap-[11px] hover:opacity-85"
                  style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}
                >
                  <span
                    title={r.source === "baseline" ? "Maintained by your MSP" : "Written by your team"}
                    className="size-[7px] flex-none rounded-full"
                    style={{ background: r.source === "baseline" ? "#60a5fa" : "#22d3ee" }}
                  />
                  <span className="w-[96px] flex-none text-[11px]" style={{ color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace" }}>
                    {meta[r.id]?.code ?? r.id}
                  </span>
                  <span className="min-w-0 text-[12.5px] font-semibold" style={{ color: "#e2e8f0" }}>
                    {r.title}
                  </span>
                  {r.runnable ? (
                    <span
                      title="Has automated steps your MSP can run through Graph"
                      className="flex-none rounded-full text-[9px] font-bold"
                      style={{ color: "#22d3ee", border: "1px solid rgba(34,211,238,.35)", letterSpacing: ".08em", padding: "2px 7px" }}
                    >
                      GRAPH
                    </span>
                  ) : null}
                  {r.steps.some((s) => s.isCustom) ? (
                    <span
                      title="Steps your team added to this procedure"
                      className="flex-none rounded-full text-[9px] font-bold"
                      style={{ color: "#94a3b8", border: "1px solid rgba(148,163,184,.3)", letterSpacing: ".08em", padding: "2px 7px" }}
                    >
                      +{r.steps.filter((s) => s.isCustom).length} YOURS
                    </span>
                  ) : null}
                  <span className="ml-auto flex-none text-[11px]" style={{ color: "#64748b" }}>
                    {meta[r.id]?.level ?? "—"}
                  </span>
                  <span
                    title={`Last updated by ${r.author}`}
                    className="flex size-[22px] flex-none items-center justify-center rounded-full border text-[8.5px] font-bold"
                    style={{ background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}
                  >
                    {r.owner.init}
                  </span>
                  <ChevronRight size={13} color="#334155" className="flex-none" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CategoryChip({ label, n, active, onClick }: { label: string; n: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded-full border text-[11.5px] font-semibold"
      style={{
        color: active ? "#f8fafc" : "#64748b",
        borderColor: active ? "rgba(0,180,216,.45)" : "rgba(255,255,255,.10)",
        background: active ? "rgba(0,180,216,.08)" : "transparent",
        padding: "5px 12px",
      }}
    >
      {label} · {n}
    </button>
  );
}

// ── Queue tab ──────────────────────────────────────────────────────────────

const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  policy: "From a standing policy",
  lifecycle: "From a lifecycle event",
  remediation: "From remediation",
  manual: "Started by hand",
};

function QueueTab({ queue, onOpen }: { readonly queue: readonly SopQueueItem[]; readonly onOpen: (item: SopQueueItem) => void }) {
  if (queue.length === 0) {
    return (
      <EmptyPanel
        title="Nothing running or queued"
        body="No procedure has ever been run against your tenant. When your MSP runs one — by hand, from a standing policy, from a lifecycle event or from a remediation item — it appears here live, with which of those started it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-[10px]">
      {queue.map((q) => {
        const running = q.state === "Running";
        return (
          <div
            key={q.code}
            onClick={() => onOpen(q)}
            data-testid={`sops-queue-${q.code}`}
            className="cursor-pointer rounded-[14px] border hover:border-white/[.16]"
            style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "13px 18px 14px" }}
          >
            <div className="flex flex-wrap items-center gap-[10px]">
              <span
                className="flex-none rounded-full text-[10px] font-semibold"
                style={{
                  color: running ? "#00B4D8" : "#94a3b8",
                  border: `1px solid ${running ? "rgba(0,180,216,.45)" : "rgba(148,163,184,.35)"}`,
                  background: running ? "rgba(0,180,216,.10)" : "transparent",
                  padding: "2px 9px",
                }}
              >
                {q.state}
              </span>
              <span className="text-[11px]" style={{ color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace" }}>
                {q.code}
              </span>
              <span className="text-[12.5px] font-semibold" style={{ color: "#e2e8f0" }}>
                {q.title}
              </span>
              <span className="ml-auto text-[11px]" style={{ color: "#64748b" }}>
                {q.started}
              </span>
            </div>
            <div className="mt-[9px] flex items-center gap-[10px]">
              <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${q.pct}%`, background: "linear-gradient(90deg,#0078D4,#00B4D8)" }} />
              </div>
              <span className="flex-none text-[11px] font-bold" style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                {q.pct}%
              </span>
            </div>
            <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
              <span className="text-[11.5px]" style={{ color: "#94a3b8" }}>
                {q.step}
              </span>
              <Chip className="ml-auto">{ORIGIN_LABEL[q.origin] ?? q.origin}</Chip>
              <Chip>Ran against {q.sopVersion || "an unrecorded version"}</Chip>
              <Chip>{q.mode}</Chip>
              <Chip color={/^CR-/.test(q.cr) ? "#60a5fa" : undefined}>CR · {q.cr}</Chip>
              <Chip>{q.svc}</Chip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chip({ children, className, color }: { children: React.ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={`flex-none rounded-full text-[10px] ${className ?? ""}`}
      style={{ color: color ?? "#64748b", border: "1px solid rgba(255,255,255,.10)", padding: "2px 8px" }}
    >
      {children}
    </span>
  );
}

// ── History tab ────────────────────────────────────────────────────────────

const RESULT_TONE: Readonly<Record<string, readonly [string, string]>> = {
  Success: ["#34d399", "rgba(52,211,153,.35)"],
  Partial: ["#c2a63d", "rgba(194,166,61,.4)"],
  Failure: ["#f87171", "rgba(248,113,113,.35)"],
};

function HistoryTab({
  audit,
  totalExecs,
}: {
  readonly audit: readonly { when: string; code: string; action: string; actor: string; detail: string; result: string; hash: string }[];
  readonly totalExecs: number;
}) {
  const note =
    totalExecs === 0
      ? "No procedure has ever been run against your tenant, so there is no execution history. Everything below is a version publication — a real, dated, attributable event that exists whether or not anything has run."
      : "Version publications and executions in one list. A publication is recorded even when nothing has run.";

  return (
    <>
      <span className="max-w-[700px] text-[11.5px] leading-[1.55]" style={{ color: "#94a3b8" }}>
        {note}
      </span>
      <div className="rounded-[14px] border" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)", padding: "5px 18px 8px" }}>
        {audit.length === 0 ? (
          <div style={{ padding: "18px 0" }}>
            <EmptyPanel title="Nothing recorded yet" body="Published versions and executions will appear here as they happen." />
          </div>
        ) : (
          audit.map((a, i) => {
            const tone = RESULT_TONE[a.result] ?? RESULT_TONE.Success;
            return (
              <div
                key={`${a.code}-${a.when}-${i}`}
                className="flex flex-wrap items-center gap-[11px]"
                style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}
              >
                <span className="w-[120px] flex-none text-[11px]" style={{ color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                  {a.when}
                </span>
                <span className="w-[96px] flex-none text-[11px]" style={{ color: "#64748b", fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {a.code}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[12px] font-semibold" style={{ color: "#e2e8f0" }}>
                    {a.action} · <span className="font-normal" style={{ color: "#94a3b8" }}>{a.actor}</span>
                  </span>
                  <span className="text-[11px]" style={{ color: "#64748b" }}>
                    {a.detail}
                  </span>
                </div>
                <span
                  className="flex-none rounded-full text-[10px] font-semibold"
                  style={{ color: tone[0], border: `1px solid ${tone[1]}`, padding: "2px 9px" }}
                >
                  {a.result}
                </span>
                <span
                  title="SHA-256 over the entry's own fields — reproducible, not decorative"
                  className="flex-none text-[10px]"
                  style={{ color: "#475569", fontFamily: "ui-monospace, Menlo, monospace" }}
                >
                  {a.hash}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────

function SopDetailPanel({
  sop,
  meta,
  onClose,
  onAddStep,
}: {
  readonly sop: SopLibraryItem;
  readonly meta: SopMeta | undefined;
  readonly onClose: () => void;
  readonly onAddStep: () => void;
}) {
  const customCount = sop.steps.filter((s) => s.isCustom).length;
  const note =
    (sop.source === "ours"
      ? "Written by your team. Your MSP reads it and does not edit it, and a procedure you author can never gain an automated step."
      : "Maintained by your MSP and updated when Microsoft changes behaviour.") +
    (customCount ? "" : " You have not added any steps of your own to this one.") +
    ` Review cadence is not recorded anywhere, so none is shown. Last updated by ${sop.author}.`;

  return (
    <SlidePanel
      open
      onClose={onClose}
      title={sop.title}
      subtitle={`${meta?.code ?? sop.id} · ${meta?.level ?? "—"} · ${sop.updated}`}
      footer={
        <>
          <PanelCta label="Add a step of your own" onClick={onAddStep} />
          <span className="text-center text-[10.5px]" style={{ color: "#475569" }}>
            Up to 60 of your own steps. Adding one never makes a procedure runnable.
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-[12px]">
        {sop.steps.map((s, i) => (
          <PanelStepRow key={i} n={String(i + 1)} label={s.text} detail={s.isCustom ? "Your own step" : "Base procedure step"} />
        ))}
      </div>
      {customCount > 0 ? (
        <div className="flex flex-col rounded-[10px] border" style={{ borderColor: HAIRLINE, padding: "4px 14px 10px" }}>
          <PanelKVRow
            label={`${customCount} step${customCount === 1 ? "" : "s"} of yours`}
            value="Kept in your own record, appended after the procedure's own steps. A new version of the procedure never discards them."
          />
        </div>
      ) : null}
      {sop.runs.length > 0 ? (
        <div className="flex flex-col gap-[8px]">
          <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
            Run history
          </span>
          {sop.runs.map((r, i) => (
            <PanelKVRow key={i} label={`${r.when} · ${ORIGIN_LABEL[r.origin] ?? r.origin}`} value={`${r.outcome} ${r.who}`} />
          ))}
        </div>
      ) : null}
      <PanelNote>{note}</PanelNote>
    </SlidePanel>
  );
}

function AddCustomStepPanel({
  sop,
  onClose,
  onSave,
}: {
  readonly sop: SopLibraryItem;
  readonly onClose: () => void;
  readonly onSave: (sopId: string, input: { title: string; description?: string }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await onSave(sop.id, { title: title.trim(), description: description.trim() || undefined });
    setSaving(false);
    if (result) onClose();
    else setSaveError("Could not save that step. Try again.");
  };

  return (
    <SlidePanel
      open
      onClose={onClose}
      title="Add a step of your own"
      subtitle={sop.title}
      footer={
        <>
          <PanelCta
            label={saving ? "Saving…" : "Add step"}
            onClick={() => void submit()}
            disabled={!title.trim() || saving}
          />
          <span className="text-center text-[10.5px]" style={{ color: "#475569" }}>
            Kept in your own record. Adding one never makes this procedure runnable.
          </span>
        </>
      }
    >
      <PanelInput label="Step" hint="1 to 200 characters" value={title} onChange={setTitle} maxLength={200} autoFocus />
      <PanelTextarea
        label="Detail (optional)"
        hint="Up to 2,000 characters"
        value={description}
        onChange={setDescription}
        maxLength={2000}
      />
      {saveError ? <PanelNote>{saveError}</PanelNote> : null}
    </SlidePanel>
  );
}

function QueueDetailPanel({ item, onClose }: { readonly item: SopQueueItem; readonly onClose: () => void }) {
  return (
    <SlidePanel
      open
      onClose={onClose}
      title={item.title}
      subtitle={`${item.state} · ${item.pct}% · ${item.started.toLowerCase()}`}
    >
      <div className="flex flex-col gap-[12px]">
        {item.steps.map((s, i) => (
          <PanelStepRow
            key={i}
            n={String(i + 1)}
            label={s.t}
            detail={s.s === "done" ? `Done · ${s.by}` : s.s === "now" ? `In progress · ${s.by}` : "Waiting"}
            done={s.s === "done"}
          />
        ))}
      </div>
      <div className="flex flex-col rounded-[10px] border" style={{ borderColor: HAIRLINE, padding: "4px 14px 10px" }}>
        <PanelKVRow label="Why it started" value={ORIGIN_LABEL[item.origin] ?? item.origin} />
        <PanelKVRow label="Change request" value={item.cr} />
        <PanelKVRow
          label="Procedure version"
          value={`${item.sopVersion || "Not recorded"} — frozen at the moment the run started, so a later edit cannot change what ran`}
        />
        <PanelKVRow label="Mode" value={item.mode} />
        <PanelKVRow label="Service" value={item.svc} />
      </div>
      <PanelNote>
        Run by your MSP. Steps continue whether or not you are watching, and nothing here can be started or
        stopped from this page. A run whose automated steps finish while manual ones are still open settles as
        blocked, not complete.
      </PanelNote>
    </SlidePanel>
  );
}

function NewProcedurePanel({
  onClose,
  onCreate,
}: {
  readonly onClose: () => void;
  readonly onCreate: (input: {
    title: string;
    description: string;
    category: string;
    steps: readonly { title: string }[];
  }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  const canSubmit = title.trim() && description.trim() && category.trim() && cleanSteps.length > 0;

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await onCreate({
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      steps: cleanSteps.map((s) => ({ title: s })),
    });
    setSaving(false);
    if (result) onClose();
    else setSaveError("Could not create the procedure. Try again.");
  };

  return (
    <SlidePanel
      open
      onClose={onClose}
      title="New procedure"
      subtitle="Lands in your library as 'Written by your team'"
      footer={
        <>
          <PanelCta label={saving ? "Creating…" : "Create procedure"} onClick={() => void submit()} disabled={!canSubmit || saving} />
          <span className="text-center text-[10.5px]" style={{ color: "#475569" }}>
            It stays reference-only — a procedure you author can never gain an automated step, and nothing you
            write here can run against your tenant.
          </span>
        </>
      }
    >
      <PanelInput label="Title" hint="e.g. Approve external sharing requests" value={title} onChange={setTitle} maxLength={200} autoFocus />
      <PanelInput label="Category" hint="e.g. Governance" value={category} onChange={setCategory} maxLength={120} />
      <PanelTextarea label="Purpose" hint="What this procedure is for" value={description} onChange={setDescription} maxLength={2000} />

      <div className="flex flex-col gap-[8px]">
        <span className="text-[11px] font-semibold" style={{ color: "#94a3b8" }}>
          Steps (1 to 60, plain text)
        </span>
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-[8px]">
            <input
              value={s}
              onChange={(e) => setSteps((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              placeholder={`Step ${i + 1}`}
              maxLength={200}
              className="w-full rounded-md text-[13px] outline-none"
              style={{ border: "1px solid rgba(255,255,255,.10)", background: "rgba(255,255,255,.03)", padding: "9px 11px", color: "#e2e8f0" }}
            />
            {steps.length > 1 ? (
              <button
                type="button"
                onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                className="flex-none text-[11px]"
                style={{ color: "#64748b" }}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {steps.length < 60 ? (
          <button
            type="button"
            onClick={() => setSteps((prev) => [...prev, ""])}
            className="self-start text-[11.5px] font-semibold"
            style={{ color: "#60a5fa" }}
          >
            + Add step
          </button>
        ) : null}
      </div>
      {saveError ? <PanelNote>{saveError}</PanelNote> : null}
    </SlidePanel>
  );
}

