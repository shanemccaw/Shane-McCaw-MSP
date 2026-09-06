import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth, AuthApiError } from "@/lib/auth-context";
import {
  fetchPlatformStatus,
  M365_UNAVAILABLE_REASONS,
  type PlatformStatus,
} from "@/lib/auth-api";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

type IssueKey = "mfa" | "locked" | "nocode" | "other";

// Client-facing copy for the 4 issues. The server's own catalog
// (portal-sign-in-help.ts SIGN_IN_HELP_ISSUES) carries slightly older labels
// used only inside the raised Zoho ticket, never shown back to the caller —
// this is the current design's copy, which is what actually renders here.
// The client only ever sends `issueKey`; priority/routingNote are always the
// server's own authoritative values from the raised-ticket response.
const ISSUES: { key: IssueKey; label: string; priority: string; routingNote: string }[] = [
  {
    key: "mfa",
    label: "I have lost access to my authenticator",
    priority: "P2",
    routingNote: "Re-enrolment needs an identity check, so we will call the number on your account.",
  },
  {
    key: "locked",
    label: "My account is locked",
    priority: "P2",
    routingNote: "We will check the sign-in logs for your account and lift the lock manually.",
  },
  {
    key: "nocode",
    label: "No email or code is arriving",
    priority: "P3",
    routingNote: "We will confirm the address on your account and check delivery on our side.",
  },
  {
    key: "other",
    label: "Something else is stopping me signing in",
    priority: "P3",
    routingNote: "A human reads this one before it gets routed.",
  },
];

const ATTACH_FACTS = [
  'There is no per-attempt sign-in log on this platform, so the ticket cannot carry "your last ten attempts". What it carries is your failed-attempt counter, when the last failure was, and your lock expiry.',
  "Alongside that: your last ten successful sign-ins — time, method, browser, operating system, IP, and whether the session has since been revoked.",
  'If no account matches the address, the ticket says exactly that rather than inventing an account summary. An account with no history says "none on record".',
  "None of that context comes back in the response. All you get is the reference, the priority, the routing line and the address it was filed against.",
];

const PLATFORM_COPY: Record<PlatformStatus["status"], { dot: string; label: string; body: string }> = {
  operational: {
    dot: "bg-status-green",
    label: "All systems operational",
    body: "Nothing unresolved on the platform, and the job queue is keeping up. This reading is computed at the moment you asked — the fact you got an answer at all is part of it.",
  },
  degraded: {
    dot: "bg-status-amber",
    label: "Degraded performance",
    body: "Either an incident is open or the job queue has fallen more than five minutes behind. Signals still arrive; they arrive late.",
  },
  outage: {
    dot: "bg-destructive",
    label: "Outage",
    body: "An unresolved critical incident is open. If sign-in itself is what is failing, a ticket raised here still reaches us.",
  },
};

/**
 * Auth — Sign-in help (#2991, Feature #1648). Left: wired to
 * POST /api/portal/sign-in-help/ticket (portal-sign-in-help.ts:133-168).
 * Right: wired to GET /api/status (public-status.ts:298), unconditionally
 * public per contract pack §1 — deliberately so, since the caller is by
 * definition locked out.
 */
export default function SignInHelpPage() {
  const { signInHelp } = useAuth();

  const [email, setEmail] = useState("");
  const [issueKey, setIssueKey] = useState<IssueKey>("mfa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; body: string; wire: string } | null>(null);
  const [raised, setRaised] = useState<{ reference: string; priority: string; routingNote: string; email: string } | null>(null);

  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await fetchPlatformStatus();
      if (!cancelled) {
        setStatus(s);
        setStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInHelp(email, issueKey);
      setRaised(result);
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 400) {
        setError({
          title: "That does not look like an email address",
          body: "Checked as loosely as possible — something, an at-sign, a dot. Anything past that is checked by whether the address actually matches an account, which this screen is never told.",
          wire: "400 { error } · portal-sign-in-help.ts:139",
        });
      } else if (err instanceof AuthApiError && err.status === 429) {
        setError({
          title: "Too many requests from here",
          body: "Six per fifteen minutes from one address. If you have already raised one, it is in the queue — raising it again does not move it up.",
          wire: "429 · signInHelpLimiter, 6/15min prod",
        });
      } else {
        setError({
          title: "We could not raise the ticket",
          body: "Our ticket system did not accept it, so nothing was filed and there is no reference to quote. The failure is logged on our side with the real error. Trying again shortly is worth it.",
          wire: "502 { error } · portal-sign-in-help.ts:164",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const dailyIncidentDays = status?.dailyHistory.filter((d) => d.status !== "operational").length ?? 0;
  const platformCopy = status ? PLATFORM_COPY[status.status] : null;

  return (
    <AuthPageShell title="Sign-in help" subtitle="You do not need to be signed in to use this — which is rather the point." maxWidthClassName="max-w-[1010px]">
      <div className="flex flex-wrap items-start gap-4.5">
        <div className="flex min-w-[min(430px,100%)] flex-[1.35] flex-col gap-3.5">
          {!raised ? (
            <Card className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1">
                <span className="text-lg font-bold tracking-tight text-foreground">Tell us what is blocking you</span>
                <span className="text-xs text-muted-foreground">
                  Four routes, each going somewhere different. Pick the nearest one — a human reads it
                  either way.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">The email on your account</Label>
                <Input
                  id="email"
                  data-testid="sign-in-help-email"
                  type="email"
                  placeholder="you@yourcompany.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>{error.title}</AlertTitle>
                  <AlertDescription>
                    <p>{error.body}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{error.wire}</p>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                {ISSUES.map((issue) => (
                  <button
                    type="button"
                    key={issue.key}
                    data-testid={`sign-in-help-issue-${issue.key}`}
                    onClick={() => setIssueKey(issue.key)}
                    className={`flex flex-col gap-1.5 rounded-[11px] border p-3.5 text-left transition-colors ${
                      issueKey === issue.key
                        ? "border-status-blue/45 bg-status-blue/10"
                        : "border-border bg-background/40 hover:border-status-blue/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{issue.label}</span>
                      <span className="ml-auto flex-none rounded-full border border-status-amber/30 bg-status-amber/10 px-1.75 py-0.5 font-mono text-[9.5px] font-bold tracking-wider text-status-amber">
                        {issue.priority}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{issue.routingNote}</span>
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit}>
                <Button type="submit" data-testid="sign-in-help-submit" className="w-full" disabled={busy || !email}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  {busy ? "Raising…" : "Raise this with a human"}
                </Button>
              </form>

              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                The priority and the routing line above are fixed server-side — you are only ever
                sending which of the four it is, so neither can be talked up from this screen.
              </p>
            </Card>
          ) : (
            <Card data-testid="sign-in-help-raised" className="flex flex-col gap-3.5 border-status-green/30 bg-status-green/5 p-5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-status-green">Ticket raised</span>
              <div className="flex flex-wrap items-baseline gap-3">
                <span data-testid="sign-in-help-reference" className="font-mono text-2xl font-extrabold tracking-tight text-foreground">{raised.reference}</span>
                <span className="rounded-full border border-status-amber/30 bg-status-amber/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-status-amber">
                  {raised.priority}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Quote that reference if you call. It is against <strong className="text-foreground">{raised.email}</strong>.
              </p>
              <p className="border-l-2 border-status-green/45 pl-3 text-sm text-foreground">{raised.routingNote}</p>
              <p className="border-t border-status-green/20 pt-3 text-xs text-muted-foreground">
                Your account's current lock state and last successful sign-ins went with the ticket so
                the person picking it up does not have to ask. That context is not shown back to you
                here.
              </p>
              <Button variant="outline" size="sm" className="self-start" onClick={() => setRaised(null)}>
                Raise another
              </Button>
            </Card>
          )}

          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              What gets attached, honestly
            </span>
            {ATTACH_FACTS.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-[5px] flex-none rounded-full bg-muted-foreground" />
                <span className="min-w-0 text-xs text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-[min(340px,100%)] flex-1 flex-col gap-3.5">
          <Card className="flex flex-col gap-3.5 p-4.5">
            {statusLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading platform status…
              </div>
            ) : status && platformCopy ? (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`size-2 flex-none rounded-full ${platformCopy.dot}`} />
                  <span className="text-sm font-bold tracking-tight text-foreground">{platformCopy.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">derived, not stored</span>
                </div>
                <p className="text-xs text-muted-foreground">{platformCopy.body}</p>

                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last 90 days</span>
                    <span className="ml-auto text-[10.5px] text-muted-foreground">
                      {dailyIncidentDays === 0 ? "No incidents recorded" : `${dailyIncidentDays} day${dailyIncidentDays === 1 ? "" : "s"} with an incident`}
                    </span>
                  </div>
                  <div className="flex h-6.5 items-end gap-px">
                    {status.dailyHistory.map((d) => (
                      <span
                        key={d.date}
                        title={`${d.date}${d.title ? ` · ${d.title}` : ""}`}
                        className={`h-full min-w-px flex-1 rounded-[1.5px] ${
                          d.status === "operational" ? "bg-status-green/45" : d.status === "degraded" ? "bg-status-amber" : "bg-destructive"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Incidents, last 90 days</span>
                  {status.incidents.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None recorded.</span>
                  ) : (
                    status.incidents.slice(0, 3).map((n) => (
                      <div
                        key={n.id}
                        className={`flex flex-col gap-0.5 border-l-2 pl-2.5 ${n.severity === "critical" ? "border-destructive" : n.severity === "major" ? "border-status-amber" : "border-muted-foreground"}`}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="min-w-0 text-sm font-semibold text-foreground">{n.title}</span>
                          <span className="ml-auto flex-none text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{n.severity}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{n.description}</span>
                        <span className="text-[10.5px] text-muted-foreground">
                          Started {new Date(n.startedAt).toLocaleDateString()}
                          {n.resolvedAt ? ` · resolved ${new Date(n.resolvedAt).toLocaleDateString()}` : " · ongoing"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Platform status could not be read right now.</span>
            )}
          </Card>

          {!statusLoading && status ? (
            <Card className="flex flex-col gap-3 p-4.5">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">Microsoft 365 service health</span>
                <span className="text-[11px] text-muted-foreground">
                  Read from Shane's own testbed tenant, not from yours. Cached, so it lags Microsoft by
                  a few minutes.
                </span>
              </div>

              {status.m365Health.available ? (
                <div className="flex flex-col gap-1.5">
                  {status.m365Health.services.map((s) => (
                    <div key={s.service} className="flex items-center gap-2.5">
                      <span
                        className={`size-1.5 flex-none rounded-full ${
                          s.status === "healthy" ? "bg-status-green" : s.status === "degraded" ? "bg-status-amber" : "bg-destructive"
                        }`}
                      />
                      <span className="min-w-0 text-xs text-foreground">{s.service}</span>
                      <span
                        className={`ml-auto flex-none text-[11px] font-semibold ${
                          s.status === "healthy" ? "text-status-green" : s.status === "degraded" ? "text-status-amber" : "text-destructive"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3">
                  <span className="text-xs font-semibold text-foreground">Cannot be read right now</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {M365_UNAVAILABLE_REASONS[status.m365Health.reason] ?? "The read failed in a way we did not anticipate."}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">reason: {status.m365Health.reason}</span>
                </div>
              )}

              <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">Rolling 90-day uptime</span>
                  <span className="ml-auto text-[10.5px] text-muted-foreground">
                    target {status.m365Uptime.available ? `${status.m365Uptime.target}%` : "99.9%"}
                  </span>
                </div>
                {status.m365Uptime.available ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
                        {status.m365Uptime.overallUptimePercent !== null
                          ? `${status.m365Uptime.overallUptimePercent.toFixed(2)}%`
                          : "—"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        time-weighted across workloads, measured against Microsoft's own published SLA
                      </span>
                    </div>
                    {status.m365Uptime.services.map((u) => (
                      <div key={u.service} className="flex items-center gap-2.5">
                        <span className="w-28 flex-none truncate text-xs text-foreground">{u.service}</span>
                        <span className="relative h-1.25 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-full ${u.uptimePercent !== null && u.uptimePercent >= 99.9 ? "bg-status-green" : "bg-status-amber"}`}
                            style={{ width: u.uptimePercent !== null ? `${Math.max(2, ((u.uptimePercent - 99.5) / 0.5) * 100)}%` : "0%" }}
                          />
                        </span>
                        <span
                          className={`w-13 flex-none text-right text-[11.5px] font-semibold tabular-nums ${u.uptimePercent !== null && u.uptimePercent >= 99.9 ? "text-status-green" : "text-status-amber"}`}
                        >
                          {u.uptimePercent !== null ? `${u.uptimePercent.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-3">
                    <span className="text-xs font-semibold text-foreground">No uptime figure to show</span>
                    <span className="text-[11.5px] text-muted-foreground">
                      Uptime is computed from the same tenant reading above. With that reading
                      unavailable there is no number here — and a blank is the honest answer, not 100%.
                    </span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">reason: {status.m365Uptime.reason}</span>
                  </div>
                )}
              </div>

              <p className="border-t border-border pt-2.5 text-[10.5px] text-muted-foreground">
                Both readings are declared available or not before anything is drawn. Neither ever
                renders a value that was not actually read.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </AuthPageShell>
  );
}
