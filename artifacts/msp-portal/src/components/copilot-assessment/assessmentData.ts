import { EngineStatus, PersonaStory, UseCaseTile, DocumentDeliverable } from './types';

export const INITIAL_ENGINES: EngineStatus[] = [
  {
    id: 'signals',
    name: "Signals Engine",
    description: "Evaluating Microsoft Graph query density, activity spikes, and cross-tenant collaboration patterns.",
    status: 'pending',
    progress: 0,
    details: ["Graph API endpoint latency: 18ms", "Activity event density: 42,000/hr", "Mail, Teams & SharePoint connectors active"]
  },
  {
    id: 'drift',
    name: "Drift Engine",
    description: "Detecting permission oversharing drift, legacy access groups, and stale SharePoint links.",
    status: 'pending',
    progress: 0,
    details: ["Oversharing scan: 1,240 sites checked", "Found 14 public sites with sensitive tags", "Inheritance drift threshold: Moderate"]
  },
  {
    id: 'health',
    name: "Health Engine",
    description: "Analyzing Microsoft 365 service health, API quotas, and Webhook reliability.",
    status: 'pending',
    progress: 0,
    details: ["Exchange Online status: Operational", "Teams API Quota: 98% remaining", "Search indexing latency: Low (<250ms)"]
  },
  {
    id: 'priority',
    name: "Priority Engine",
    description: "Calculating persona value score matrices and mapping business unit quick-wins.",
    status: 'pending',
    progress: 0,
    details: ["High-impact personas identified: 4 of 6", "Quick win candidate count: 18 departments", "Estimated productivity lift: +4.2 hrs/wk"]
  },
  {
    id: 'readiness',
    name: "Copilot Readiness Signals",
    description: "Synthesizing tenant readiness score, conditional access compliance, and licensing coverage.",
    status: 'pending',
    progress: 0,
    details: ["Readiness Index: 88/100", "Security Guardrails: 4 of 4 Active", "Tenant Status: READY FOR WAVE 1"]
  }
];

export const PERSONA_STORIES: PersonaStory[] = [
  {
    id: 'exec',
    name: "Executive Leadership",
    role: "VP / C-Suite",
    department: "Executive Management",
    avatar: "👑",
    riskScore: 24,
    opportunityScore: 94,
    recommendedRollout: "Wave 1 Immediate Onboarding",
    detailedStory: "Executive leaders process hundreds of threads, board packages, and strategic memos weekly. Copilot synthesizes multi-hour strategy meetings into key action items in 30 seconds and drafts high-impact announcements with brand voice fidelity.",
    telemetryEvidence: [
      "Average weekly email volume: 480 threads",
      "Meeting time ratio: 68% of total work hours",
      "Key workflow: Multi-document synthesis & executive brief generation"
    ],
    roiPreview: {
      hoursSavedPerWeek: 6.5,
      annualValue: "$24,500 / seat",
      primaryBenefit: "Executive focus recovery & decision velocity"
    }
  },
  {
    id: 'sales',
    name: "Account Executive & Sales Ops",
    role: "Senior Sales Director",
    department: "Revenue & Sales",
    avatar: "📈",
    riskScore: 32,
    opportunityScore: 91,
    recommendedRollout: "Wave 1 Sales Champion Cohort",
    detailedStory: "Sales teams combine CRM telemetry, customer emails, RFP requirements, and technical documentation. Copilot automates RFP response assembly, meeting summary follow-ups, and custom account brief generation.",
    telemetryEvidence: [
      "RFP response cycle: 14 days baseline → 4 days target",
      "Customer communication channels: Email, Teams, Dynamics 365",
      "CRM sync frequency: 120 updates/week"
    ],
    roiPreview: {
      hoursSavedPerWeek: 5.8,
      annualValue: "$18,200 / seat",
      primaryBenefit: "3x Faster RFP turnaround & win rate boost"
    }
  },
  {
    id: 'legal',
    name: "Legal & Compliance Counsel",
    role: "Corporate Counsel",
    department: "Legal Affairs",
    avatar: "⚖️",
    riskScore: 58,
    opportunityScore: 82,
    recommendedRollout: "Wave 2 (Post-Governance Hardening)",
    detailedStory: "Legal counsel handles complex contract comparisons, regulatory updates, and risk disclosures. Copilot accelerates redline clause analysis and policy gap detection while adhering to strict DLP boundary controls.",
    telemetryEvidence: [
      "Document length average: 45+ pages",
      "Compliance audit frequency: Continuous",
      "Primary requirement: Zero data leakage & full audit provenance"
    ],
    roiPreview: {
      hoursSavedPerWeek: 4.5,
      annualValue: "$19,800 / seat",
      primaryBenefit: "Accelerated contract reviews with strict provenance"
    }
  },
  {
    id: 'pm',
    name: "Product & Project Managers",
    role: "Lead Technical PM",
    department: "Product Engineering",
    avatar: "🚀",
    riskScore: 28,
    opportunityScore: 89,
    recommendedRollout: "Wave 1 Core Productivity",
    detailedStory: "Project managers coordinate cross-functional engineering sprints, specification reviews, and stakeholder updates. Copilot translates customer feedback channels directly into Azure DevOps items and status reports.",
    telemetryEvidence: [
      "Teams channel message count: 1,400 / week",
      "Meeting recap creation frequency: 12 meetings / week",
      "Tooling footprint: Jira, Azure DevOps, M365 Loop, Word"
    ],
    roiPreview: {
      hoursSavedPerWeek: 5.2,
      annualValue: "$15,600 / seat",
      primaryBenefit: "Automated sprint summaries & backlog alignment"
    }
  }
];

export const USE_CASE_TILES: UseCaseTile[] = [
  {
    id: 'uc1',
    name: "Executive Briefings & Meeting Catch-up",
    category: "Productivity",
    feasibilityScore: 96,
    blockers: [],
    expectedRoi: "$18,500 / seat / yr",
    recommended: true,
    blocked: false,
    summary: "Instant Teams meeting summaries with action item extraction and transcription search."
  },
  {
    id: 'uc2',
    name: "Automated RFP & Proposal Drafting",
    category: "Sales Velocity",
    feasibilityScore: 92,
    blockers: [],
    expectedRoi: "$22,000 / seat / yr",
    recommended: true,
    blocked: false,
    summary: "Synthesizing product collateral and prior proposal answers directly into response templates."
  },
  {
    id: 'uc3',
    name: "Contract Redline & Audit Synthesis",
    category: "Legal & Governance",
    feasibilityScore: 74,
    blockers: ["Requires DLP Strict Enforcement"],
    expectedRoi: "$19,200 / seat / yr",
    recommended: false,
    blocked: true,
    summary: "Automated clause risk analysis and compliance delta highlighting."
  },
  {
    id: 'uc4',
    name: "Custom Declarative Copilot Agents",
    category: "Extensibility",
    feasibilityScore: 88,
    blockers: [],
    expectedRoi: "$26,400 / seat / yr",
    recommended: true,
    blocked: false,
    summary: "Building custom Copilot Studio agents connected to internal SQL and REST APIs."
  },
  {
    id: 'uc5',
    name: "Cross-Tenant Financial Consolidation",
    category: "Finance & Analytics",
    feasibilityScore: 62,
    blockers: ["Sensitivity Labeling Incomplete", "CA01 Policy Unchecked"],
    expectedRoi: "$14,800 / seat / yr",
    recommended: false,
    blocked: true,
    summary: "Excel data analysis and multi-source ledger reconciliation."
  },
  {
    id: 'uc6',
    name: "Customer Service Knowledge Grounding",
    category: "Support Operations",
    feasibilityScore: 90,
    blockers: [],
    expectedRoi: "$16,500 / seat / yr",
    recommended: true,
    blocked: false,
    summary: "Grounding Copilot in internal support KB to reduce first-response times."
  }
];

export const DOCUMENT_DELIVERABLES: DocumentDeliverable[] = [
  {
    id: 'readiness-report',
    title: "Copilot Tenant Readiness Report",
    type: "Executive Summary & Audit",
    description: "Comprehensive assessment of tenant configuration, security posture, license distribution, and telemetry analysis.",
    readTime: "12 min read",
    sections: [
      {
        heading: "1. Executive Overview",
        content: "Your organization displays an overall Copilot Readiness Index of 88/100. Microsoft Graph query health and identity guardrails are well-configured for initial Wave 1 deployment.",
        stats: [
          { label: "Readiness Index", value: "88 / 100" },
          { label: "Identified Waves", value: "3 Phases" },
          { label: "High-Value Personas", value: "4 Groups" }
        ]
      },
      {
        heading: "2. Identity & Access Guardrails",
        content: "Privileged Identity Management (PIM) is active across global admin accounts. Conditional Access Policy CA01 enforces MFA and compliant device posture across all Copilot endpoints.",
        stats: [
          { label: "PIM Status", value: "ACTIVE" },
          { label: "CA01 Policy", value: "ENFORCED" }
        ]
      },
      {
        heading: "3. Recommendations & Action Items",
        content: "Address oversharing on legacy SharePoint sites tagged 'Internal Public' before expanding Copilot access to finance and HR departments."
      }
    ]
  },
  {
    id: 'governance-plan',
    title: "Enterprise Governance & Security Plan",
    type: "Policy Specification",
    description: "Detailed roadmap for sensitivity labels, Data Loss Prevention (DLP), blast radius containment, and audit logging.",
    readTime: "18 min read",
    sections: [
      {
        heading: "1. Sensitivity Labeling Framework",
        content: "Mandates 4 label tiers: Highly Confidential, Confidential, General, and Public. Auto-labeling rules configured for credit card, SSN, and IP detection.",
        stats: [
          { label: "Label Tiers", value: "4 Tiers" },
          { label: "Auto-Scan Status", value: "ACTIVE" }
        ]
      },
      {
        heading: "2. Data Loss Prevention Policy Matrix",
        content: "DLP policy set to Strict mode for external domain sharing. Prevents grounding responses from pulling from unverified external file shares."
      }
    ]
  },
  {
    id: 'enablement-plan',
    title: "Change Management & Enablement Plan",
    type: "Operational Playbook",
    description: "User adoption framework, champion network structure, prompt engineering training, and success metrics.",
    readTime: "15 min read",
    sections: [
      {
        heading: "1. Champion Network Rollout",
        content: "Establish 25 peer champions across Sales, Product, and Leadership to host weekly office hours and prompt showcases.",
        stats: [
          { label: "Champions Target", value: "25 Users" },
          { label: "Enablement Cadence", value: "Weekly" }
        ]
      }
    ]
  },
  {
    id: 'roi-model-doc',
    title: "ROI & Productivity Financial Model",
    type: "Financial Model",
    description: "Quantitative financial projection detailing cost avoidance, hours saved per employee, and net present value.",
    readTime: "10 min read",
    sections: [
      {
        heading: "1. Financial Summary",
        content: "Projected 3-year net ROI of 342% with a 4.2 month payback period based on 500 licenses at 80% adoption rate.",
        stats: [
          { label: "3-Yr Net ROI", value: "342%" },
          { label: "Payback Period", value: "4.2 Mos" },
          { label: "Annual Savings", value: "$1.85M" }
        ]
      }
    ]
  }
];

export const UI_ARCHITECTURE_SPEC_DOCUMENT = `# Copilot Assessment UI Architecture Specification

## Executive Summary
This document specifies the UI Architecture, Layout Structure, Navigation Model, State Engine, and Component Hierarchy for the enterprise Copilot Assessment SaaS Framework.

---

## 1. Global Layout Architecture (4-Region Panel Model)
The framework enforces a deterministic, high-density, panel-based 4-region layout optimized for desktop enterprise environments.

### Region 1: Top Toolbar
- **Purpose**: Global context, status tracking, breadcrumb navigation, utility actions.
- **Components**:
  - Brand & Product Badge (\`Copilot Assessment\`)
  - Progress Progress Indicator (\`Step X of 8 — Y%\`)
  - Horizontal Step Breadcrumb Navigation Bar
  - Contextual Help & Documentation Trigger
  - Exit & Spec Mode Toggle Controls

### Region 2: Left Panel (Collapsible Navigation)
- **Purpose**: Vertical workflow navigation & step selection.
- **States**: Expanded (240px width) | Collapsed (64px mini-rail).
- **Navigation Structure**:
  1. Quiz (10 Questions)
  2. Telemetry Correlation Engine
  3. Persona Stories
  4. Use Cases Matrix
  5. Security & Governance Simulation
  6. ROI Modeling
  7. Document Deliverables

### Region 3: Center Panel (Primary Content Stage)
- **Purpose**: Primary interactive canvas for guided assessment screens.
- **Capabilities**:
  - High-density cards, multi-column grids, interactive charts
  - Real-time streaming status updates & progress meters
  - Multi-state interactive sliders, toggles, and matrix filters

### Region 4: Right Panel (Contextual Insights Panel)
- **Purpose**: Real-time context, telemetry hints, governance blockers, and live ROI previews synced with active screen state.
- **States**: Open (320px width) | Minimized.

---

## 2. Screen-by-Screen Component Hierarchy

### Screen 1: Assessment Home
- **Hero Unit**: Title, description, CTA (\`Begin Assessment\`).
- **Progress Tracking**: Overall progress percentage bar.
- **Information Grid (3 Cards)**:
  - *What You'll Get*: Reports, ROI model, governance strategy.
  - *How Long It Takes*: 15-minute guided workflow.
  - *What We Analyze*: Tenant telemetry, personas, security guardrails.

### Screen 2: Quiz (10-Question Guided Engine)
- **Question Stage**: Centered high-contrast card displaying current question # and category.
- **Selection Tiles**: 4 large interactive tile options with detailed subtitles and impact metrics.
- **Bottom Navigation**: Sticky action bar with \`Back\` and \`Next Question\` buttons.
- **Context Panel**: Persona likelihood indicators and use-case alignment score meters.

### Screen 3: Telemetry Correlation
- **Engine Stream Panel**: Real-time evaluation meters for:
  - Signals Engine
  - Drift Engine
  - Health Engine
  - Priority Engine
  - Copilot Readiness Signals
- **Status Lifecycle**: \`Pending\` → \`Running\` → \`Complete\`.
- **Context Panel**: Technical explanations ("Why this matters", "What we're evaluating").

### Screen 4: Persona Stories
- **Horizontal Cards**: Executive, Sales, Legal, Product PM cards.
- **Card Content**: Avatar, risk score, opportunity score, rollout recommendation.
- **Modal View**: Expanded persona breakdown with telemetry evidence logs & ROI projections.

### Screen 5: Use-Case Stories
- **Matrix Grid**: Interactive tiles detailing feasibility, blockers, expected ROI, and status tags.
- **Context Panel**: Categorized summaries of top recommended vs. blocked use cases.

### Screen 6: Security & Governance Simulation
- **Control Bar**: Interactive toggles for \`CA01\`, \`PIM\`, \`Sensitivity Labels\`, and \`DLP Mode\` (\`Off\`, \`Moderate\`, \`Strict\`).
- **Analytics Grid**:
  - Blast Radius Risk Meter
  - Exposure Map Visualizer
  - Governance Maturity Radar Chart
- **Context Panel**: Live posture comparison (\`Current\` vs \`Projected Posture\`).

### Screen 7: ROI Modeling
- **Control Sliders**: Adoption Rate (%), Persona Coverage (%), Use-Case Intensity (%).
- **Interactive Charts**: Time Savings, Quality Uplift, Cost Avoidance projections.
- **Context Panel**: Top value-driving personas & use-cases.

### Screen 8: Document Deliverables
- **Deliverable Cards Grid**: Tenant Readiness Report, Governance Plan, Enablement Plan, ROI Model.
- **Document Viewer Modal**: Tabbed/Expandable document previewer with embedded metrics, section toggles, and export triggers.

---

## 3. State Engine & Navigation Model

### State Schema
- \`currentStep\`: \`home\` | \`quiz\` | \`telemetry\` | \`personas\` | \`use-cases\` | \`security\` | \`roi\` | \`documents\`
- \`currentQuestionIndex\`: \`0\` through \`9\`
- \`quizAnswers\`: Key-value store of question IDs to selected option IDs
- \`engines\`: Array of engine states with status (\`pending\`, \`running\`, \`complete\`) and progress values
- \`governance\`: Reactive toggles for CA01, PIM, Sensitivity Labels, DLP
- \`roi\`: Reactive numeric values for adoption rate, persona coverage, intensity

### Navigation Rules
- Deterministic sequential flow (\`Home\` → \`Quiz\` → \`Telemetry\` → \`Personas\` → \`Use Cases\` → \`Security\` → \`ROI\` → \`Documents\`)
- Direct step jumping via Left Panel or Breadcrumb bar
- Modal-first popups for deep persona and document inspection

---

## 4. Interaction Model & Design Language
- **Theme**: Fluent Dark Mode (\`bg-slate-950\`, \`border-slate-800\`, \`text-slate-100\`, accent \`sky-500\` / \`indigo-500\`).
- **Density**: Enterprise high-density layout with 12px/16px tight padding scales.
- **Motion**: Fluid state transitions utilizing \`motion/react\` for panel collapse, progress bars, and screen switches.
`;
