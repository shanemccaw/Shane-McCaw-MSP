/**
 * Workflow Task Generator
 *
 * Each template produces a list of task objects for a given opportunity.
 * Tasks are inserted into opportunity_tasks and mirrored to kanban_tasks.
 */

export interface TaskTemplate {
  title: string;
  description: string;
  dueDaysFromNow: number;
  assignedTo: string;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function generateWorkflowTasks(
  workflowType: string,
  leadName: string,
): TaskTemplate[] {
  switch (workflowType) {
    case "DiscoveryCall":
      return generateDiscoveryCall(leadName);
    case "GovernanceAssessment":
      return generateGovernanceAssessment(leadName);
    case "CopilotReadiness":
      return generateCopilotReadiness(leadName);
    case "ComplianceReview":
      return generateComplianceReview(leadName);
    case "TenantHealth":
      return generateTenantHealth(leadName);
    case "ProposalPrep":
      return generateProposalPrep(leadName);
    default:
      return generateDiscoveryCall(leadName);
  }
}

function generateDiscoveryCall(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Send discovery call invite to ${leadName}`,
      description: "Email Calendly or Bookings link for a 60-min discovery session. Include pre-call questionnaire.",
      dueDaysFromNow: 1,
      assignedTo: "Shane",
    },
    {
      title: `Prepare discovery call agenda for ${leadName}`,
      description: "Review lead profile, pain points, and quiz results. Draft 5 key questions.",
      dueDaysFromNow: 2,
      assignedTo: "Shane",
    },
    {
      title: `Run discovery call with ${leadName}`,
      description: "Conduct 60-min discovery session. Capture goals, blockers, timeline, budget range.",
      dueDaysFromNow: 7,
      assignedTo: "Shane",
    },
    {
      title: `Discovery call follow-up for ${leadName}`,
      description: "Send recap email with key findings and proposed next steps within 24 hours of call.",
      dueDaysFromNow: 8,
      assignedTo: "Shane",
    },
    {
      title: `Qualify and stage ${leadName} post-discovery`,
      description: "Update lead record with discovery insights. Decide: proposal, assessment, or nurture.",
      dueDaysFromNow: 10,
      assignedTo: "Shane",
    },
  ];
}

function generateGovernanceAssessment(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Send governance intake questionnaire to ${leadName}`,
      description: "Share the M365 Governance Foundations intake form to gather tenant details.",
      dueDaysFromNow: 1,
      assignedTo: "Shane",
    },
    {
      title: `Governance kick-off call with ${leadName}`,
      description: "30-min call to align on scope: DLP, sensitivity labels, retention, conditional access.",
      dueDaysFromNow: 5,
      assignedTo: "Shane",
    },
    {
      title: `Tenant governance review for ${leadName}`,
      description: "Run governance script against tenant. Review admin center settings, policies, and gaps.",
      dueDaysFromNow: 10,
      assignedTo: "Shane",
    },
    {
      title: `Draft governance assessment report for ${leadName}`,
      description: "Document findings: current state, gaps, risk ratings, and prioritised recommendations.",
      dueDaysFromNow: 14,
      assignedTo: "Shane",
    },
    {
      title: `Deliver governance report to ${leadName}`,
      description: "Present findings and roadmap. Propose implementation engagement if warranted.",
      dueDaysFromNow: 16,
      assignedTo: "Shane",
    },
  ];
}

function generateCopilotReadiness(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Send Copilot readiness pre-assessment to ${leadName}`,
      description: "Share data sensitivity and licensing questionnaire before the assessment call.",
      dueDaysFromNow: 1,
      assignedTo: "Shane",
    },
    {
      title: `Copilot readiness assessment call with ${leadName}`,
      description: "60-min deep-dive: data governance posture, DLP coverage, sensitivity label usage.",
      dueDaysFromNow: 5,
      assignedTo: "Shane",
    },
    {
      title: `Review tenant data posture for ${leadName}`,
      description: "Check SharePoint external sharing, sensitivity labels, purview compliance centre.",
      dueDaysFromNow: 8,
      assignedTo: "Shane",
    },
    {
      title: `License and seat review for ${leadName}`,
      description: "Validate E3/E5 vs M365 Copilot license eligibility and identify seat allocation.",
      dueDaysFromNow: 10,
      assignedTo: "Shane",
    },
    {
      title: `Deliver Copilot readiness report to ${leadName}`,
      description: "Present readiness score, blockers, and 90-day adoption roadmap.",
      dueDaysFromNow: 14,
      assignedTo: "Shane",
    },
  ];
}

function generateComplianceReview(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Compliance intake call with ${leadName}`,
      description: "Understand regulatory requirements: HIPAA, SOC 2, NIST, FedRAMP, ITAR, or GDPR.",
      dueDaysFromNow: 2,
      assignedTo: "Shane",
    },
    {
      title: `Purview compliance audit for ${leadName}`,
      description: "Review Microsoft Purview posture: communication compliance, insider risk, eDiscovery.",
      dueDaysFromNow: 7,
      assignedTo: "Shane",
    },
    {
      title: `Conditional access and identity review for ${leadName}`,
      description: "Audit Entra ID CA policies, MFA coverage, Privileged Identity Management configuration.",
      dueDaysFromNow: 10,
      assignedTo: "Shane",
    },
    {
      title: `Compile compliance gap analysis for ${leadName}`,
      description: "Map current controls to compliance framework. Rate each gap by severity.",
      dueDaysFromNow: 14,
      assignedTo: "Shane",
    },
    {
      title: `Deliver compliance roadmap to ${leadName}`,
      description: "Present remediation plan with timeline, effort estimates, and owner assignments.",
      dueDaysFromNow: 17,
      assignedTo: "Shane",
    },
  ];
}

function generateTenantHealth(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Tenant health pre-scan access request for ${leadName}`,
      description: "Request read-only Global Reader credentials or App Registration for health scan.",
      dueDaysFromNow: 1,
      assignedTo: "Shane",
    },
    {
      title: `Run M365 tenant health scripts for ${leadName}`,
      description: "Execute PowerShell health scripts: licensing, inactive users, mailbox sizes, SharePoint sprawl.",
      dueDaysFromNow: 4,
      assignedTo: "Shane",
    },
    {
      title: `Analyze tenant health scan results for ${leadName}`,
      description: "Review script output and categorise findings by impact: critical / high / medium.",
      dueDaysFromNow: 6,
      assignedTo: "Shane",
    },
    {
      title: `Draft tenant health report for ${leadName}`,
      description: "Build report: executive summary, findings table, screenshots, recommendations.",
      dueDaysFromNow: 9,
      assignedTo: "Shane",
    },
    {
      title: `Tenant health debrief with ${leadName}`,
      description: "Present findings. Prioritise top 3 quick wins. Propose follow-on engagement.",
      dueDaysFromNow: 12,
      assignedTo: "Shane",
    },
  ];
}

function generateProposalPrep(leadName: string): TaskTemplate[] {
  return [
    {
      title: `Define scope for ${leadName} proposal`,
      description: "Confirm services, deliverables, timeline, and success criteria based on discovery.",
      dueDaysFromNow: 1,
      assignedTo: "Shane",
    },
    {
      title: `Draft SOW for ${leadName}`,
      description: "Write statement of work: objectives, deliverables, milestones, assumptions, exclusions.",
      dueDaysFromNow: 4,
      assignedTo: "Shane",
    },
    {
      title: `Price proposal for ${leadName}`,
      description: "Build pricing model with fixed-fee or retainer options. Include optional add-ons.",
      dueDaysFromNow: 5,
      assignedTo: "Shane",
    },
    {
      title: `Internal proposal review for ${leadName}`,
      description: "Review SOW and pricing for accuracy, profitability, and competitive positioning.",
      dueDaysFromNow: 6,
      assignedTo: "Shane",
    },
    {
      title: `Deliver proposal to ${leadName}`,
      description: "Send proposal via email with signed contract link. Follow up in 48 hours.",
      dueDaysFromNow: 7,
      assignedTo: "Shane",
    },
  ];
}

export { daysFromNow };
