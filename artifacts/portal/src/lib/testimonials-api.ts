/**
 * React Query hooks + real fetch actions for the customer-facing Testimonials
 * submission surface (#3894, Feature #3436, part of #1485). Wired against the
 * real, live endpoints documented in `docs/portal/testimonials-contract-pack.md`
 * (#3893) and confirmed directly against
 * `artifacts/api-server/src/routes/portal-testimonials.ts`:
 *
 *   GET  /api/portal/testimonials/prompt-due   — whether the shell should prompt now
 *   GET  /api/portal/testimonials              — the requesting login's own submission history
 *   POST /api/portal/testimonials               — submit a new one
 *
 * No fixture module, no fallback data. `[]` / `due: false` are real responses,
 * never a placeholder.
 *
 * STUB UI PENDING DESIGN REVIEW (#3894) — no `Design/portal/` export exists for
 * this surface yet; Shane authorized a real stub against the live contract
 * rather than continuing to wait (2026-09-15). Expect this page/these
 * components to be redrawn once a real design lands.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";

export const TESTIMONIAL_KINDS = ["testimonial", "feedback", "suggestion"] as const;
export type TestimonialKind = (typeof TESTIMONIAL_KINDS)[number];

export interface WireTestimonialSummary {
  id: number;
  body: string;
  kind: TestimonialKind;
  permissionToPublish: boolean;
  createdAt: string;
}

export interface WireTestimonialPromptDue {
  due: boolean;
  customerStartedAt: string;
  lastSubmissionAt: string | null;
}

interface ApiErrorBody {
  error?: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const QK = {
  promptDue: ["portal", "testimonials", "prompt-due"] as const,
  history: ["portal", "testimonials", "history"] as const,
};

export function useTestimonialPromptDue() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.promptDue,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/testimonials/prompt-due", undefined, { silent: true });
      return parseJsonOrThrow<WireTestimonialPromptDue>(res);
    },
  });
}

export function useTestimonialHistory() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.history,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/testimonials", undefined, { silent: true });
      return parseJsonOrThrow<WireTestimonialSummary[]>(res);
    },
  });
}

export function useSubmitTestimonial() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string; kind: TestimonialKind; permissionToPublish: boolean }) => {
      const res = await fetchWithAuth(
        "/api/portal/testimonials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        { silent: true },
      );
      return parseJsonOrThrow<WireTestimonialSummary>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.history });
      void queryClient.invalidateQueries({ queryKey: QK.promptDue });
    },
  });
}
