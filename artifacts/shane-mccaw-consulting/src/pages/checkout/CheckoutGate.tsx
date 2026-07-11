import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  _hp: z.string().max(0, ""),
});

type FormData = z.infer<typeof schema>;

interface GateResult {
  action: "proceed" | "redirect";
  portalUrl?: string;
  mspName?: string;
}

interface Props {
  onProceed: (email: string) => void;
}

export function CheckoutGate({ onProceed }: Props) {
  const [checking, setChecking] = useState(false);
  const [redirectInfo, setRedirectInfo] = useState<{ portalUrl: string; mspName: string } | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", _hp: "" },
  });

  async function handleSubmit(data: FormData) {
    setChecking(true);
    try {
      const res = await fetch("/api/public/checkout/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, _hp: data._hp }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        form.setError("email", { message: err.error ?? "Unable to verify your email. Please try again." });
        return;
      }

      const result = await res.json() as GateResult;

      if (result.action === "redirect" && result.portalUrl) {
        setRedirectInfo({ portalUrl: result.portalUrl, mspName: result.mspName ?? "your provider" });
        return;
      }

      onProceed(data.email);
    } catch {
      form.setError("email", { message: "Network error. Please check your connection and try again." });
    } finally {
      setChecking(false);
    }
  }

  if (redirectInfo) {
    return (
      <div className="text-center space-y-4 py-8">
        <ShieldCheck className="mx-auto size-12 text-primary" />
        <h2 className="text-2xl font-semibold text-[#0A2540]">You already have an account</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Your account is managed by <strong>{redirectInfo.mspName}</strong>. Sign in to their portal
          to manage your services or purchase new ones.
        </p>
        <Button asChild className="mt-2">
          <a href={redirectInfo.portalUrl} target="_blank" rel="noopener noreferrer">
            Go to my portal <ArrowRight className="ml-2 size-4" />
          </a>
        </Button>
        <p className="text-sm text-muted-foreground">
          Not your account?{" "}
          <button
            onClick={() => { setRedirectInfo(null); form.reset(); }}
            className="underline text-primary"
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-[#0A2540]">Get started</h2>
        <p className="text-muted-foreground mt-1">Enter your work email to begin checkout.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {/* Honeypot — hidden from users, filled by bots */}
          <div className="hidden" aria-hidden="true">
            <FormField
              control={form.control}
              name="_hp"
              render={({ field }) => <input {...field} tabIndex={-1} autoComplete="off" />}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={checking} className="w-full">
            {checking ? (
              <><Loader2 className="mr-2 size-4 animate-spin" /> Checking…</>
            ) : (
              <>Continue <ArrowRight className="ml-2 size-4" /></>
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
