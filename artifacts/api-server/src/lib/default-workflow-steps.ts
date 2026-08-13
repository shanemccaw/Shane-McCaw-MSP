import { db, workflowStepsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Extracted from portal.ts (#175, portal.ts route decommission) — shared by
 * admin-services.ts and portal-checkout-free.ts.
 */
export function getDefaultSteps(slug: string): Array<{ title: string; description: string }> {
  const s = slug.toLowerCase();

  if (s.includes("m365") || s.includes("microsoft-365") || s.includes("microsoft365") || s.includes("health-check")) {
    return [
      { title: "Access", description: "Client provisions required read-only admin access or tenant data exports." },
      { title: "Schedule", description: "Kickoff call scheduled to confirm scope, timeline, and key contacts." },
      { title: "Execute", description: "Shane runs automated and manual checks across the M365 environment." },
      { title: "Review", description: "Initial findings reviewed internally; data validated for accuracy." },
      { title: "Assessments", description: "Deep-dive assessments run against flagged areas identified during execution." },
      { title: "Report", description: "Health Check Report drafted with prioritised findings and remediation roadmap." },
      { title: "Debrief", description: "60-minute debrief call to walk through report findings and answer questions." },
      { title: "End", description: "Final report delivered. Engagement closed and next steps agreed." },
    ];
  }

  if (s.includes("security") || s.includes("audit")) {
    return [
      { title: "Intake", description: "Intake call to confirm scope, tenant access requirements, and risk appetite." },
      { title: "Scope", description: "Scope document agreed and signed off; access credentials provisioned." },
      { title: "Scan", description: "Automated and manual security scans run across the M365 tenant." },
      { title: "Analyze", description: "Findings categorised by severity (Critical / High / Medium / Low) with NIST alignment." },
      { title: "Validate", description: "Results validated and false positives filtered before drafting the report." },
      { title: "Findings", description: "Draft audit findings report shared with the client for review and corrections." },
      { title: "Strategy", description: "Remediation strategy and prioritised action plan agreed with the client." },
      { title: "Close", description: "Final audit report delivered with optional 60-minute debrief call." },
    ];
  }

  if (s.includes("migration") || s.includes("cloud") || s.includes("azure")) {
    return [
      { title: "Discovery", description: "Current environment inventory, dependencies, and constraints documented." },
      { title: "Assessment", description: "Workloads assessed for cloud readiness; risk and effort estimated." },
      { title: "Pilot", description: "Low-risk workload migrated as a proof-of-concept to validate approach." },
      { title: "Planning", description: "Full migration plan finalised — wave schedule, rollback steps, comms plan." },
      { title: "Migration", description: "Workloads migrated in agreed waves with continuous monitoring." },
      { title: "Testing", description: "Post-migration testing: functionality, performance, and security validation." },
      { title: "Go-Live", description: "Cutover to production; legacy environment decommissioned on confirmation." },
      { title: "Support", description: "Hypercare support window — issues resolved and knowledge transferred." },
    ];
  }

  if (s.includes("copilot")) {
    return [
      { title: "Intake", description: "Intake call to understand team roles, workflows, and key productivity pain points." },
      { title: "Scope", description: "Use-case shortlist agreed; licensing and data governance posture reviewed." },
      { title: "Discovery", description: "Client provides sample tasks and documents for prompt discovery." },
      { title: "Prompts", description: "Prompts written, tested, and refined across Word, Excel, Teams, Outlook, and Loop." },
      { title: "Validation", description: "Prompts validated with real client workflows and edge cases resolved." },
      { title: "Delivery", description: "Prompt library built as a SharePoint page or Word document and delivered." },
      { title: "Training", description: "Short video walkthrough recorded and prompt-maintenance guidance shared." },
      { title: "Close", description: "Engagement closed; 30-day follow-up window opens for questions." },
    ];
  }

  if (s.includes("sharepoint")) {
    return [
      { title: "Discovery", description: "60-minute discovery call to capture requirements, stakeholders, and success criteria." },
      { title: "Requirements", description: "Structured workshop to capture navigation, content types, audience, and governance rules." },
      { title: "Design", description: "Information architecture, site map, and global navigation design produced." },
      { title: "Review", description: "IA and wireframes reviewed with the client; feedback incorporated." },
      { title: "Build", description: "SharePoint sites and pages built to approved designs in the client tenant." },
      { title: "Testing", description: "User acceptance testing with key stakeholders; issues resolved." },
      { title: "Launch", description: "Intranet launched to the organisation with communications support." },
      { title: "Handover", description: "Full blueprint document and owner training delivered; engagement closed." },
    ];
  }

  if (s.includes("power")) {
    return [
      { title: "Discovery", description: "30-minute call to identify the highest-value process to automate." },
      { title: "Scope", description: "Process mapped end-to-end; automation boundaries and triggers agreed." },
      { title: "Design", description: "Solution design document produced and approved before build begins." },
      { title: "Build", description: "Power Automate flow (or app) built and unit-tested by Shane." },
      { title: "Test", description: "Flow tested in a staging environment with realistic data." },
      { title: "Refine", description: "Client feedback incorporated; edge cases and error handling added." },
      { title: "Deploy", description: "Solution deployed to production and smoke-tested end-to-end." },
      { title: "Handover", description: "Live walkthrough, documentation, and 30-day support window activated." },
    ];
  }

  // Generic fallback
  return [
    { title: "Kickoff", description: "Initial call to align on scope, deliverables, and timeline." },
    { title: "Discovery", description: "Information gathering, requirements review, and access provisioning." },
    { title: "Planning", description: "Detailed work plan produced and agreed with the client." },
    { title: "Execution", description: "Core engagement work carried out according to the agreed plan." },
    { title: "Review", description: "Draft outputs shared with the client for review and feedback." },
    { title: "Delivery", description: "Final deliverables produced and shared with the client." },
    { title: "Sign-off", description: "Client confirms acceptance of all deliverables." },
    { title: "Close", description: "Engagement closed; next steps and any follow-on work agreed." },
  ];
}

/**
 * Seed default workflow steps for a newly activated client service.
 * Idempotent: skips insertion if steps already exist for this clientServiceId.
 */
export async function seedDefaultWorkflowSteps(
  clientServiceId: number,
  projectId: number | null,
  serviceSlug: string,
): Promise<void> {
  // Check if steps already exist for this client service
  const existing = await db
    .select({ id: workflowStepsTable.id })
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.clientServiceId, clientServiceId))
    .limit(1);

  if (existing.length > 0) return; // already seeded

  const steps = getDefaultSteps(serviceSlug);
  await db.insert(workflowStepsTable).values(
    steps.map((s, i) => ({
      clientServiceId,
      projectId: projectId ?? null,
      title: s.title,
      description: s.description,
      status: (i === 0 ? "in_progress" : "pending") as "in_progress" | "pending",
      order: i + 1,
    }))
  );
}
