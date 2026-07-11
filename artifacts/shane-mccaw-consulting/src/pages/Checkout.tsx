import { useState } from "react";
import { Loader2, ArrowLeft, ShieldCheck, ExternalLink } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { CheckoutGate } from "./checkout/CheckoutGate";
import { ServiceCatalog } from "./checkout/ServiceCatalog";
import { useToast } from "@/hooks/use-toast";

type Step = "gate" | "catalog" | "redirecting";

interface SelectedService {
  id: number;
  name: string;
  description: string | null;
  price: number;
  type: string;
}

export default function Checkout() {
  const [step, setStep] = useState<Step>("gate");
  const [email, setEmail] = useState("");
  const [selectedService, setSelectedService] = useState<SelectedService | null>(null);
  const [launching, setLaunching] = useState(false);
  const { toast } = useToast();

  async function launchStripe(service: SelectedService) {
    setLaunching(true);
    try {
      const contractRes = await fetch("/api/portal/onboarding/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          guestEmail: email,
          signerName: email,
          signatureData: "data:image/png;base64,placeholder",
        }),
      });

      if (!contractRes.ok) {
        const err = await contractRes.json().catch(() => ({})) as { error?: string };
        toast({ title: "Unable to start checkout", description: err.error ?? "Please try again.", variant: "destructive" });
        setLaunching(false);
        return;
      }

      const { contractIds } = await contractRes.json() as { contractIds: number[] };

      const sessionRes = await fetch("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds,
          guestEmail: email,
        }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({})) as { error?: string };
        toast({ title: "Checkout error", description: err.error ?? "Unable to start payment. Please try again.", variant: "destructive" });
        setLaunching(false);
        return;
      }

      const { url } = await sessionRes.json() as { url: string };
      if (url) {
        setStep("redirecting");
        window.location.href = url;
      }
    } catch {
      toast({ title: "Network error", description: "Check your connection and try again.", variant: "destructive" });
      setLaunching(false);
    }
  }

  return (
    <Layout>
      <div className="min-h-screen bg-[#F7F9FC] py-16">
        <div className="max-w-2xl mx-auto px-4">
          {/* Progress breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
            <span className={step === "gate" ? "font-semibold text-[#0A2540]" : ""}>1. Verify email</span>
            <span>›</span>
            <span className={step === "catalog" ? "font-semibold text-[#0A2540]" : ""}>2. Choose service</span>
            <span>›</span>
            <span>3. Payment</span>
          </div>

          <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
            {step === "gate" && (
              <CheckoutGate
                onProceed={(e) => { setEmail(e); setStep("catalog"); }}
              />
            )}

            {step === "catalog" && (
              <div className="space-y-6">
                <button
                  onClick={() => setStep("gate")}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#0A2540]"
                >
                  <ArrowLeft className="size-3" /> Back
                </button>

                {selectedService ? (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-semibold text-[#0A2540]">Review & pay</h2>
                      <p className="text-muted-foreground mt-1">You're about to purchase:</p>
                    </div>

                    <div className="border border-border rounded-xl p-4 bg-[#F7F9FC]">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-[#0A2540]">{selectedService.name}</div>
                          {selectedService.description && (
                            <div className="text-sm text-muted-foreground mt-0.5">{selectedService.description}</div>
                          )}
                        </div>
                        <div className="text-primary font-bold text-lg">
                          {(selectedService.price / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 })}
                          {selectedService.type === "retainer" && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                        </div>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground flex items-start gap-2">
                      <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>Purchasing as <strong>{email}</strong>. You'll receive account setup instructions by email.</span>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedService(null)}
                        disabled={launching}
                        className="flex-1"
                      >
                        Change service
                      </Button>
                      <Button
                        onClick={() => launchStripe(selectedService)}
                        disabled={launching}
                        className="flex-1"
                      >
                        {launching ? (
                          <><Loader2 className="mr-2 size-4 animate-spin" /> Preparing checkout…</>
                        ) : (
                          <>Pay now <ExternalLink className="ml-2 size-4" /></>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ServiceCatalog
                    email={email}
                    onSelect={(s) => setSelectedService(s)}
                  />
                )}
              </div>
            )}

            {step === "redirecting" && (
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-[#0A2540] font-medium">Redirecting to secure payment…</p>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Payments are securely processed by Stripe. Your email and payment information are never stored on our servers.
          </p>
        </div>
      </div>
    </Layout>
  );
}
