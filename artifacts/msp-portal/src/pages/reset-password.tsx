import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, CheckCircle2 } from "lucide-react";

const schema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type FormData = z.infer<typeof schema>;

interface ResetPasswordResponse {
  ok?: boolean;
  error?: string;
}

export default function ResetPasswordPage() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [, navigate] = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password: data.password }),
      });
      const json = (await res.json()) as ResetPasswordResponse;
      if (!res.ok) {
        setServerError(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch {
      setServerError("A network error occurred. Please try again.");
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
            <ShieldCheck className="size-10 text-sidebar-primary" />
            <h1 className="text-xl font-semibold tracking-tight">MSP Platform</h1>
            <p className="text-sm text-sidebar-foreground/60">Powered by Shane McCaw Consulting</p>
          </div>
          <Card className="border-sidebar-border bg-card/95 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Invalid link</CardTitle>
              <CardDescription>
                This reset link is missing or malformed. Please request a new one, or contact
                support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
            <CheckCircle2 className="size-10 text-emerald-400" />
            <h1 className="text-xl font-semibold tracking-tight">Password updated!</h1>
            <p className="text-sm text-sidebar-foreground/60">Taking you to sign in…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
          <ShieldCheck className="size-10 text-sidebar-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
          <p className="text-sm text-sidebar-foreground/60">Choose a new password below</p>
        </div>

        <Card className="border-sidebar-border bg-card/95 backdrop-blur">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg">New password</CardTitle>
            <CardDescription>
              Choose a secure password — at least 8 characters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {serverError && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  {...register("confirm")}
                />
                {errors.confirm && (
                  <p className="text-xs text-destructive">{errors.confirm.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isSubmitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-sidebar-foreground/40 space-x-3">
          <span>Access is provisioned by your administrator</span>
          <span>·</span>
          <a href="/portal/trust" className="hover:text-sidebar-foreground/70 underline">
            Trust &amp; Privacy
          </a>
        </div>
      </div>
    </div>
  );
}
