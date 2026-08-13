import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Loader2, ShieldCheck, AlertTriangle, ArrowRight, ExternalLink } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface MspInfo {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

interface LinkData {
  token: string;
  customerEmail: string;
  serviceId: number | null;
  note: string | null;
  redirectPortalUrl: string | null;
  expiresAt: string;
  msp: MspInfo;
}

interface PublicService {
  id: number;
  name: string;
  description: string | null;
  price: number;
  type: string;
  features?: string[];
}

type Status = "loading" | "ready" | "error" | "used" | "expired" | "launching" | "redirecting";

function formatPrice(cents: number, type: string) {
  const dollars = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
  return type === "retainer" ? `${dollars}/mo` : dollars;
}

export default function OnboardingLink() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [status, setStatus] = useState<Status>("loading");
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [service, setService] = useState<PublicService | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) { setStatus("error"); setErrorMessage("No token provided."); return; }

    void (async () => {
      try {
        const res = await fetch(`/api/public/onboarding/link/${encodeURIComponent(token)}`);
        const body = await res.json() as (LinkData & { error?: string });

        if (res.status === 410) {
          const msg = body.error ?? "";
          setStatus(msg.toLowerCase().includes("used") ? "used" : "expired");
          setErrorMessage(body.error ?? "");
          return;
        }

        if (!res.ok) {
          setStatus("error");
          setErrorMessage(body.error ?? "This link is invalid.");
          return;
        }

        setLinkData(body as LinkData);

        if ((body as LinkData).serviceId) {
          try {
            const svcRes = await fetch(`/api/portal/onboarding/service/${(body as LinkData).serviceId}`);
            if (svcRes.ok) {
              const svcData = await svcRes.json() as PublicService;
              setService(svcData);
            }
          } catch {
            // non-fatal — service detail is optional
          }
        }

        setStatus("ready");
      } catch {
        setStatus("error");
        setErrorMessage("Unable to load this link. Please check your internet connection and try again.");
      }
    })();
  }, [token]);

  async function proceedToCheckout() {
    if (!linkData) return;
    setStatus("launching");

    try {
      if (service) {
        const contractRes = await fetch("/api/portal/onboarding/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            guestEmail: linkData.customerEmail,
            signerName: linkData.customerEmail,
            signatureData: "data:image/png;base64,placeholder",
          }),
        });

        if (!contractRes.ok) {
          const err = await contractRes.json().catch(() => ({})) as { error?: string };
          toast({ title: "Unable to start checkout", description: err.error ?? "Please try again.", variant: "destructive" });
          setStatus("ready");
          return;
        }

        const { contractIds } = await contractRes.json() as { contractIds: number[] };

        const sessionRes = await fetch("/api/portal/checkout/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            contractIds,
            guestEmail: linkData.customerEmail,
          }),
        });

        if (!sessionRes.ok) {
          const err = await sessionRes.json().catch(() => ({})) as { error?: string };
          toast({ title: "Checkout error", description: err.error ?? "Unable to start payment. Please try again.", variant: "destructive" });
          setStatus("ready");
          return;
        }

        const { url } = await sessionRes.json() as { url: string };
        if (url) {
          setStatus("redirecting");
          window.location.href = url;
          return;
        }
      } else {
        navigate("/checkout");
      }
    } catch {
      toast({ title: "Network error", description: "Check your connection and try again.", variant: "destructive" });
      setStatus("ready");
    }
  }

  const brandColor = linkData?.msp.primaryColor ?? "#0078D4";

  return (
    <Layout>
      <div className="min-h-screen bg-[#F7F9FC] py-16">
        <div className="max-w-xl mx-auto px-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading your invitation…</p>
            </div>
          )}

          {(status === "error" || status === "used" || status === "expired") && (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
              <AlertTriangle className="mx-auto size-12 text-amber-500" />
              <h1 className="text-2xl font-semibold text-[#0A2540]">
                {status === "used" ? "Link already used" : status === "expired" ? "Link expired" : "Invalid link"}
              </h1>
              <p className="text-muted-foreground">{errorMessage}</p>
              <Button variant="outline" onClick={() => navigate("/checkout")}>
                Go to checkout instead
              </Button>
            </div>
          )}

          {(status === "ready" || status === "launching" || status === "redirecting") && linkData && (
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              {/* MSP header band */}
              <div
                className="px-8 py-5 text-white flex items-center gap-3"
                style={{ backgroundColor: brandColor }}
              >
                {linkData.msp.logoUrl ? (
                  <img src={linkData.msp.logoUrl} alt={linkData.msp.name} className="h-8 object-contain" />
                ) : (
                  <ShieldCheck className="size-6" />
                )}
                <span className="font-semibold text-lg">{linkData.msp.name}</span>
              </div>

              <div className="p-8 space-y-6">
                <div>
                  <h1 className="text-2xl font-semibold text-[#0A2540]">You've been invited</h1>
                  <p className="text-muted-foreground mt-1">
                    <strong>{linkData.msp.name}</strong> has set up an onboarding package for{" "}
                    <strong>{linkData.customerEmail}</strong>.
                  </p>
                </div>

                {linkData.note && (
                  <div className="bg-[#F7F9FC] rounded-xl p-4 border border-border">
                    <p className="text-sm text-muted-foreground italic">"{linkData.note}"</p>
                    <p className="text-xs text-muted-foreground mt-2">— {linkData.msp.name}</p>
                  </div>
                )}

                {service ? (
                  <div className="border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-[#0A2540]">{service.name}</div>
                        {service.description && (
                          <div className="text-sm text-muted-foreground mt-0.5">{service.description}</div>
                        )}
                        {service.features && service.features.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {service.features.slice(0, 4).map((f, i) => (
                              <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                                <span className="text-primary">✓</span> {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-bold text-primary">
                          {formatPrice(service.price, service.type)}
                        </div>
                        <Badge variant="outline" className="text-xs capitalize mt-1">
                          {service.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#F7F9FC] rounded-xl p-4 border border-border text-sm text-muted-foreground">
                    A service package has been pre-selected for you. You'll see full details at checkout.
                  </div>
                )}

                <div className="text-sm text-muted-foreground flex items-start gap-2">
                  <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    Your account will be created automatically. You'll receive setup instructions by email
                    after completing payment.
                  </span>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={proceedToCheckout}
                  disabled={status === "launching" || status === "redirecting"}
                  style={{ backgroundColor: brandColor, borderColor: brandColor }}
                >
                  {status === "launching" || status === "redirecting" ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" /> Preparing payment…</>
                  ) : (
                    <>Proceed to payment <ArrowRight className="ml-2 size-4" /></>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  This invitation expires on{" "}
                  {new Date(linkData.expiresAt).toLocaleDateString("en-US", {
                    month: "long", day: "numeric", year: "numeric",
                  })}.
                  Payments processed securely by Stripe.{" "}
                  <ExternalLink className="inline size-3" />
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
