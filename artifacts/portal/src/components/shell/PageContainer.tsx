import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The one page-level container for every page rendered in the shell's content
 * slot (`PortalShell.tsx`, a bare unpadded flex row). The slot supplies no
 * padding, so each page owns it — through this component rather than a
 * copy-pasted class string (#4770 / #4827).
 *
 * `min-w-0 flex-1` makes the page fill the slot's flex row; `px-[26px] py-5`
 * is the padding Overview established. Pass `className` only for layout
 * additions (`relative`, a centred `mx-auto max-w-[...]` column); every other
 * div prop (`data-testid`, `style`, `data-*`) is forwarded untouched.
 */
export function PageContainer({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5", className)} {...rest} />;
}
