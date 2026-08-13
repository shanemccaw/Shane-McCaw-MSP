/**
 * Response shapes for `artifacts/api-server/src/routes/admin-money.ts`.
 * Kept separate from `moneyStore.ts` for the same reason `zohoTypes.ts` is
 * split out of `crmStore.ts` — the store imports these, components import
 * both.
 */

export interface MoneySaleItem {
  id: string;
  when: string | null;
  who: string;
  what: string;
  amountCents: number;
}

export interface MoneyRetainer {
  id: string;
  who: string;
  what: string;
  monthlyCents: number;
}

export interface MoneyCostFeature {
  label: string;
  cents: number;
}

export interface MoneySummary {
  ok: true;
  mspId: number;
  month: string;
  monthKey: string;
  revenue: { cents: number };
  cost: { cents: number; byFeature: MoneyCostFeature[]; note: string };
  profit: { cents: number };
  lifetimeRevenue: { cents: number };
  sales: { count: number; goal: number; items: MoneySaleItem[] };
  retainers: MoneyRetainer[];
  mrr: { cents: number; goalCents: number };
  streak: number;
  trend: { month: string; label: string; cents: number }[];
}

export interface MoneyGoals {
  goalSales: number;
  mrrGoalCents: number;
  ramp: { month: string; target: number }[];
}

export interface MoneyRampRow {
  month: string;
  label: string;
  target: number;
  actual: number | null;
  worthCents: number;
}

export interface MoneyRamp {
  ok: true;
  mspId: number;
  goalSales: number;
  avgSaleCents: number;
  projectedYearCents: number;
  rows: MoneyRampRow[];
}

export interface MoneyBenchmark {
  key: string;
  label: string;
  targetPct: number;
  direction: "atLeast" | "atMost";
  actualPct: number;
  verdict: "meets" | "below";
}

export interface MoneyBusinessClient {
  who: string;
  mrrCents: number;
  sharePct: number;
}

export interface MoneyBusiness {
  ok: true;
  mspId: number;
  windowMonths: number;
  recurringSharePct: number;
  marginAfterAiCostPct: number;
  clientConcentrationPct: number;
  mrrCents: number;
  benchmarks: MoneyBenchmark[];
  benchmarkNote: string;
  clients: MoneyBusinessClient[];
}

export function usd(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString();
}
