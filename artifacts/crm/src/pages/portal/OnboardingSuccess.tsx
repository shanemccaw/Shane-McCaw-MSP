import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, ArrowRight, Loader2, Calendar, MessageSquare, FolderKanban } from "lucide-react";

export default function OnboardingSuccess() {
  const { user, fetchWithAuth } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sessionId = params.get("session_id") ?? "";

  const [status, setStatus] = useState<"loading" | "paid" | "pending" | "error">("loading");
  const [serviceName, setServiceName] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);

  useEffect(() => {
    if (!user) { setLocation("/"); return; }
    if (!sessionId) { setStatus("error"); return; }

    const check = async () => {
      try {
        const res = await fetchWithAuth(`/api/portal/onboarding/session/${sessionId}`);
        if (!res.ok) { setStatus("error"); return; }
        const data = await res.json() as { status: string; metadata: Record<string, string> };
        setServiceName(data.metadata?.serviceName ?? "your service");
        if (data.status === "paid") {
          setStatus("paid");
          // Find the new project (webhook may still be processing — poll briefly)
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const projRes = await fetchWithAuth("/api/portal/dashboard");
            if (projRes.ok) {
              const dash = await projRes.json() as { projects: Array<{ id: number; title: string }> };
              if (dash.projects?.length > 0) {
                setProjectId(dash.projects[0].id);
                break;
              }
            }
          }
        } else {
          setStatus("pending");
        }
      } catch {
        setStatus("error");
      }
    };

    check().catch(() => setStatus("error"));
  }, [sessionId, user, fetchWithAuth, setLocation]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-[#0078D4] mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Confirming your payment…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
        <div className="max-w-md text-center bg-white border border-border rounded-2xl p-8">
          <p className="text-lg font-bold text-[#0A2540] mb-2">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-6">
            We couldn't confirm your payment status. If you completed payment, you'll receive a confirmation email shortly.
          </p>
          <button
            onClick={() => setLocation("/portal")}
            className="bg-[#0078D4] text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
          >
            Go to portal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
      {/* Header */}
      <div className="bg-[#0A2540]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
          <div className="hidden md:flex items-center gap-6 text-xs text-white/50">
            <span>1. Choose service</span>
            <span>→</span>
            <span>2. Sign agreement</span>
            <span>→</span>
            <span className="text-white font-semibold">3. Pay & confirm</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full text-center">
          {/* Success icon */}
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">
            {status === "paid" ? "You're all set!" : "Payment received"}
          </h1>

          <p className="text-muted-foreground mb-2">
            {status === "paid"
              ? `Your project workspace for ${serviceName} has been created. Shane will reach out within 1 business day to schedule your kickoff call.`
              : "Payment confirmed. Your project will be set up shortly and you'll receive an email with next steps."}
          </p>

          <p className="text-sm text-muted-foreground mb-8">
            A confirmation email has been sent to <strong>{user?.email}</strong>.
          </p>

          {/* What happens next */}
          <div className="bg-white border border-border rounded-2xl p-6 text-left mb-8">
            <h2 className="font-bold text-[#0A2540] mb-4 text-sm">What happens next</h2>
            <div className="space-y-4">
              {[
                {
                  icon: <Calendar className="w-4 h-4 text-[#0078D4]" />,
                  title: "Kickoff call scheduled",
                  desc: "Shane will email you within 1 business day to schedule your kickoff call and confirm any access requirements.",
                },
                {
                  icon: <FolderKanban className="w-4 h-4 text-[#0078D4]" />,
                  title: "Project workspace ready",
                  desc: "Your project is live in the portal. You can track every deliverable step from your dashboard.",
                },
                {
                  icon: <MessageSquare className="w-4 h-4 text-[#0078D4]" />,
                  title: "Direct messaging open",
                  desc: "Use the Messages tab in your portal to communicate directly with Shane throughout the engagement.",
                },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {icon}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#0A2540]">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {projectId && (
              <button
                onClick={() => setLocation(`/portal/projects/${projectId}`)}
                className="flex items-center justify-center gap-2 bg-[#0078D4] text-white font-semibold px-5 py-3 rounded-xl hover:bg-[#005A9E] transition-colors text-sm"
              >
                View your project
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setLocation("/portal")}
              className="flex items-center justify-center gap-2 border border-border bg-white text-[#0A2540] font-semibold px-5 py-3 rounded-xl hover:bg-[#F7F9FC] transition-colors text-sm"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
