export interface Invoice {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  pdfFilename: string | null;
  createdAt: string;
}

export interface StripeReceipt {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  status: string;
  date: number;
  invoicePdf: string | null;
}

export type BillingInterval = "month" | "year";

/** Row from GET /api/portal/billing/retainer-intervals, keyed by clientServiceId. */
export interface RetainerIntervalInfo {
  clientServiceId: number;
  billingInterval: BillingInterval;
  pendingBillingInterval: BillingInterval | null;
  hasPendingSwitch: boolean;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
}

export interface Subscription {
  id: number;
  serviceId: number;
  serviceName: string;
  serviceSlug: string | null;
  status: string;
  startDate: string | null;
  purchasedAt: string;
  stripeSubscriptionId: string | null;
  stripe: {
    status: string;
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;
    billingCycleAnchor: number | null;
    currentPeriodEnd: number | null;
    amount: number | null;
    currency: string | null;
  } | null;
  /** Merged client-side from /billing/retainer-intervals; null until loaded. */
  intervalInfo?: RetainerIntervalInfo | null;
}

export interface MspProfile {
  name: string;
}
