import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SuccessStatus {
  status: "provisioned" | "provisioning" | "pending";
  mspId?: number;
  mspName?: string;
  message: string;
  sessionId?: string;
}

export default function SignupSuccessPage() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<SuccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const sessionId = new URLSearchParams(window.location.search).get("session_id") ?? "";

  useEffect(() => {
    if (!sessionId) {
      setError("No session ID found. Please try signing up again.");
      return;
    }

    async function checkStatus() {
      try {
        const res = await fetch(`${BASE}/api/msp/signup/success?session_id=${sessionId}`);
        if (!res.ok) throw new Error("Status check failed");
        const data = await res.json() as SuccessStatus;
        setState(data);
        if (data.status === "provisioning" && pollCount < 12) {
          setTimeout(() => setPollCount(c => c + 1), 5000);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to check status");
      }
    }

    checkStatus();
  }, [sessionId, pollCount]);

  if (error) {
    return (
      <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-sidebar-border bg-card/95">
          <CardContent className="pt-8 flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="size-12 text-destructive" />
            <p className="text-destructive font-medium">{error}</p>
            <Button variant="outline" onClick={() => navigate("/signup")}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-sidebar-foreground">
          <Loader2 className="size-8 animate-spin text-sidebar-primary" />
          <p className="text-sm">Checking your payment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-sidebar-border bg-card/95 backdrop-blur">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <ShieldCheck className="size-10 text-sidebar-primary" />
          </div>
          <CardTitle className="text-xl">
            {state.status === "provisioned" ? "You're all set!" : "Setting up your account…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5 text-center">
          {state.status === "provisioned" ? (
            <>
              <CheckCircle2 className="size-14 text-green-500" />
              <div className="space-y-1">
                {state.mspName && <p className="font-semibold text-lg">{state.mspName}</p>}
                <p className="text-muted-foreground text-sm">{state.message}</p>
              </div>
              <Button onClick={() => navigate("/login")} className="w-full">
                Sign in to your portal
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-14 text-sidebar-primary animate-spin" />
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm">{state.message}</p>
                <p className="text-muted-foreground/60 text-xs">This page will update automatically</p>
              </div>
              {pollCount >= 12 && (
                <p className="text-xs text-muted-foreground">
                  Taking longer than expected? Your payment was confirmed — please{" "}
                  <a href="mailto:support@example.com" className="underline">contact support</a> with your session ID: <code className="text-xs">{sessionId}</code>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
