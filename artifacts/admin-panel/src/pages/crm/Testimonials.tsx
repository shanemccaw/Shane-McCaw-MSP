import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Testimonial {
  id: number;
  projectId: number;
  projectTitle: string;
  projectType: string;
  feedback: string | null;
  permissionGranted: boolean;
  signedAt: string;
  requestedAt: string;
  clientName: string | null;
  clientEmail: string | null;
}

function ProjectTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    retainer: "bg-purple-500/15 text-purple-400",
    project: "bg-[#0078D4]/100/15 text-blue-400",
    "micro-offer": "bg-teal-500/15 text-teal-400",
  };
  const cls = map[type] ?? "bg-[#30363D]/50 text-[#7D8590]";
  const label = type === "micro-offer" ? "Micro-Offer" : type.charAt(0).toUpperCase() + type.slice(1);
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function TestimonialsPage() {
  const { fetchWithAuth } = useAuth();
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/admin/closures/signed")
      .then(r => r.json())
      .then(d => setItems(d as Testimonial[]))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const published = items.filter(i => i.permissionGranted && i.feedback?.trim());
  const signedOff = items.filter(i => !i.permissionGranted || !i.feedback?.trim());

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Testimonials</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Signed project closures. Entries with permission granted appear on the public website.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[#E6EDF3]">No signed closures yet</p>
          <p className="text-xs text-muted-foreground mt-1">Request a closure sign-off from a project's detail page to get started.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {published.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">
                  Published Testimonials ({published.length})
                </h2>
              </div>
              <div className="space-y-4">
                {published.map(item => (
                  <div key={item.id} className="bg-[#161B22] border border-border rounded-xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-[#E6EDF3]">{item.projectTitle}</p>
                          <ProjectTypeBadge type={item.projectType} />
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            Published
                          </span>
                        </div>
                        {item.clientName && (
                          <p className="text-xs text-muted-foreground">{item.clientName} {item.clientEmail ? `· ${item.clientEmail}` : ""}</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0">
                        Signed {new Date(item.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    {item.feedback && (
                      <blockquote className="border-l-4 border-[#0078D4] pl-4 text-sm text-[#E6EDF3]/80 italic leading-relaxed">
                        "{item.feedback}"
                      </blockquote>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {signedOff.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-[#484F58]" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">
                  Signed Off — No Testimonial ({signedOff.length})
                </h2>
              </div>
              <div className="space-y-3">
                {signedOff.map(item => (
                  <div key={item.id} className="bg-[#1C2128] border border-border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#E6EDF3]">{item.projectTitle}</p>
                        <ProjectTypeBadge type={item.projectType} />
                      </div>
                      {item.clientName && (
                        <p className="text-xs text-muted-foreground">{item.clientName}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
