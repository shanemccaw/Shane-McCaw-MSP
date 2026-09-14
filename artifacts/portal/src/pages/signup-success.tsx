import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { SignupFlowShell } from "@/components/auth/SignupFlowShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchSignupSuccess, type SignupSuccessResponse } from "@/lib/msp-signup-api";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 12; // ~60s, matches the archived page's own bound

interface Step {
  label: string;
  state: "done" | "now" | "todo";
}

function stepsFor(status: SignupSuccessResponse["status"]): Step[] {
  const stage = { pending: 0, provisioning: 1, provisioned: 2 }[status];
  const labels = ["Payment confirmed", "Provider account created", "Agreement recorded"];
  return labels.map((label, i) => ({
    label,
    state: i < stage ? "done" : i === stage ? "now" : "todo",
  }));
}

/**
 * Signup success — polls the real three-state response (#3992, Feature
 * #1649). Wired to GET /api/msp/signup/success per the contract pack: the
 * MSP row and the agreement-acceptance row are both written by the billing
 * webhook, never by this page or by /start, so "provisioned" is the only
 * honest success signal. Design: `Signup Agreement and Invite.dc.html`,
 * scene "success".
 */
export default function SignupSuccessPage() {
  const [, navigate] = useLocation();
  const sessionId = new URLSearchParams(window.location.search).get("session_id") ?? "";

  const [state, setState] = useState<SignupSuccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollCountRef = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setError("No session ID found. Please try signing up again.");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const data = await fetchSignupSuccess(sessionId);
        if (cancelled) return;
        setState(data);
        if (data.status !== "provisioned" && pollCountRef.current < MAX_POLLS) {
          pollCountRef.current += 1;
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to check status");
      }
    }
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (error) {
    return (
      <SignupFlowShell brand="Shane McCaw Consulting" statusLine="Public · payment status">
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <AlertTriangle className="size-11 text-destructive" />
          <span className="text-sm font-medium text-destructive">{error}</span>
          <Button asChild variant="outline">
            <Link href="/signup">Try again</Link>
          </Button>
        </Card>
      </SignupFlowShell>
    );
  }

  const polling = !state || state.status !== "provisioned";
  const provisioned = state?.status === "provisioned";
  const timedOut = polling && pollCountRef.current >= MAX_POLLS;
  const title = !state
    ? "Checking your payment…"
    : state.status === "pending"
      ? "Waiting for payment confirmation"
      : state.status === "provisioning"
        ? "Payment confirmed — setting up your account"
        : (state.mspName ?? "Your provider account") + " is ready";

  return (
    <SignupFlowShell brand="Shane McCaw Consulting" statusLine="Public · polling the payment session">
      <Card className="flex flex-col gap-3.5 p-6">
        <div className="flex items-center gap-3">
          {polling ? (
            <span className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-status-blue/25 bg-status-blue/10">
              <Loader2 className="size-4 animate-spin text-status-blue" />
            </span>
          ) : (
            <span className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-status-green/25 bg-status-green/10">
              <CheckCircle2 className="size-[18px] text-status-green" />
            </span>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[19px] font-bold tracking-tight text-foreground">{title}</span>
            {state ? (
              <span className="font-mono text-[11px] text-muted-foreground">status: {state.status}</span>
            ) : null}
          </div>
        </div>
        {state ? <span className="text-[12.5px] leading-relaxed text-muted-foreground">{state.message}</span> : null}
        {state ? (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            {stepsFor(state.status).map((s) => (
              <div key={s.label} className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 size-1.5 flex-none rounded-full ${
                    s.state === "done" ? "bg-status-green" : s.state === "now" ? "bg-status-blue" : "bg-border"
                  }`}
                />
                <span className={`text-xs leading-relaxed ${s.state === "todo" ? "text-muted-foreground" : "text-foreground/85"}`}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {timedOut ? (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Taking longer than expected? Your payment was confirmed — please{" "}
            <a href="mailto:shane@shanemccawconsulting.com" className="text-primary hover:underline">
              contact support
            </a>{" "}
            with your session ID: <code className="text-[10.5px]">{sessionId}</code>
          </p>
        ) : null}
        {provisioned ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-3.5">
            <Button className="ml-auto flex-none" onClick={() => navigate("/login")}>
              Open the MSP console
            </Button>
          </div>
        ) : null}
      </Card>
    </SignupFlowShell>
  );
}
