import { cn } from "@/lib/utils";

// Minimal portal chrome. Pages are rebuilt one at a time under their own issues
// (#1648-1671) against the designs in Design/portal/; this shell only provides
// the outer frame they render into.
export function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("min-h-screen bg-background text-foreground")}>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
