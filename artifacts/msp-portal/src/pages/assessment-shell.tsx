/**
 * assessment-shell.tsx
 *
 * Minimal landing shell for the Assessment role — the RBAC-foundation scaffold
 * (task 1 of 5). This is deliberately a placeholder: the real assessment
 * wizard / results / SOW / payment surfaces are later tasks and are NOT built
 * here. Its only job is to prove the Assessment-role landing route resolves and
 * to give an Assessment session a coherent, branded page to land on.
 *
 * Layout mirrors the established "no left nav" pattern used for CustomerUser
 * (all wayfinding lives in a top bar with an account/profile menu), but is kept
 * self-contained rather than routing through <AppShell> so it never depends on
 * or touches CustomerUser's shell/sidebar code. It reuses the shared UI
 * primitives (Avatar, DropdownMenu, Button) and the live ThemeProvider.
 */
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Award, LogOut, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";

function initials(name?: string | null, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (email && email.trim()) return email.substring(0, 2).toUpperCase();
  return "U";
}

export default function AssessmentShellPage() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-background">
      {/* Top bar — brand + account/profile menu only (no left nav). */}
      <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur flex items-center gap-3 px-4 md:px-6 sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldCheck className="size-5 text-primary shrink-0" />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-foreground truncate">Assessment</p>
            <p className="text-[10px] text-muted-foreground truncate hidden sm:block">
              Your security &amp; modernization assessment
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 rounded-full p-0.5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-transform active:scale-95"
                aria-label="User profile menu"
                title={user?.name ?? user?.email ?? "User profile"}
              >
                <Avatar className="size-8 border border-border/60 shadow-sm">
                  <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                    {initials(user?.name, user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2">
              <DropdownMenuLabel className="font-normal p-2">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold leading-none text-foreground truncate">
                    {user?.name ?? user?.email ?? "User Account"}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground truncate">
                    {user?.email}
                  </p>
                  {user?.mspRole && (
                    <div className="pt-1">
                      <Badge className="text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground">
                        {user.mspRole}
                      </Badge>
                    </div>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {/* Dark mode toggle — wired to the live ThemeProvider. preventDefault
                  keeps the menu open when toggling. */}
              <DropdownMenuItem
                className="cursor-pointer gap-2 py-2"
                onSelect={(e) => {
                  e.preventDefault();
                  setTheme(isDark ? "light" : "dark");
                }}
              >
                {isDark ? (
                  <Sun className="size-4 text-muted-foreground" />
                ) : (
                  <Moon className="size-4 text-muted-foreground" />
                )}
                <span className="flex-1">Dark Mode</span>
                <span
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    isDark ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`inline-block size-3 rounded-full bg-white transition-transform ${
                      isDark ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="cursor-pointer gap-2 py-2 text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                onSelect={() => void logout()}
              >
                <LogOut className="size-4" />
                <span>Log Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Placeholder body — the real assessment experience is built in later tasks. */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 px-6 py-24 text-center">
          <div className="size-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Assessment Dashboard</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            Your assessment experience is being prepared. This is where your scan
            progress, findings, reports, and statement of work will appear.
          </p>
          <Badge className="bg-primary/10 text-primary border-none">Coming Soon</Badge>
        </div>
      </main>

      {/* Credibility footer — matches the rest of the portal. */}
      <footer className="shrink-0 border-t border-border bg-background/60 px-6 py-3 z-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Award className="size-3.5 text-primary shrink-0" />
            <span>
              Modernization delivered by a{" "}
              <span className="text-foreground font-medium">
                30-Year Microsoft Veteran &amp; M365 Architect for NASA
              </span>
            </span>
          </div>
          <span className="shrink-0">
            Powered by{" "}
            <span className="text-foreground font-medium">Shane McCaw Consulting</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
