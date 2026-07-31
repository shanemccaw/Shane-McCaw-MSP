/**
 * remediationDetailClient.ts
 *
 * Client-side call to POST /api/portal/copilot-assessment/remediation-detail
 * (#195) — fetches real AI-generated "what this means" detail + remediation
 * steps for one finding. Same plain-fetch-wrapper convention as
 * personaGenerationClient.ts; UseCaseIssueModal owns the resulting
 * detail/steps in its own local state, so this isn't a self-contained hook.
 */
import type { IssueCategory, IssueSeverity } from './UseCaseIssueModal';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RemediationIssue {
  label: string;
  category: IssueCategory;
  severity: IssueSeverity;
}

/**
 * Optional real grounding context — every field optional because not every
 * caller has real data to supply. See remediation-detail-generator.ts's own
 * audit note for which screens have what.
 */
export interface RemediationContext {
  role?: string;
  department?: string;
  industry?: string;
  personaName?: string;
  personaRole?: string;
  useCaseCluster?: string;
  collaborationPattern?: string[];
  sensitivitySet?: string[];
}

export interface RemediationStep {
  text: string;
  code?: string;
}

export interface RemediationDetailResult {
  detail: string;
  steps: RemediationStep[];
}

export async function fetchRemediationDetail(
  fetchWithAuth: FetchWithAuth,
  issue: RemediationIssue,
  context?: RemediationContext,
): Promise<RemediationDetailResult> {
  const res = await fetchWithAuth('/api/portal/copilot-assessment/remediation-detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ issue, context }),
  });

  if (!res.ok) {
    let message = `Remediation guidance failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }

  const json = (await res.json()) as Partial<RemediationDetailResult>;
  if (typeof json.detail !== 'string' || !Array.isArray(json.steps) || json.steps.length === 0) {
    throw new Error('Remediation guidance returned an unexpected shape');
  }
  return { detail: json.detail, steps: json.steps };
}
