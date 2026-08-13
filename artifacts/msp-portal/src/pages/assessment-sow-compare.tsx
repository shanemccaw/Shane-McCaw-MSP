/**
 * Assessment Comparison Mode — side-by-side SOW scope versions.
 *
 * Non-obvious feature from the original product spec: let the customer compare
 * their statement-of-work scope/pricing across versions (e.g. full scope vs. a
 * narrower re-scope they later chose). Every superseded regeneration from the
 * Interactive SOW Scope Selector (task 4) is archived, not deleted, so real
 * historical versions already exist — this is a read-only view over that data
 * via GET /api/portal/assessment/sow/versions. It does not generate anything new.
 *
 * A second comparison type ("free assessment result vs. what a paid upgrade
 * would show") was investigated and found not buildable from real data —
 * diagnostic findings and SOW pricing lines share no common key — so it is not
 * built here. Pricing-line rendering mirrors AssessmentSowSelector's convention.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CheckCircle2, GitCompareArrows, Lock, Minus } from "lucide-react";

interface SowWorkstream {
  title: string;
  scope: string;
  priceUsd: number;
  weeks: number | null;
  deliveryDate: string | null;
}
interface SowAdjustment {
  title: string;
  scope: string;
  priceUsd: number;
}
interface SowVersion {
  id: number;
  title: string;
  status: string;
  createdAt: string;
  isActive: boolean;
  totalPrice: number | null;
  workstreams: SowWorkstream[];
  adjustments: SowAdjustment[];
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function versionLabel(v: SowVersion): string {
  return `${formatDate(v.createdAt)}${v.isActive ? " (current)" : ""}`;
}

function VersionPicker({
  versions,
  value,
  onChange,
  label,
}: {
  versions: SowVersion[];
  value: number | null;
  onChange: (id: number) => void;
  label: string;
}) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <select
        className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {versionLabel(v)} — {v.totalPrice != null ? usd.format(v.totalPrice) : "—"}
          </option>
        ))}
      </select>
    </label>
  );
}

function VersionColumn({ version }: { version: SowVersion | null }) {
  if (!version) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Select a version to compare.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {formatDate(version.createdAt)}
            {version.isActive && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
                <CheckCircle2 className="size-3" /> Current
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{version.title}</p>
        </div>
        <p className="shrink-0 text-2xl font-extrabold tabular-nums text-foreground">
          {version.totalPrice != null ? usd.format(version.totalPrice) : "—"}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {version.workstreams.map((w) => (
          <div key={w.title} className="rounded-xl border border-border bg-background px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{w.title}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{usd.format(w.priceUsd)}</span>
            </div>
            {w.scope && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{w.scope}</p>}
            {(w.weeks != null || w.deliveryDate) && (
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {w.weeks != null ? `${w.weeks} week${w.weeks === 1 ? "" : "s"}` : null}
                {w.weeks != null && w.deliveryDate ? " · " : null}
                {w.deliveryDate ? `delivery ${formatDate(w.deliveryDate)}` : null}
              </p>
            )}
          </div>
        ))}
      </div>

      {version.adjustments.length > 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Lock className="size-3" />
            Included adjustments
          </p>
          <div className="mt-2 space-y-1.5">
            {version.adjustments.map((a) => (
              <div key={a.title} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">{a.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{usd.format(a.priceUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Diff row rendered above the two columns: phases only on one side, and any
//    price differences on phases present in both. ─────────────────────────────
function DiffSummary({ left, right }: { left: SowVersion; right: SowVersion }) {
  const leftTitles = new Map(left.workstreams.map((w) => [w.title, w.priceUsd]));
  const rightTitles = new Map(right.workstreams.map((w) => [w.title, w.priceUsd]));
  const onlyLeft = [...leftTitles.keys()].filter((t) => !rightTitles.has(t));
  const onlyRight = [...rightTitles.keys()].filter((t) => !leftTitles.has(t));
  const changed = [...leftTitles.keys()].filter(
    (t) => rightTitles.has(t) && rightTitles.get(t) !== leftTitles.get(t),
  );
  const priceDelta = (right.totalPrice ?? 0) - (left.totalPrice ?? 0);

  if (onlyLeft.length === 0 && onlyRight.length === 0 && changed.length === 0 && priceDelta === 0) {
    return (
      <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        These versions have identical scope and pricing.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GitCompareArrows className="size-4 text-primary" />
        What changed
      </p>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {priceDelta !== 0 && (
          <p>
            Total price {priceDelta > 0 ? "increased" : "decreased"} by {usd.format(Math.abs(priceDelta))}.
          </p>
        )}
        {onlyLeft.map((t) => (
          <p key={`removed-${t}`} className="flex items-center gap-1.5">
            <Minus className="size-3 text-red-500" />
            <span>
              <span className="font-medium text-foreground">{t}</span> was in the left version only.
            </span>
          </p>
        ))}
        {onlyRight.map((t) => (
          <p key={`added-${t}`} className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-emerald-500" />
            <span>
              <span className="font-medium text-foreground">{t}</span> was added in the right version.
            </span>
          </p>
        ))}
        {changed.map((t) => (
          <p key={`changed-${t}`}>
            <span className="font-medium text-foreground">{t}</span> priced at {usd.format(leftTitles.get(t)!)} vs.{" "}
            {usd.format(rightTitles.get(t)!)}.
          </p>
        ))}
      </div>
    </div>
  );
}

export default function AssessmentSowComparePage() {
  const { fetchWithAuth } = useAuth();
  const [versions, setVersions] = useState<SowVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErrored(false);
      try {
        const res = await fetchWithAuth("/api/portal/assessment/sow/versions");
        if (!res.ok) {
          setErrored(true);
          return;
        }
        const data = (await res.json()) as { versions: SowVersion[] };
        const list = data.versions ?? [];
        setVersions(list);
        // Default: the current active version on the right, the oldest (fullest,
        // earliest) version on the left, so the default view is "before vs. after".
        if (list.length > 0) {
          const active = list.find((v) => v.isActive) ?? list[0];
          const oldest = [...list].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )[0];
          setRightId(active.id);
          setLeftId(oldest.id !== active.id ? oldest.id : (list[1]?.id ?? oldest.id));
        }
      } catch {
        setErrored(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchWithAuth]);

  const left = useMemo(() => versions.find((v) => v.id === leftId) ?? null, [versions, leftId]);
  const right = useMemo(() => versions.find((v) => v.id === rightId) ?? null, [versions, rightId]);

  return (
    <AppShell title="Compare scope versions">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Compare scope versions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See how your statement of work's scope and pricing changed across versions — for example, your full-scope
            quote next to a narrower selection.
          </p>
        </div>

        {loading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-96 w-full rounded-2xl" />
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        )}

        {!loading && errored && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">We couldn't load your statement of work versions just now.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !errored && versions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No statement of work versions yet — this appears once your assessment scope has been generated.
            </p>
          </div>
        )}

        {!loading && !errored && versions.length === 1 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Only one version exists so far — comparison becomes available once you've adjusted your scope at least
              once.
            </p>
          </div>
        )}

        {!loading && !errored && versions.length > 1 && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <VersionPicker versions={versions} value={leftId} onChange={setLeftId} label="Left version" />
              <VersionPicker versions={versions} value={rightId} onChange={setRightId} label="Right version" />
            </div>

            {left && right && <DiffSummary left={left} right={right} />}

            <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2")}>
              <VersionColumn version={left} />
              <VersionColumn version={right} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
