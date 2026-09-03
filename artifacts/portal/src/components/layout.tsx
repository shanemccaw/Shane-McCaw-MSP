import { PortalShell } from "@/components/shell/PortalShell";

/**
 * The portal's real application chrome (Git #1819) — top bar, six-pillar tab
 * strip, sidebar module nav, content slot and the frame-level severity wash.
 * See `components/shell/PortalShell.tsx` for the implementation and
 * build-journal/1819.md for what this issue deliberately left for #1820-#1824
 * to build inside it.
 */
export function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
