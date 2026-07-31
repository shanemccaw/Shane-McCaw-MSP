import React from 'react';

export interface QuizOptionTile {
  id: string;
  title: string;
  description: string;
  iconName: string;
  badge?: string;
  clusterId?: string; // Optional linking to cluster
}

export interface QuizStepDefinition {
  id: string;
  stepNumber: number;
  navLabel: string;
  title: string;
  description: string;
  hint: string;
  isMultiSelect?: boolean;
}

export const QUIZ_NAV_ITEMS = [
  { id: 'about-you', label: 'About You', stepNumber: 1, isMultiSelect: false },
  { id: 'industry', label: 'Industry', stepNumber: 2, isMultiSelect: false },
  { id: 'sensitivity', label: 'Data Sensitivity', stepNumber: 3, isMultiSelect: true },
  { id: 'collaboration', label: 'Collaboration Pattern', stepNumber: 4, isMultiSelect: true },
  { id: 'ai-comfort', label: 'AI Comfort', stepNumber: 5, isMultiSelect: false },
  { id: 'workflow', label: 'Workflow Structure', stepNumber: 6, isMultiSelect: false },
  { id: 'adoption-speed', label: 'Adoption Speed', stepNumber: 7, isMultiSelect: false },
  { id: 'outcomes', label: 'Outcome Priorities', stepNumber: 8, isMultiSelect: true },
  { id: 'change-mgmt', label: 'Change Management', stepNumber: 9, isMultiSelect: false },
  { id: 'workload-mix', label: 'Workload Mix', stepNumber: 10, isMultiSelect: false },
  { id: 'review', label: 'Review', stepNumber: 11, isMultiSelect: false },
];

export const INDUSTRY_OPTIONS: QuizOptionTile[] = [
  { id: 'space', title: 'Space / Aerospace', description: 'Orbital systems, satellite telemetry, defense & space research', iconName: 'Rocket' },
  { id: 'healthcare', title: 'Healthcare', description: 'Clinical care, EHR systems, medical research & health ops', iconName: 'HeartPulse' },
  { id: 'finance', title: 'Finance', description: 'Investment banking, wealth management, SEC/SOX compliance', iconName: 'Landmark' },
  { id: 'manufacturing', title: 'Manufacturing', description: 'Plant operations, OT security, supply chain & quality control', iconName: 'Factory' },
  { id: 'education', title: 'Education', description: 'Academic research, K-12/higher ed administration, curriculum', iconName: 'GraduationCap' },
  { id: 'government', title: 'Government', description: 'Public sector, municipal operations, policy & defense', iconName: 'Building2' },
  { id: 'legal', title: 'Legal', description: 'Corporate counsel, law firms, contract redlining & litigation', iconName: 'Scale' },
  { id: 'retail', title: 'Retail', description: 'E-commerce, store ops, merchandising & customer experience', iconName: 'ShoppingBag' },
  { id: 'technology', title: 'Technology', description: 'Software engineering, SaaS products, DevOps & IT service', iconName: 'Code' },
  { id: 'energy', title: 'Energy', description: 'Renewables, utility grids, oil & gas exploration, field ops', iconName: 'Zap' },
  { id: 'transportation', title: 'Transportation', description: 'Logistics, fleet management, aviation & supply routes', iconName: 'Truck' },
  { id: 'agriculture', title: 'Agriculture', description: 'Agronomy, smart farming, yield telemetry & food supply', iconName: 'Sprout' },
  { id: 'nonprofit', title: 'Nonprofit', description: 'Donor relations, grant management, community outreach', iconName: 'Heart' },
  { id: 'other', title: 'Other (Custom Personas)', description: 'Custom enterprise profile, cross-industry matrix', iconName: 'Sparkles' },
];

export const ADAPTIVE_DATA_SENSITIVITY: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'classified', title: 'Classified / ITAR', description: 'Strict government export controls, defense classification & airgap requirements', iconName: 'Lock', badge: 'Strict' },
    { id: 'mission_crit', title: 'Mission-Critical', description: 'Telemetry, flight code & real-time operational safety data', iconName: 'ShieldAlert' },
    { id: 'res_sens', title: 'Research-Sensitive', description: 'Proprietary propulsion & material science patent research', iconName: 'EyeOff' },
    { id: 'low_sens', title: 'Low Sensitivity', description: 'Public mission releases, educational outreach & open telemetry', iconName: 'Globe' },
  ],
  healthcare: [
    { id: 'phi', title: 'Protected Health Info (PHI)', description: 'Direct patient clinical records, diagnostic imaging & genomic data', iconName: 'HeartPulse', badge: 'HIPAA' },
    { id: 'hipaa_reg', title: 'HIPAA-Regulated', description: 'Medical billing, clinical trial participant codes & pharmacy records', iconName: 'ShieldCheck' },
    { id: 'mixed_sens', title: 'Mixed Sensitivity', description: 'Hospital administrative policies, scheduling & internal staff comms', iconName: 'FileText' },
  ],
  finance: [
    { id: 'sec_reg', title: 'SEC-Regulated / MNPI', description: 'Material non-public information, insider financial results & deal terms', iconName: 'Landmark', badge: 'SOX/SEC' },
    { id: 'sox', title: 'SOX Compliant Data', description: 'Audited general ledgers, corporate tax filings & treasury records', iconName: 'FileSpreadsheet' },
    { id: 'high_sens', title: 'High Sensitivity PII', description: 'Customer bank account numbers, SSNs, credit scores & transaction logs', iconName: 'Lock' },
  ],
  default: [
    { id: 'cui_restricted', title: 'CUI / Highly Restricted', description: 'Strict compliance requirements, confidential IP, customer PII & trade secrets', iconName: 'Lock', badge: 'Restricted' },
    { id: 'confidential', title: 'Confidential Internal', description: 'Proprietary business strategies, unreleased products & internal financials', iconName: 'Shield' },
    { id: 'internal', title: 'Internal Only', description: 'Standard day-to-day employee collaboration, department wikis & SOPs', iconName: 'Building' },
    { id: 'low_public', title: 'Low / Public', description: 'Public press releases, published documentation & open web content', iconName: 'Globe' },
  ]
};

// ADAPTIVE COLLABORATION
export const ADAPTIVE_COLLABORATION: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'cross_mission', title: 'Cross-Mission Teams', description: 'Integrated flight controllers, payload engineers & launch teams', iconName: 'Rocket' },
    { id: 'cross_agency', title: 'Cross-Agency / Prime Contractors', description: 'Collaborating with NASA, ESA, SpaceX, Boeing & defense primes', iconName: 'Globe' },
    { id: 'internal_only', title: 'Internal Only / Airgapped', description: 'Restricted to isolated secure lab environments & internal staff', iconName: 'Shield' },
  ],
  healthcare: [
    { id: 'care_team', title: 'Care Team Level', description: 'Physicians, nurses, pharmacists & specialists sharing patient care notes', iconName: 'Stethoscope' },
    { id: 'department', title: 'Departmental Unit', description: 'Radiology, Cardiology, or Surgery department internal operations', iconName: 'Building' },
    { id: 'multi_facility', title: 'Multi-Facility Network', description: 'Health system-wide collaboration across hospitals & outpatient clinics', iconName: 'Network' },
  ],
  finance: [
    { id: 'desk_level', title: 'Desk / Team Level', description: 'Isolated trading desk or deal team with strict information barriers (Chinese walls)', iconName: 'Lock' },
    { id: 'firm_wide', title: 'Firm-Wide Enterprise', description: 'Cross-departmental collaboration across research, risk & client service', iconName: 'Building2' },
    { id: 'client_facing', title: 'Client-Facing / External', description: 'Sharing financial reports & advisory decks directly with external investors', iconName: 'Users' },
  ],
  default: [
    { id: 'cross_functional', title: 'Cross-Functional Teams', description: 'Project-based collaboration across product, sales, legal & engineering', iconName: 'Users' },
    { id: 'enterprise_wide', title: 'Enterprise-Wide Broad', description: 'Open organization-wide channels, company town halls & shared hubs', iconName: 'Globe' },
    { id: 'external_partners', title: 'External Partners & Vendors', description: 'Frequent guest access, shared B2B extranets & customer portals', iconName: 'Share2' },
  ]
};

// UNIVERSAL QUESTIONS
export const UNIVERSAL_AI_COMFORT: QuizOptionTile[] = [
  { id: 'very_comfortable', title: 'Very Comfortable', description: 'Active power users of LLMs, enthusiastic about prompt engineering & agentic AI', iconName: 'Zap' },
  { id: 'somewhat_comfortable', title: 'Somewhat Comfortable', description: 'Familiar with AI tools (ChatGPT, M365 Copilot), comfortable with drafted output', iconName: 'Smile' },
  { id: 'neutral', title: 'Neutral', description: 'Open to AI assistance, but relies on standard review workflows before sending', iconName: 'Meh' },
  { id: 'cautious', title: 'Cautious', description: 'Prefers strict human-in-the-loop validation, concerned about accuracy & hallucination', iconName: 'ShieldAlert' },
  { id: 'not_comfortable', title: 'Not Comfortable', description: 'Skeptical or resistant to AI, requires extensive policy guardrails & proof', iconName: 'AlertTriangle' },
];

export const UNIVERSAL_WORKFLOW_STRUCTURE: QuizOptionTile[] = [
  { id: 'highly_structured', title: 'Highly Structured', description: 'Strict SOPs, rigid checklists, standardized forms & predictable daily cadences', iconName: 'CheckSquare' },
  { id: 'moderately_structured', title: 'Moderately Structured', description: 'Mix of repeatable processes & ad-hoc creative or problem-solving tasks', iconName: 'Layers' },
  { id: 'unstructured', title: 'Unstructured / Dynamic', description: 'Highly dynamic, unpredictable day-to-day work, rapid context switching', iconName: 'Activity' },
];

export const UNIVERSAL_ADOPTION_SPEED: QuizOptionTile[] = [
  { id: 'early_adopter', title: 'Early Adopter', description: 'Proactively seeks out new tech, tests beta builds, champions innovations', iconName: 'Sparkles' },
  { id: 'fast_follower', title: 'Fast Follower', description: 'Quickly adopts tools once colleagues demonstrate clear time savings', iconName: 'TrendingUp' },
  { id: 'average_adopter', title: 'Average Adopter', description: 'Follows official company rollout timelines and mandatory IT migration paths', iconName: 'Clock' },
  { id: 'slow_adopter', title: 'Slow Adopter', description: 'Hesitant to change established habits; requires formal training and coaching', iconName: 'Shield' },
];

export const ADAPTIVE_OUTCOME_PRIORITIES: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'res_accel', title: 'Research Acceleration', description: 'Compressing literature reviews & mission feasibility calculations from months to days', iconName: 'Rocket' },
    { id: 'mission_safety', title: 'Mission Safety', description: 'Eliminating human error in complex checklists & flight procedure documentation', iconName: 'ShieldCheck' },
    { id: 'doc_quality', title: 'Documentation Quality', description: 'Standardizing engineering specs & anomaly reporting across global sites', iconName: 'FileText' },
    { id: 'eng_accuracy', title: 'Engineering Accuracy', description: 'Verifying mathematical precision & systems telemetry alignment', iconName: 'Target' },
  ],
  healthcare: [
    { id: 'care_quality', title: 'Care Quality & Patient Time', description: 'Reducing EHR clerical burden so clinicians spend more face-to-face time with patients', iconName: 'Heart' },
    { id: 'compliance', title: 'Strict HIPAA Compliance', description: 'Ensuring zero patient data leaks while automating care notes & insurance forms', iconName: 'ShieldCheck' },
    { id: 'efficiency', title: 'Operational Efficiency', description: 'Accelerating shift handovers, lab summaries & discharge processing', iconName: 'Zap' },
  ],
  finance: [
    { id: 'risk_reduction', title: 'Risk & Error Reduction', description: 'Minimizing manual copy-paste errors in compliance reports & valuation models', iconName: 'ShieldAlert' },
    { id: 'accuracy', title: 'Analytical Accuracy', description: 'Standardizing financial disclosures, earnings notes & audit trails', iconName: 'Target' },
    { id: 'speed', title: 'Market Speed & Alpha', description: 'Synthesizing market movements instantly to act ahead of competitors', iconName: 'TrendingUp' },
  ],
  default: [
    { id: 'dev_velocity', title: 'Productivity & Time Saved', description: 'Recovering 4–6 hours per week per employee from administrative tasks', iconName: 'Clock' },
    { id: 'error_red', title: 'Quality & Error Reduction', description: 'Improving output consistency, grammar, formatting & technical accuracy', iconName: 'CheckCircle2' },
    { id: 'time_to_mkt', title: 'Speed-to-Market', description: 'Accelerating RFP turnarounds, software releases & customer response times', iconName: 'Zap' },
  ]
};

export const UNIVERSAL_CHANGE_MGMT: QuizOptionTile[] = [
  { id: 'minimal', title: 'Minimal Support Needed', description: 'Self-serve documentation, async video tutorials, and ad-hoc user discovery', iconName: 'Compass' },
  { id: 'moderate', title: 'Moderate Support Needed', description: 'Department champion network, weekly lunch-and-learns, and prompt libraries', iconName: 'Users' },
  { id: 'significant', title: 'Significant Support Needed', description: 'Dedicated change management team, mandatory hands-on workshops & 1-on-1 coaching', iconName: 'ShieldCheck' },
];

// Backward-compatible flat exports for telemetryCatalog.ts, which expects
// SENSITIVITY_OPTIONS/COLLABORATION_OPTIONS as flat { id, title } lookups
// rather than the industry-adaptive Record<string, QuizOptionTile[]> shape
// above. Union of every industry's options, deduped by id, so any id that
// could appear in a real quiz answer resolves to a real title.
function dedupeById(catalog: Record<string, QuizOptionTile[]>): QuizOptionTile[] {
  const seen = new Map<string, QuizOptionTile>();
  Object.values(catalog).flat().forEach(opt => {
    if (!seen.has(opt.id)) seen.set(opt.id, opt);
  });
  return Array.from(seen.values());
}

export const SENSITIVITY_OPTIONS: QuizOptionTile[] = dedupeById(ADAPTIVE_DATA_SENSITIVITY);
export const COLLABORATION_OPTIONS: QuizOptionTile[] = dedupeById(ADAPTIVE_COLLABORATION);
