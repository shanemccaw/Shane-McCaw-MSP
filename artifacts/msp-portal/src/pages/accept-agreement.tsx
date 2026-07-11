import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, Loader2, FileText } from "lucide-react";
import { Label } from "@/components/ui/label";

interface AgreementData {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: string;
}

export default function AcceptAgreementPage() {
  const { fetchWithAuth, logout } = useAuth();
  const [, navigate] = useLocation();

  const [agreement, setAgreement] = useState<AgreementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform/agreement/current")
      .then((r) => r.json())
      .then((data: { agreement: AgreementData | null }) => {
        setAgreement(data.agreement);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  async function handleAccept() {
    if (!checked) {
      setError("Please confirm you have read and agree to the terms.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetchWithAuth("/api/platform/agreement/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkboxConfirmed: true }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to record acceptance. Please try again.");
        return;
      }

      navigate("/dashboard");
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    await logout();
    navigate("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar">
        <Loader2 className="size-6 animate-spin text-sidebar-foreground/50" />
      </div>
    );
  }

  if (!agreement) {
    // No published agreement — allow through
    navigate("/dashboard");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-2xl space-y-5">
        <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
          <ShieldCheck className="size-10 text-sidebar-primary" />
          <h1 className="text-xl font-semibold tracking-tight">MSP Platform</h1>
          <p className="text-sm text-sidebar-foreground/60">Powered by Shane McCaw Consulting</p>
        </div>

        <Card className="border-sidebar-border bg-card/95 backdrop-blur">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <CardTitle className="text-base">{agreement.title}</CardTitle>
            </div>
            <CardDescription>
              Version {agreement.version} — Please read and accept to continue
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <ScrollArea className="h-64 rounded-md border border-border bg-muted/40 p-4">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                {agreement.body}
              </pre>
            </ScrollArea>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
              <Checkbox
                id="agree"
                checked={checked}
                onCheckedChange={(v) => setChecked(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="agree" className="text-sm leading-relaxed cursor-pointer">
                I have read, understood, and agree to the{" "}
                <strong>{agreement.title}</strong> (version {agreement.version}).
                I confirm I am authorised to bind my organisation to this agreement.
              </Label>
            </div>
          </CardContent>

          <CardFooter className="flex gap-3 pt-2">
            <Button
              className="flex-1"
              onClick={handleAccept}
              disabled={!checked || submitting}
            >
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {submitting ? "Recording…" : "Accept &amp; Continue"}
            </Button>
            <Button
              variant="outline"
              onClick={handleDecline}
              disabled={submitting}
            >
              Decline &amp; sign out
            </Button>
          </CardFooter>
        </Card>

        <p className="text-center text-xs text-sidebar-foreground/40">
          Acceptance is recorded with your user ID, timestamp, IP address, and agreement version.
        </p>
      </div>
    </div>
  );
}
