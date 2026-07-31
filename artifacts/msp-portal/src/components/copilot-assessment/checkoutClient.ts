/**
 * checkoutClient.ts
 *
 * Client-side call to POST /api/portal/copilot-assessment/checkout (#193) —
 * turns SowScreen.tsx's purchase modal into a real Stripe Checkout Session
 * instead of the fake "order confirmed" toast that used to live in
 * handleConfirmPurchase. Same plain-fetch-wrapper shape as
 * personaGenerationClient.ts/finalReportClient.ts.
 */
import type { SowScopeModule } from './screens/SowScreen';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CheckoutRequest {
  captchaToken: string;
  companyName: string;
  poNumber: string;
  signerName: string;
  readinessScore: number;
  selectedModules: SowScopeModule[];
  creditCents: number;
}

export async function startCopilotAssessmentCheckout(
  fetchWithAuth: FetchWithAuth,
  req: CheckoutRequest,
): Promise<string> {
  const res = await fetchWithAuth('/api/portal/copilot-assessment/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      captchaToken: req.captchaToken,
      companyName: req.companyName,
      poNumber: req.poNumber,
      signerName: req.signerName,
      readinessScore: req.readinessScore,
      creditCents: req.creditCents,
      selectedModules: req.selectedModules.map(m => ({
        id: m.id,
        title: m.title,
        priceCents: Math.round(m.price * 100),
        isRecurring: m.isRecurring === true,
      })),
    }),
  });

  if (!res.ok) {
    let message = `Checkout failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }

  const json = (await res.json()) as { url?: string };
  if (!json.url) {
    throw new Error('Checkout session did not return a redirect URL');
  }
  return json.url;
}
