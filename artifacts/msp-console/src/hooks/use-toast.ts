import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

/**
 * Adapter for code relocated from admin-panel (Git #4246), which calls the
 * shadcn `toast({ title, description, variant })` shape backed by its own
 * `Toaster`. msp-console already mounts a single `sonner` `Toaster`
 * (`App.tsx`) as its one toast surface — this maps the old call shape onto
 * it instead of bringing over a second, competing toast stack.
 */
interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
}

export function useToast() {
  return {
    toast: ({ title, description, variant }: ToastOptions) => {
      const fn = variant === "destructive" ? sonnerToast.error : sonnerToast.success;
      fn(title as string, description ? { description } : undefined);
    },
  };
}
