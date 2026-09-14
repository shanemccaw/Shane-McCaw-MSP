import type { ReactNode } from "react";

/**
 * Shared chrome for the 3 designed Signup/Agreement/Invite scenes (#3992,
 * Feature #1649) — `Design/portal/design_handoff_full_site/screens/Signup
 * Agreement and Invite.dc.html`'s own top bar: brand mark, brand text, and a
 * right-aligned status dot + line naming what this screen actually is (e.g.
 * "Public · tiers read live · agreement not published"). Forces `dark` for
 * the same reason AuthPageShell does — there is no signed-in user yet to
 * have a light/dark preference, and the design fixes this to `#020617`.
 */
export function SignupFlowShell({
  brand,
  statusLine,
  maxWidthClassName = "max-w-[600px]",
  children,
}: {
  brand: string;
  statusLine: string;
  maxWidthClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2.5 px-7 pt-[18px]">
        <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-status-blue text-[10px] font-extrabold text-primary-foreground">
          SM
        </span>
        <span className="text-[13px] font-semibold text-foreground">{brand}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-green" />
          {statusLine}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center gap-3.5 px-6 py-8 pb-14">
        <div className={`flex w-full flex-col gap-4 ${maxWidthClassName}`}>{children}</div>
      </div>
    </div>
  );
}
