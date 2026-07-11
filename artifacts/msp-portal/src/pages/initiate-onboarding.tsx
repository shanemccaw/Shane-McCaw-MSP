import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Link2, Copy, Check, ArrowLeft, Info } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";

const schema = z.object({
  customerEmail: z.string().email("Please enter a valid email address"),
  serviceId: z.string().optional(),
  note: z.string().max(500, "Note must be 500 characters or less").optional(),
  ttlHours: z.number().min(1).max(168).default(72),
});

type FormData = z.infer<typeof schema>;

interface GeneratedLink {
  token: string;
  link: string;
  expiresAt: string;
}

export default function InitiateOnboardingPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [generated, setGenerated] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customerEmail: "",
      serviceId: "",
      note: "",
      ttlHours: 72,
    },
  });

  async function handleSubmit(data: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/msp/onboarding/generate-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerEmail: data.customerEmail,
          serviceId: data.serviceId ? parseInt(data.serviceId, 10) : undefined,
          note: data.note || undefined,
          ttlHours: data.ttlHours,
        }),
      });

      const body = await res.json() as (GeneratedLink & { error?: string });
      if (!res.ok) {
        setError(body.error ?? "Failed to generate link. Please try again.");
        return;
      }

      setGenerated(body as GeneratedLink);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback: select the text
    }
  }

  function reset() {
    setGenerated(null);
    form.reset();
  }

  return (
    <DashboardShell>
      <div className="max-w-xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Onboard a new customer</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Generate a single-use link to send to your customer. They complete payment independently.
            </p>
          </div>
        </div>

        {!generated ? (
          <div className="bg-card border border-border rounded-xl p-6">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="customerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer email <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="customer@theirdomain.com"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        The link will be pre-filled with this email. The customer cannot change it.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="serviceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pre-select a service (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Service ID (leave blank to show full catalog)"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        If left blank, the customer will choose from the public service catalog.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Personal note (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Welcome to our services! We've selected the best package for your needs…"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Displayed prominently on the customer's landing page.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ttlHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Link validity</FormLabel>
                      <FormControl>
                        <select
                          className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                        >
                          <option value={24}>24 hours</option>
                          <option value={48}>48 hours</option>
                          <option value={72}>72 hours (default)</option>
                          <option value={120}>5 days</option>
                          <option value={168}>7 days</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Alert className="bg-muted/50">
                  <Info className="size-4" />
                  <AlertDescription className="text-sm">
                    The link is single-use and expires after the selected period. The customer does not
                    need an account — one is created automatically after payment.
                  </AlertDescription>
                </Alert>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" /> Generating…</>
                  ) : (
                    <><Link2 className="mr-2 size-4" /> Generate onboarding link</>
                  )}
                </Button>
              </form>
            </Form>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2 text-green-600">
              <Check className="size-5" />
              <span className="font-semibold">Link generated!</span>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Send this link to your customer:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg break-all font-mono border border-border">
                  {generated.link}
                </code>
                <Button variant="outline" size="icon" onClick={copyLink}>
                  {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                <strong>Expires:</strong>{" "}
                {new Date(generated.expiresAt).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <p>The link can only be used once and cannot be reused after the customer completes checkout.</p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Generate another link
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => navigate("/dashboard")}>
                Back to dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
