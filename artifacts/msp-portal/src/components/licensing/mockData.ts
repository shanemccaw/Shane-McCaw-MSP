import { SkuItem, HygieneDeptRow, PriorityInsight, AutomationCandidate, AffectedUser } from '../types';

export const INITIAL_SKUS: SkuItem[] = [
  {
    id: 'm365-e5',
    name: 'M365 E5',
    utilizationPercent: 94,
    assignedCount: 1410,
    unassignedCount: 90,
    totalCount: 1500,
    monthlyCostPerSeat: 57,
    category: 'Enterprise Productivity'
  },
  {
    id: 'm365-e3',
    name: 'M365 E3',
    utilizationPercent: 78,
    assignedCount: 1950,
    unassignedCount: 550,
    totalCount: 2500,
    monthlyCostPerSeat: 36,
    category: 'Enterprise Productivity'
  },
  {
    id: 'd365-pro',
    name: 'Dynamics 365 Professional',
    utilizationPercent: 42,
    assignedCount: 252,
    unassignedCount: 348,
    totalCount: 600,
    monthlyCostPerSeat: 65,
    category: 'Business Applications'
  }
];

export const INITIAL_HYGIENE_MATRIX: HygieneDeptRow[] = [
  { department: 'Finance', inactive: 24, disabled: 8, overlap: 2 },
  { department: 'Eng', inactive: 5, disabled: 31, overlap: 18 },
  { department: 'HR', inactive: 2, disabled: 1, overlap: 9 },
  { department: 'Sales', inactive: 56, disabled: 12, overlap: 4 }
];

export const INITIAL_PRIORITY_INSIGHTS: PriorityInsight[] = [
  {
    id: 1,
    title: 'E5 SKUs Inactive > 90 Days',
    description: '85 accounts holding high-cost licenses with zero telemetry in past 90 days.',
    severity: 'high',
    affectedCount: 85,
    potentialSavings: '$4,845/mo',
    skuTarget: 'M365 E5'
  },
  {
    id: 2,
    title: 'Double-License Overlap',
    description: 'Sales Dept has 12 users assigned both E3 and E5 licenses simultaneously.',
    severity: 'high',
    affectedCount: 12,
    potentialSavings: '$432/mo',
    skuTarget: 'M365 E3'
  },
  {
    id: 3,
    title: 'Copilot Upsell Target',
    description: '400 users actively utilizing advanced AI features on standard E3 licenses.',
    severity: 'medium',
    affectedCount: 400,
    potentialSavings: 'Productivity Boost',
    skuTarget: 'Copilot for M365'
  },
  {
    id: 4,
    title: 'Terminated User Residuals',
    description: '14 disabled or offboarded users still assigned active Power BI Pro seats.',
    severity: 'low',
    affectedCount: 14,
    potentialSavings: '$140/mo',
    skuTarget: 'Power BI Pro'
  }
];

export const INITIAL_AUTOMATION_CANDIDATES: AutomationCandidate[] = [
  {
    id: 'auto-reclaim-inactive',
    type: 'DELETE',
    confidence: 98,
    title: 'Auto-reclaim Inactive',
    description: 'Reclaim licenses from users inactive for > 30 days. Estimated monthly savings: $4.2K.',
    estimatedMonthlySavings: '$4.2K',
    icon: 'rocket_launch',
    status: 'idle'
  },
  {
    id: 'auto-optimize-skus',
    type: 'PATCH',
    confidence: 85,
    title: 'Auto-optimize SKUs',
    description: 'Downgrade E5 to E3 where advanced features are never utilized. Estimated savings: $8.9K.',
    estimatedMonthlySavings: '$8.9K',
    icon: 'auto_fix_high',
    status: 'idle'
  },
  {
    id: 'copilot-auto-assign',
    type: 'DEPLOY',
    confidence: 92,
    title: 'Copilot Auto-assign',
    description: 'Automatically provision Copilot licenses for eligible high-usage engineering teams.',
    estimatedMonthlySavings: 'N/A (Expansion)',
    icon: 'smart_toy',
    status: 'idle'
  }
];

export const SAMPLE_AFFECTED_USERS: AffectedUser[] = [
  {
    id: 'usr-101',
    name: 'Sarah Connor',
    email: 's.connor@archintel.io',
    department: 'Finance',
    sku: 'M365 E5',
    issue: 'Inactive > 90 Days',
    lastActive: '94 days ago',
    potentialAction: 'Reclaim E5 license'
  },
  {
    id: 'usr-102',
    name: 'David Brent',
    email: 'd.brent@archintel.io',
    department: 'Sales',
    sku: 'M365 E5 + E3',
    issue: 'Double-License Overlap',
    lastActive: '2 days ago',
    potentialAction: 'Remove duplicate E3 seat'
  },
  {
    id: 'usr-103',
    name: 'Marcus Brody',
    email: 'm.brody@archintel.io',
    department: 'Eng',
    sku: 'M365 E3',
    issue: 'Disabled AD Account',
    lastActive: '120 days ago',
    potentialAction: 'Unassign all seats'
  },
  {
    id: 'usr-104',
    name: 'Elena Rostova',
    email: 'e.rostova@archintel.io',
    department: 'Sales',
    sku: 'Dynamics 365 Pro',
    issue: 'Zero Login in 60 Days',
    lastActive: '62 days ago',
    potentialAction: 'Downgrade to Team Member'
  },
  {
    id: 'usr-105',
    name: 'Alex Vance',
    email: 'a.vance@archintel.io',
    department: 'Eng',
    sku: 'M365 E3',
    issue: 'High AI Feature Telemetry',
    lastActive: '3 mins ago',
    potentialAction: 'Provision Copilot license'
  },
  {
    id: 'usr-106',
    name: 'Gavin Belson',
    email: 'g.belson@archintel.io',
    department: 'HR',
    sku: 'M365 E5',
    issue: 'Unused Security/Purview features',
    lastActive: 'Yesterday',
    potentialAction: 'Downgrade E5 to E3'
  }
];
