import type { QuizProfile } from './types';

export interface QuizOptionTile {
  id: string;
  title: string;
  description: string;
  iconName: string;
  badge?: string;
}

export type QuizStepType = 'form' | 'tiles' | 'sliders' | 'review';

export interface QuizStepDefinition {
  id: string;
  stepNumber: number;
  label: string;
  stepType: QuizStepType;
  isMultiSelect?: boolean;
}

export const QUIZ_NAV_ITEMS: QuizStepDefinition[] = [
  { id: 'about-you', label: 'About You', stepNumber: 1, stepType: 'form' },
  { id: 'industry', label: 'Industry', stepNumber: 2, stepType: 'tiles', isMultiSelect: false },
  { id: 'collaboration', label: 'Collaboration Pattern', stepNumber: 3, stepType: 'tiles', isMultiSelect: true },
  { id: 'sensitivity', label: 'Data Sensitivity', stepNumber: 4, stepType: 'tiles', isMultiSelect: true },
  { id: 'workflow-style', label: 'Workflow Style', stepNumber: 5, stepType: 'tiles', isMultiSelect: false },
  { id: 'outcomes', label: 'Outcome Priorities', stepNumber: 6, stepType: 'tiles', isMultiSelect: true },
  { id: 'workload', label: 'Workload Mix', stepNumber: 7, stepType: 'sliders' },
  { id: 'tool-usage', label: 'Tool Usage', stepNumber: 8, stepType: 'tiles', isMultiSelect: true },
  { id: 'ai-comfort', label: 'AI Comfort', stepNumber: 9, stepType: 'tiles', isMultiSelect: false },
  { id: 'review', label: 'Review', stepNumber: 10, stepType: 'review' },
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
  { id: 'other', title: 'Other', description: 'Custom enterprise profile, cross-industry matrix', iconName: 'Sparkles' },
];

// Collaboration pattern is intentionally a flat 3-value set (not industry-adaptive) —
// it maps 1:1 onto QuizProfile['collaboration'], which the AI phases (#183 Phases 3/4)
// consume as a literal union, not a display label to re-resolve later.
export const COLLABORATION_OPTIONS: QuizOptionTile[] = [
  { id: 'internal', title: 'Internal Only', description: 'Work stays within your own team or department — no cross-team or outside sharing.', iconName: 'Shield' },
  { id: 'cross-team', title: 'Cross-Team', description: 'Regular collaboration across departments, business units, or functions inside your org.', iconName: 'Users' },
  { id: 'external', title: 'External', description: 'Frequent sharing with customers, partners, vendors, or other outside parties.', iconName: 'Globe' },
];

// Sensitivity tile ids double as the exact tag values stored in QuizProfile['sensitivity'] —
// deliberately plain compliance-shorthand (PHI, PII, CUI...), not per-industry copy, since the
// AI phases prompt on the raw tag plus the separately-collected industry, not a pre-baked mix.
export const SENSITIVITY_OPTIONS: QuizOptionTile[] = [
  { id: 'PHI', title: 'PHI', description: 'Protected Health Information — clinical records, diagnoses, treatment history.', iconName: 'HeartPulse', badge: 'HIPAA' },
  { id: 'PII', title: 'PII', description: 'Personally Identifiable Information — names, SSNs, addresses, DOB.', iconName: 'Lock' },
  { id: 'HIPAA', title: 'HIPAA-Regulated', description: 'Data covered under HIPAA beyond direct clinical records (billing, plan data).', iconName: 'ShieldCheck' },
  { id: 'PCI', title: 'PCI', description: 'Payment card data — cardholder numbers, CVV, transaction records.', iconName: 'FileCheck' },
  { id: 'CUI', title: 'CUI', description: 'Controlled Unclassified Information — federal contract or export-controlled data.', iconName: 'ShieldAlert' },
  { id: 'ITAR', title: 'ITAR / Export-Controlled', description: 'Defense or space technical data subject to export control regulations.', iconName: 'Rocket' },
  { id: 'GDPR', title: 'GDPR-Regulated', description: 'EU personal data subject to GDPR data-subject rights and transfer rules.', iconName: 'Globe' },
  { id: 'FERPA', title: 'FERPA', description: 'Student education records protected under FERPA.', iconName: 'GraduationCap' },
  { id: 'MNPI', title: 'MNPI / SEC-Regulated', description: 'Material non-public information — insider financials, deal terms.', iconName: 'Landmark' },
  { id: 'CONFIDENTIAL', title: 'Confidential Business Data', description: 'Trade secrets, unreleased products, internal strategy — no regulatory label.', iconName: 'EyeOff' },
  { id: 'NONE', title: 'None / Public', description: 'No sensitive data classes — public or low-sensitivity content only.', iconName: 'Check' },
];

export const WORKFLOW_STYLE_OPTIONS: QuizOptionTile[] = [
  { id: 'structured', title: 'Structured', description: 'Predictable, repeatable processes — SOPs, checklists, standardized forms and cadences.', iconName: 'CheckSquare' },
  { id: 'unstructured', title: 'Unstructured', description: 'Dynamic, ad-hoc work — frequent context switching, few fixed processes.', iconName: 'Activity' },
];

export const OUTCOME_PRIORITY_OPTIONS: QuizOptionTile[] = [
  { id: 'speed', title: 'Speed', description: 'Faster turnaround on drafts, responses, and deliverables.', iconName: 'Zap' },
  { id: 'accuracy', title: 'Accuracy', description: 'Fewer errors, more consistent and reliable output.', iconName: 'Target' },
  { id: 'compliance', title: 'Compliance', description: 'Meeting regulatory, legal, or policy requirements.', iconName: 'ShieldCheck' },
  { id: 'cost-reduction', title: 'Cost Reduction', description: 'Lowering the cost of producing recurring work.', iconName: 'TrendingUp' },
  { id: 'quality', title: 'Quality Uplift', description: 'Higher-quality writing, analysis, or deliverables overall.', iconName: 'CheckCircle2' },
  { id: 'risk-reduction', title: 'Risk Reduction', description: 'Reducing manual-error and oversight risk in daily work.', iconName: 'ShieldAlert' },
  { id: 'employee-satisfaction', title: 'Employee Satisfaction', description: 'Reducing administrative burden and burnout.', iconName: 'Heart' },
];

export const TOOL_USAGE_OPTIONS: QuizOptionTile[] = [
  { id: 'teams', title: 'Teams', description: 'Chat, channels, meetings.', iconName: 'MessageSquare' },
  { id: 'sharepoint', title: 'SharePoint', description: 'Team sites, document libraries.', iconName: 'FolderKanban' },
  { id: 'outlook', title: 'Outlook', description: 'Email and calendaring.', iconName: 'FileText' },
  { id: 'onedrive', title: 'OneDrive', description: 'Personal cloud file storage.', iconName: 'HardDrive' },
  { id: 'word-excel-powerpoint', title: 'Word / Excel / PowerPoint', description: 'Core document, spreadsheet, and deck authoring.', iconName: 'FileSpreadsheet' },
  { id: 'planner-loop', title: 'Planner / Loop', description: 'Task boards and collaborative workspaces.', iconName: 'ListTodo' },
  { id: 'viva', title: 'Viva', description: 'Viva Insights, Engage, or Goals.', iconName: 'BarChart2' },
  { id: 'copilot-chat', title: 'Copilot Chat', description: 'Existing standalone Microsoft 365 Copilot Chat usage.', iconName: 'Sparkles' },
  { id: 'power-bi', title: 'Power BI', description: 'Reporting and data visualization.', iconName: 'BarChart' },
  { id: 'dynamics-365', title: 'Dynamics 365', description: 'CRM / ERP workflows.', iconName: 'Building2' },
];

export const AI_COMFORT_OPTIONS: QuizOptionTile[] = [
  { id: 'low', title: 'Low', description: 'Skeptical or new to AI tools; needs strict human-in-the-loop review and guardrails.', iconName: 'AlertTriangle' },
  { id: 'medium', title: 'Medium', description: 'Comfortable with AI-drafted output under a standard review workflow.', iconName: 'Meh' },
  { id: 'high', title: 'High', description: 'Active AI user, comfortable with agentic workflows and light-touch review.', iconName: 'Zap' },
];

export type LoadKey = 'draftingLoad' | 'researchLoad' | 'communicationLoad' | 'repetitiveLoad';

export interface LoadCategoryDefinition {
  key: LoadKey;
  label: string;
  description: string;
  iconName: string;
}

// Each load is an independent 0-1 "how much of your work involves this" slider — not
// forced to sum to 100%, since the four categories can and do overlap (e.g. drafting a
// status update is also communication). A ranked-choice or must-sum-to-100 UI would
// impose a false mutual-exclusivity the blueprint's shape doesn't require.
export const LOAD_CATEGORIES: LoadCategoryDefinition[] = [
  { key: 'draftingLoad', label: 'Drafting', description: 'Writing documents, emails, proposals, code, or other original content.', iconName: 'PenTool' },
  { key: 'researchLoad', label: 'Research', description: 'Reading, synthesizing, and summarizing information from multiple sources.', iconName: 'Search' },
  { key: 'communicationLoad', label: 'Communication', description: 'Meetings, messaging, status updates, and stakeholder coordination.', iconName: 'MessageSquare' },
  { key: 'repetitiveLoad', label: 'Repetitive Tasks', description: 'Routine, rules-based work you do the same way every time.', iconName: 'ListTodo' },
];

// Seed for a fresh quiz session. Deliberately omits industry/workflowStyle/
// aiComfort — those are required single-select questions, so leaving them
// unset (rather than pre-filling a "sensible default") keeps their step
// honestly marked incomplete until the quiz-taker actually picks a tile.
// The four loads default to the sliders' own neutral midpoint (0.5), which
// IS a legitimate answer if the user leaves a slider untouched.
export const INITIAL_QUIZ_PROFILE: Partial<QuizProfile> = {
  role: '',
  department: '',
  collaboration: [],
  sensitivity: [],
  outcomePriorities: [],
  draftingLoad: 0.5,
  researchLoad: 0.5,
  communicationLoad: 0.5,
  repetitiveLoad: 0.5,
  toolUsage: [],
};
