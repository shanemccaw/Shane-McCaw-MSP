import { KeyRound, ClipboardCheck, Database, Sparkles, DollarSign, Compass } from 'lucide-react';
import type { PublicService } from '@/hooks/useServices';

export type ZoneKey = 'identity' | 'compliance' | 'data' | 'copilot' | 'cost' | 'bigpicture';

export interface ZoneDef {
  key: ZoneKey;
  label: string;
  blurb: string;
  icon: typeof KeyRound;
}

// 6 zones, real assignment confirmed against all 21 real assessment rows
// (services.id 13-33, see lib/db/migrations/manual/2026-07-20-assessment-detail-content.sql).
// Matched by exact service name — do not re-derive or guess a different grouping.
// Shared by Assessments.tsx (full zone browsing) and Home.tsx (paid-assessments
// category filter) so both surfaces agree on the same taxonomy.
export const ZONES: ZoneDef[] = [
  { key: 'identity', label: 'Identity & Access', blurb: 'Who has access, and whether it’s actually controlled.', icon: KeyRound },
  { key: 'compliance', label: 'Compliance', blurb: 'Map your tenant against SOC 2, NIST CSF, ISO 27001, or CMMC.', icon: ClipboardCheck },
  { key: 'data', label: 'Data & Collaboration', blurb: 'SharePoint, Teams, Exchange, and how openly data is shared.', icon: Database },
  { key: 'copilot', label: 'Copilot Readiness', blurb: 'Whether your tenant is actually ready for Copilot.', icon: Sparkles },
  { key: 'cost', label: 'Cost & Licensing', blurb: 'What you’re paying for versus what’s actually being used.', icon: DollarSign },
  { key: 'bigpicture', label: 'Big Picture', blurb: 'The whole tenant, ranked and prioritized, fast.', icon: Compass },
];

export const ZONE_ASSIGNMENTS: Record<ZoneKey, string[]> = {
  identity: [
    'Security Posture Assessment',
    'Conditional Access Assessment',
    'Entra ID / Identity Assessment',
    'Intune / Device Management Assessment',
  ],
  compliance: [
    'Compliance Framework Mapping Audit — SOC 2',
    'Compliance Framework Mapping Audit — NIST CSF',
    'Compliance Framework Mapping Audit — ISO 27001',
    'Compliance Framework Mapping Audit — CMMC Level 1-2',
  ],
  data: [
    'Data Governance Assessment',
    'Copilot Data Exposure Assessment',
    'SharePoint Assessment',
    'Teams Assessment',
    'Exchange Online Assessment',
  ],
  copilot: ['Copilot Readiness Snapshot', 'Copilot Readiness Assessment'],
  cost: ['License Waste Audit', 'License & Cost Optimization Assessment'],
  bigpicture: [
    'Tenant Governance Snapshot',
    'M365 Tenant Health Audit',
    'Migration Readiness Assessment',
    'Adoption & Change Management Maturity Assessment',
  ],
};

const NAME_TO_ZONE: Record<string, ZoneKey> = {};
for (const [zoneKey, names] of Object.entries(ZONE_ASSIGNMENTS) as [ZoneKey, string[]][]) {
  for (const name of names) {
    NAME_TO_ZONE[name.trim().toLowerCase()] = zoneKey;
  }
}

export function getZoneForService(service: PublicService): ZoneKey | null {
  return NAME_TO_ZONE[service.name.trim().toLowerCase()] ?? null;
}
