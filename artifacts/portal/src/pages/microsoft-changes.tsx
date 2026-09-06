import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Circle, Diamond, Square, X } from "lucide-react";
import { comingSoonHref } from "@/components/shell/moduleNav";
import {
  useMicrosoftChangesLive,
  isActionableRouting,
  type WaveGroup,
} from "@/components/microsoft-changes/useMicrosoftChangesLive";
import type { WirePost } from "@/components/microsoft-changes/types";

const HAIRLINE = "rgba(255,255,255,.09)";
const ACCENT = "#0078D4";
const CAUTION = "#fbbf24";
const DANGER = "#f87171";
const SUCCESS = "#34d399";
const INFO = "#60a5fa";

const KIND_COLORS: Record<"b" | "d" | "v" | "s", string> = {
  b: DANGER,
  d: CAUTION,
  v: INFO,
  s: "#64748b",
};
const KIND_LABELS: Record<"b" | "d" | "v" | "s", string> = {
  b: "Breaks something",
  d: "Needs a decision",
  v: "Your people will see it",
  s: "Silent, no action",
};

const DATE_UNCLEAR_KEY = "__date_unclear__";

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/** One triage card — a routed Microsoft change still needing the customer's decision. */
function TriageCard({
  post,
  onDecline,
  declining,
}: {
  post: WirePost;
  onDecline: (post: WirePost) => void;
  declining: boolean;
}) {
  const a = post.analysis;
  return (
    <div
      className="flex flex-col gap-[11px] rounded-[14px] border p-4"
      style={{ borderColor: "rgba(251,191,36,.30)", background: "linear-gradient(135deg, rgba(0,120,212,.10), rgba(139,92,246,.08))" }}
      data-testid={`ms-changes-triage-${post.id}`}
    >
      <div className="flex flex-wrap items-center gap-[9px]">
        <span className="size-2 flex-none rounded-full" style={{ background: CAUTION }} />
        <span className="text-sm font-semibold text-foreground">{post.title}</span>
        <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
          {post.id}
        </span>
        {post.routing?.changeRequestCode && (
          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
            {post.routing.changeRequestCode}
            {post.routing.changeRequestStatus ? ` · ${post.routing.changeRequestStatus.replace(/_/g, " ")}` : ""}
          </span>
        )}
        <span
          className="ml-auto flex-none rounded-full border px-2.5 py-[3px] text-[10.5px] font-semibold"
          style={{ borderColor: "rgba(251,191,36,.45)", color: CAUTION }}
        >
          Needs a decision
        </span>
      </div>
      {post.ms && <div className="max-w-[760px] text-[12.5px] leading-[1.55] text-muted-foreground">{post.ms}</div>}
      <div className="flex flex-wrap items-stretch gap-4">
        {a?.measured && a.affectedCount !== null && (
          <>
            <div className="flex items-baseline gap-[7px]">
              <span className="text-[26px] font-extrabold leading-none text-foreground tabular-nums">{a.affectedCount}</span>
              <div className="flex flex-col gap-[1px]">
                <span className="text-xs font-semibold text-[#cbd5e1]">
                  {pluralize(a.affectedCount, "object", "objects")} in your tenant
                </span>
                <span className="text-[10.5px] text-[#64748b]">
                  measured · {a.basis === "monitor_check" ? "monitor check" : a.basis === "license_snapshot" ? "license snapshot" : "—"}
                </span>
              </div>
            </div>
            <div className="w-px" style={{ background: "rgba(255,255,255,.08)" }} />
          </>
        )}
        <div className="flex flex-col justify-center gap-[1px]">
          <span className="text-xs font-semibold text-[#cbd5e1]">Microsoft rollout — by {post.when}</span>
          <span className="text-[10.5px] text-[#64748b]">{post.countdown}</span>
        </div>
        {post.services.length > 0 && (
          <>
            <div className="w-px" style={{ background: "rgba(255,255,255,.08)" }} />
            <div className="flex items-center gap-1.5">
              {post.services.map((s) => (
                <span key={s} className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
                  {s}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {post.advisoryDateText && (
        <div className="text-[11px] leading-relaxed text-[#64748b]">&quot;{post.advisoryDateText}&quot; — Microsoft&apos;s own rollout schedule</div>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={() => onDecline(post)}
          disabled={declining}
          className="rounded-md border px-3.5 py-[7px] text-xs font-semibold"
          style={{ borderColor: "rgba(251,191,36,.45)", color: CAUTION }}
          data-testid={`ms-changes-decline-${post.id}`}
        >
          {declining ? "Declining…" : "Decline — record risk acceptance"}
        </button>
        <Link href={comingSoonHref("Change Control", "module")} className="text-xs font-semibold" style={{ color: INFO }}>
          View change request
        </Link>
        <span className="ml-auto max-w-[320px] text-right text-[10.5px] text-[#64748b]">
          Declining does not stop Microsoft&apos;s rollout — it records that you accept the risk.
        </span>
      </div>
    </div>
  );
}

/** Confirm-and-submit panel for the decline action (surface C — `POST .../change-control/:code/decline`). */
function DeclineDialog({
  post,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  post: WirePost;
  onCancel: () => void;
  onSubmit: (fullName: string, statement: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [fullName, setFullName] = useState("");
  const [statement, setStatement] = useState("");
  const valid = fullName.trim().length > 0 && statement.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(2,6,23,.72)" }}>
      <div
        className="flex w-full max-w-[480px] flex-col gap-3.5 rounded-[14px] border p-5"
        style={{ borderColor: HAIRLINE, background: "rgba(11,17,32,.98)" }}
        data-testid="ms-changes-decline-dialog"
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">Decline &amp; record risk acceptance</span>
            <span className="text-[11.5px] text-[#94a3b8]">{post.title}</span>
          </div>
          <button type="button" onClick={onCancel} className="ml-auto flex-none text-[#64748b]" aria-label="Cancel">
            <X className="size-4" />
          </button>
        </div>
        <span className="text-[11.5px] leading-relaxed text-[#94a3b8]">
          This does not stop Microsoft&apos;s rollout. It records, in your name, that you have chosen to accept the risk instead
          of acting on this change.
        </span>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#cbd5e1]">
          Your full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={200}
            className="rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none"
            style={{ borderColor: HAIRLINE }}
            data-testid="ms-changes-decline-fullname"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#cbd5e1]">
          Statement
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Why you're accepting this risk rather than acting on it"
            className="resize-none rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none"
            style={{ borderColor: HAIRLINE }}
            data-testid="ms-changes-decline-statement"
          />
        </label>
        {error && (
          <span className="text-[11.5px]" style={{ color: DANGER }}>
            {error}
          </span>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-md border px-3.5 py-2 text-xs font-semibold"
            style={{ borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={() => onSubmit(fullName, statement)}
            className="flex-none rounded-md px-[15px] py-2 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: CAUTION, color: "#1c1400" }}
            data-testid="ms-changes-decline-submit"
          >
            {submitting ? "Recording…" : "Decline & accept risk"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KindDot({ kind, count }: { kind: "b" | "d" | "v" | "s"; count: number }) {
  if (count === 0) return null;
  const color = KIND_COLORS[kind];
  const Icon = kind === "b" ? Square : kind === "d" ? Diamond : kind === "v" ? Circle : Circle;
  return (
    <span className="flex items-center gap-1">
      <Icon className="size-[9px]" style={{ color }} fill={color} strokeWidth={0} />
      <span className="text-[10px] font-semibold tabular-nums" style={{ color: kind === "s" ? "#64748b" : "#f8fafc" }}>
        {count}
      </span>
    </span>
  );
}

/** The reusable content of the Microsoft Changes screen (#1744, real design in
 * Design/portal/design_handoff_full_site/screens/Microsoft Changes.dc.html).
 * Wired to `GET /api/portal/message-center` (contract pack §1a) and the
 * decline action `POST /api/portal/change-control/:code/decline` (§1c). No
 * fixture data — every number here came out of that fetch.
 */
export function MicrosoftChangesContent() {
  const { dataState, data, waveGroups, triagePosts, analysedCount, refetch, declining, declineError, decline } =
    useMicrosoftChangesLive();
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [selectedWl, setSelectedWl] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<WirePost | null>(null);

  const waveKey = selectedWave ?? waveGroups[0]?.key ?? null;
  const activeGroup: WaveGroup | undefined = waveGroups.find((g) => g.key === waveKey);
  const onDateUnclear = waveKey === DATE_UNCLEAR_KEY;

  const scopedPosts = data && data.scoped ? data.posts : [];
  const wavePosts = useMemo(() => {
    if (!activeGroup) return [];
    return scopedPosts.filter((p) => activeGroup.bucketIndexes.includes(p.bucket) && (!selectedWl || p.wl === selectedWl));
  }, [activeGroup, scopedPosts, selectedWl]);

  const measuredAffected =
    data && data.scoped ? data.posts.filter((p) => p.analysis?.measured && (p.analysis.affectedCount ?? 0) > 0) : [];
  const totalAffectedObjects = measuredAffected.reduce((sum, p) => sum + (p.analysis?.affectedCount ?? 0), 0);
  const nearestDeadline = triagePosts
    .map((p) => p.actionRequiredBy ?? p.publishedAt)
    .filter((d): d is string => !!d)
    .sort()[0];

  async function handleDeclineSubmit(fullName: string, statement: string) {
    if (!declineTarget) return;
    const ok = await decline(declineTarget, fullName, statement);
    if (ok) setDeclineTarget(null);
  }

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-4 py-2" data-testid="ms-changes-page">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-lg font-bold text-foreground">Microsoft Changes</span>
        <span className="text-xs text-[#64748b]">What Microsoft is changing in your tenant — and whether you have to do anything</span>
        <span
          className="ml-auto flex items-center gap-1.5 text-[11px]"
          style={{ color: dataState === "failed" ? DANGER : "#64748b" }}
          data-testid="ms-changes-status"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: dataState === "failed" ? DANGER : dataState === "loading" ? "#475569" : SUCCESS }}
          />
          {dataState === "loading" ? "Reading your Message Center" : dataState === "failed" ? "Could not read your Message Center" : "Live"}
        </span>
      </div>

      {dataState === "loading" && (
        <div className="flex flex-col gap-2">
          {[100, 90, 95].map((w, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[14px] border"
              style={{ width: `${w}%`, borderColor: "rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}
            />
          ))}
        </div>
      )}

      {dataState === "failed" && (
        <div
          className="flex gap-2.5 rounded-xl border border-dashed p-3.5"
          style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
          data-testid="ms-changes-error"
        >
          <AlertTriangle className="mt-0.5 size-[15px] flex-none" color={DANGER} strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">Your Microsoft Changes could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              Nothing is listed because nothing could be fetched — your tenant&apos;s real Message Center is unaffected.
            </span>
            <button type="button" onClick={refetch} className="w-fit pt-0.5 text-[11.5px] font-semibold" style={{ color: INFO }}>
              Try again
            </button>
          </div>
        </div>
      )}

      {dataState === "live" && data && !data.scoped && (
        <div
          className="flex items-center gap-3 rounded-xl border border-dashed p-4"
          style={{ borderColor: "rgba(148,163,184,.25)" }}
          data-testid="ms-changes-not-connected"
        >
          <AlertTriangle className="size-4 flex-none" color="#94a3b8" strokeWidth={1.75} />
          <span className="text-xs text-[#94a3b8]">
            Not connected — this account has no resolvable Microsoft 365 tenant, so there is no Message Center to read.
          </span>
        </div>
      )}

      {dataState === "live" && data && data.scoped && (
        <>
          <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-[14px] border sm:grid-cols-4" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.02)" }}>
            {[
              { label: "TRACKED", value: String(data.itemCount), sub: `${data.onAxisCount} in the next twelve months` },
              {
                label: "AFFECT YOUR TENANT",
                value: analysedCount > 0 ? String(measuredAffected.length) : "—",
                sub:
                  analysedCount > 0
                    ? `${totalAffectedObjects} ${pluralize(totalAffectedObjects, "object", "objects")} · ${measuredAffected.length} ${pluralize(measuredAffected.length, "change", "changes")} · measured`
                    : "none analysed yet",
              },
              {
                label: "NEED A DECISION",
                value: String(triagePosts.length),
                sub: triagePosts.length > 0 && nearestDeadline ? `due ${new Date(nearestDeadline).toDateString().slice(4)}` : "nothing pending",
              },
              { label: "DATE UNCLEAR", value: String(data.dateUnclearCount), sub: "no reliable date from Microsoft" },
            ].map((c, i) => (
              <div
                key={c.label}
                className="flex flex-col gap-[3px] p-3.5"
                style={i > 0 ? { borderLeft: `1px solid ${HAIRLINE}` } : undefined}
                data-testid={`ms-changes-stat-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="text-[10px] font-semibold tracking-[.12em] text-[#64748b]">{c.label}</span>
                <span className="text-2xl font-extrabold leading-[1.1] text-foreground tabular-nums">{c.value}</span>
                <span className="text-[11px] text-[#64748b]">{c.sub}</span>
              </div>
            ))}
          </div>

          {analysedCount === 0 && data.itemCount > 0 && (
            <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed p-3" style={{ borderColor: "rgba(148,163,184,.25)" }}>
              <AlertTriangle className="size-[15px] flex-none" color="#64748b" strokeWidth={1.75} />
              <span className="text-xs leading-relaxed text-[#94a3b8]">
                {data.itemCount} announcements are tracked for your tenant. None have been analysed yet — when your MSP
                interprets one, its measured impact on your tenant appears here. Not analysed means not looked at, never
                &quot;no data&quot;.
              </span>
            </div>
          )}

          {/* ── TRIAGE ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">TRIAGE — NEEDS YOUR ATTENTION NOW</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,.06)" }} />
            </div>
            {triagePosts.length === 0 && (
              <div
                className="flex items-center gap-2.5 rounded-[10px] border p-3.5"
                style={{ borderColor: HAIRLINE }}
                data-testid="ms-changes-triage-empty"
              >
                <CheckCircle2 className="size-4 flex-none" color={SUCCESS} strokeWidth={1.75} />
                <span className="text-[13px] font-semibold text-[#cbd5e1]">Nothing needs a decision right now.</span>
                <span className="text-[11.5px] text-[#64748b]">Forced changes and action deadlines land here.</span>
              </div>
            )}
            {triagePosts.map((post) => (
              <TriageCard key={post.id} post={post} declining={declining === post.id} onDecline={setDeclineTarget} />
            ))}
          </div>

          {/* ── HORIZON ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">HORIZON — WHAT&apos;S COMING</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,.06)" }} />
            </div>
            <div className="flex flex-wrap items-center gap-3.5 px-0.5 pb-1">
              {(["b", "d", "v", "s"] as const).map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: KIND_COLORS[k] }} />
                  <span className="text-[11.5px] text-[#94a3b8]">{KIND_LABELS[k]}</span>
                </div>
              ))}
              <span className="ml-auto text-[10.5px] text-[#475569]">Rows are the services your tenant runs · click a wave to inspect it below</span>
            </div>

            <div className="flex flex-col gap-1.5 rounded-xl border p-3" style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.015)" }}>
              <div className="flex items-stretch gap-2 pb-0.5">
                <div className="w-[132px] flex-none" />
                {waveGroups.map((g, gi) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setSelectedWave(g.key)}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left"
                    style={{
                      borderColor: waveKey === g.key ? "rgba(0,120,212,.55)" : "rgba(255,255,255,.10)",
                      background: waveKey === g.key ? "rgba(0,120,212,.10)" : "rgba(255,255,255,.02)",
                    }}
                    data-testid={`ms-changes-wave-${gi}`}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="truncate text-[10.5px] font-bold tracking-[.05em]"
                        style={{ color: waveKey === g.key ? "#f8fafc" : "#cbd5e1" }}
                      >
                        {g.label}
                      </span>
                      <span className="ml-auto text-xs font-extrabold tabular-nums" style={{ color: waveKey === g.key ? "#f8fafc" : "#cbd5e1" }}>
                        {g.count}
                      </span>
                    </div>
                    <span className="truncate text-[9.5px] text-[#64748b]">{g.span}</span>
                  </button>
                ))}
                {data.dateUnclearCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedWave(DATE_UNCLEAR_KEY)}
                    className="flex min-w-0 flex-none basis-[150px] flex-col gap-0.5 rounded-lg border px-2.5 py-1.5 text-left"
                    style={{
                      borderColor: waveKey === DATE_UNCLEAR_KEY ? "rgba(0,120,212,.55)" : "rgba(255,255,255,.10)",
                      background: waveKey === DATE_UNCLEAR_KEY ? "rgba(0,120,212,.10)" : "rgba(255,255,255,.02)",
                    }}
                    data-testid="ms-changes-wave-date-unclear"
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[10.5px] font-bold tracking-[.05em]" style={{ color: waveKey === DATE_UNCLEAR_KEY ? "#f8fafc" : "#cbd5e1" }}>
                        NO DATE YET
                      </span>
                      <span className="ml-auto text-xs font-extrabold tabular-nums">{data.dateUnclearCount}</span>
                    </div>
                    <span className="text-[9.5px] text-[#64748b]">watched until Microsoft gives one</span>
                  </button>
                )}
              </div>

              {data.density.map((row) => (
                <div key={row.wl} className="flex items-stretch gap-2 border-t pt-1" style={{ borderColor: "rgba(255,255,255,.05)" }}>
                  <div className="flex w-[132px] flex-none items-center gap-1.5">
                    <span className="size-[7px] flex-none rounded-sm" style={{ background: "#64748b" }} />
                    <span className="truncate text-[11.5px] text-[#94a3b8]">{row.name}</span>
                  </div>
                  {waveGroups.map((g) => {
                    const [b, d, v, s] = g.bucketIndexes.reduce<[number, number, number, number]>(
                      (acc, bi) => {
                        const c = row.cells[bi] ?? [0, 0, 0, 0];
                        return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + c[3]];
                      },
                      [0, 0, 0, 0],
                    );
                    const active = selectedWl === row.wl && waveKey === g.key;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => {
                          setSelectedWave(g.key);
                          setSelectedWl((cur) => (cur === row.wl && waveKey === g.key ? null : row.wl));
                        }}
                        className="flex min-h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1"
                        style={{
                          background: active ? "rgba(0,120,212,.16)" : "transparent",
                          borderColor: active ? "rgba(0,120,212,.55)" : "transparent",
                        }}
                        data-testid={`ms-changes-cell-${row.wl}-${g.key}`}
                      >
                        <KindDot kind="b" count={b} />
                        <KindDot kind="d" count={d} />
                        <KindDot kind="v" count={v} />
                        {s > 0 && <span className="ml-auto text-[10.5px] text-[#475569] tabular-nums">{s}</span>}
                      </button>
                    );
                  })}
                  {data.dateUnclearCount > 0 && <div className="flex-none basis-[150px]" />}
                </div>
              ))}
            </div>

            {/* ── IN THIS WAVE ── */}
            <div
              className="flex flex-col gap-2 rounded-xl border p-3.5"
              style={{ borderColor: HAIRLINE, background: "rgba(255,255,255,.015)" }}
              data-testid="ms-changes-in-this-wave"
            >
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">
                  {onDateUnclear ? "DATE UNCLEAR" : "IN THIS WAVE"}
                </span>
                <span className="text-[12.5px] font-bold text-[#cbd5e1]">
                  {onDateUnclear ? "No structural date" : activeGroup?.label}
                </span>
                <span className="text-[10.5px] text-[#475569]">{onDateUnclear ? "" : activeGroup?.span}</span>
                <span className="ml-auto text-[11px] text-[#64748b] tabular-nums">
                  {onDateUnclear ? data.dateUnclearCount : activeGroup?.count ?? 0} announcements
                </span>
                {selectedWl && !onDateUnclear && (
                  <button
                    type="button"
                    onClick={() => setSelectedWl(null)}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold text-foreground"
                    style={{ borderColor: "rgba(0,120,212,.5)", background: "rgba(0,120,212,.16)" }}
                  >
                    {selectedWl}
                    <X className="size-[11px]" />
                  </button>
                )}
              </div>

              {onDateUnclear ? (
                data.dateUnclearPosts.length === 0 ? (
                  <div className="px-1 py-2 text-xs text-[#64748b]">No posts with an unclear date right now.</div>
                ) : (
                  data.dateUnclearPosts.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5 rounded-lg py-[7px]" style={{ borderTop: "1px solid rgba(255,255,255,.05)" }}>
                      <span className="size-2 flex-none rounded-full" style={{ background: "#60a5fa" }} />
                      <span className="text-[12.5px] text-[#cbd5e1]">{p.title}</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
                        {p.workload}
                      </span>
                      <span className="ml-auto text-[10.5px] text-[#64748b]">last updated {p.lastUpdated}</span>
                    </div>
                  ))
                )
              ) : (
                <>
                  {wavePosts.length === 0 && (
                    <div className="px-1 py-2 text-xs text-[#64748b]">
                      No announcements{selectedWl ? ` for ${selectedWl}` : ""} in this wave.
                    </div>
                  )}
                  {wavePosts
                    .filter((p) => p.analysis !== null)
                    .map((p) => {
                      const a = p.analysis!;
                      const inTriage = isActionableRouting(p);
                      if (inTriage) {
                        return (
                          <div
                            key={p.id}
                            className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                            style={{ borderColor: "rgba(251,191,36,.22)" }}
                          >
                            <span className="size-2 flex-none rounded-full" style={{ background: CAUTION }} />
                            <span className="text-[12.5px] font-semibold text-foreground">{p.title}</span>
                            <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
                              {p.workload}
                            </span>
                            <span className="ml-auto text-[11.5px] font-semibold" style={{ color: CAUTION }}>
                              {a.affectedCount ?? 0} {pluralize(a.affectedCount ?? 0, "object", "objects")} · in triage above
                            </span>
                          </div>
                        );
                      }
                      if (a.noise) {
                        return (
                          <div key={p.id} className="flex items-center gap-2.5 rounded-lg py-[7px]">
                            <span className="size-2 flex-none rounded-full" style={{ background: "#64748b" }} />
                            <span className="text-[12.5px] text-[#94a3b8]">{p.title}</span>
                            <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
                              {p.workload}
                            </span>
                            <span className="ml-auto flex items-center gap-1.5">
                              <CheckCircle2 className="size-[13px]" color={SUCCESS} strokeWidth={2} />
                              <span className="text-[11.5px] font-semibold" style={{ color: SUCCESS }}>
                                Doesn&apos;t affect you
                              </span>
                              <span className="text-[10.5px] text-[#64748b]">· 0 objects found</span>
                            </span>
                          </div>
                        );
                      }
                      if (!a.measured) {
                        return (
                          <div key={p.id} className="flex items-center gap-2.5 rounded-lg py-[7px]">
                            <span className="size-2 flex-none rounded-full" style={{ background: INFO }} />
                            <div className="flex min-w-0 flex-col gap-[1px]">
                              <span className="text-[12.5px] text-[#cbd5e1]">{p.title}</span>
                              <span className="text-[10.5px] text-[#64748b]">{a.summary ?? "Interpreted — no probe measures this tenant"}</span>
                            </div>
                            <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: HAIRLINE, color: "#64748b" }}>
                              {p.workload}
                            </span>
                            <span
                              className="ml-auto flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                              style={{ borderColor: "rgba(148,163,184,.35)", color: "#94a3b8" }}
                            >
                              Can&apos;t be measured here
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={p.id} className="flex items-center gap-2.5 rounded-lg py-[7px]">
                          <span className="size-2 flex-none rounded-full" style={{ background: INFO }} />
                          <span className="text-[12.5px] text-[#cbd5e1]">{p.title}</span>
                          <span className="ml-auto text-[11px] text-[#64748b]">
                            measured · {a.affectedCount} {pluralize(a.affectedCount ?? 0, "object", "objects")}
                          </span>
                        </div>
                      );
                    })}
                  {(() => {
                    const notAnalysed = wavePosts.filter((p) => p.analysis === null).length;
                    return notAnalysed > 0 ? (
                      <div className="flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2" style={{ borderColor: "rgba(148,163,184,.22)" }}>
                        <span className="text-xs text-[#64748b] tabular-nums">{notAnalysed} announcements · not yet analysed</span>
                        <span className="ml-auto text-[10.5px] text-[#475569]">tracked, awaiting interpretation</span>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          </div>

          <div className="pt-1 text-[10px] leading-relaxed text-[#475569]">
            {data.provenance.impactBasis} {data.provenance.scoreBasis} {data.provenance.measuredCounts}
          </div>
        </>
      )}

      {declineTarget && (
        <DeclineDialog
          post={declineTarget}
          onCancel={() => setDeclineTarget(null)}
          onSubmit={handleDeclineSubmit}
          submitting={declining === declineTarget.id}
          error={declineError}
        />
      )}
    </div>
  );
}

export default function MicrosoftChangesPage() {
  return <MicrosoftChangesContent />;
}
