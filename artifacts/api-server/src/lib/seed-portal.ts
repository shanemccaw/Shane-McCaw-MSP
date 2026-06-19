import bcrypt from "bcryptjs";
import {
  db, usersTable, servicesTable, projectsTable, clientServicesTable,
  workflowStepsTable, kanbanTasksTable, invoicesTable, notificationsTable, projectUpdatesTable,
  workflowTemplatesTable, workflowTemplateStepsTable, projectTemplatesTable, projectTemplateTasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Seeds the "M365 Onboarding Workflow" template and the "M365 Health Check Project"
 * project template (linked to the M365 Health Check service).
 *
 * These templates power the auto-project generation hook in portal.ts:
 * when an admin activates the M365 Health Check service for a client,
 * a project is automatically created and 7 workflow steps are seeded
 * from these template tasks.
 *
 * Idempotent — no-op if the workflow template already exists.
 */
export async function seedServiceTemplates(): Promise<void> {
  const [existing] = await db
    .select()
    .from(workflowTemplatesTable)
    .where(eq(workflowTemplatesTable.name, "M365 Onboarding Workflow"))
    .limit(1);
  if (existing) return;

  // Look up the M365 Health Check service
  const [m365Service] = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.slug, "m365-health-check"))
    .limit(1);

  if (!m365Service) return;

  // 1. Create the workflow template
  const [wfTemplate] = await db
    .insert(workflowTemplatesTable)
    .values({
      name: "M365 Onboarding Workflow",
      description: "Standard onboarding workflow for Microsoft 365 consulting engagements",
      serviceId: m365Service.id,
    })
    .returning();

  // 2. Seed the workflow steps
  await db.insert(workflowTemplateStepsTable).values([
    { workflowTemplateId: wfTemplate.id, title: "Discovery & Kickoff Call", description: "Align on scope, goals, and success criteria. Gather access credentials and key stakeholder contacts.", order: 0 },
    { workflowTemplateId: wfTemplate.id, title: "Environment Assessment", description: "Audit current M365 tenant configuration, license assignments, security posture, and usage patterns.", order: 1 },
    { workflowTemplateId: wfTemplate.id, title: "Findings & Gap Analysis", description: "Document identified gaps, risks, and opportunities. Prepare a prioritised findings report.", order: 2 },
    { workflowTemplateId: wfTemplate.id, title: "Recommendations Review", description: "Walk through findings with the client team. Agree on priority areas and implementation roadmap.", order: 3 },
    { workflowTemplateId: wfTemplate.id, title: "Implementation & Delivery", description: "Execute agreed-upon changes and configurations in the M365 environment.", order: 4 },
    { workflowTemplateId: wfTemplate.id, title: "Handoff & Documentation", description: "Deliver final documentation, admin guides, and training resources. Sign off on deliverables.", order: 5 },
  ]);

  // 3. Create the project template linked to the workflow template and service
  const [projTemplate] = await db
    .insert(projectTemplatesTable)
    .values({
      name: "M365 Health Check Project",
      workflowTemplateId: wfTemplate.id,
      serviceId: m365Service.id,
    })
    .returning();

  // 4. Seed the project template tasks (these become workflow_steps when the service is activated)
  await db.insert(projectTemplateTasksTable).values([
    { projectTemplateId: projTemplate.id, title: "Discovery & Kickoff Call", description: "Align on scope, goals, and key contacts. Confirm access requirements and define success criteria.", order: 0 },
    { projectTemplateId: projTemplate.id, title: "M365 Tenant Access & Setup", description: "Grant Shane read-only admin access. Configure audit logging and export settings for the review.", order: 1 },
    { projectTemplateId: projTemplate.id, title: "Environment Assessment", description: "Review licence utilisation, security defaults, identity configuration, and service adoption.", order: 2 },
    { projectTemplateId: projTemplate.id, title: "Findings & Gap Analysis Report", description: "Receive the detailed findings document covering risks, gaps, and optimisation opportunities.", order: 3 },
    { projectTemplateId: projTemplate.id, title: "Recommendations Review Call", description: "Walk through the findings together. Prioritise action items and agree on next steps.", order: 4 },
    { projectTemplateId: projTemplate.id, title: "Implementation Roadmap Delivered", description: "Receive the final 90-day roadmap with prioritised actions, effort estimates, and quick wins.", order: 5 },
    { projectTemplateId: projTemplate.id, title: "Project Closeout", description: "Final sign-off, documentation handoff, and transition to ongoing support if applicable.", order: 6 },
  ]);
}

export async function seedPortalDemo(): Promise<void> {
  // Check if demo client already exists
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, "demo@shanemccaw.com")).limit(1);
  if (existing) return;

  // Create demo client — password from env var (dev-only; seeder is skipped in production)
  const demoPassword = process.env.PORTAL_DEMO_PASSWORD;
  if (!demoPassword) {
    console.warn("[seed-portal] PORTAL_DEMO_PASSWORD env var not set — skipping demo data seed. Set it to create the demo client account.");
    return;
  }
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const [client] = await db.insert(usersTable).values({
    email: "demo@shanemccaw.com",
    passwordHash,
    role: "client",
    name: "Contoso Corp",
    company: "Contoso Corporation",
    phone: "+1 (555) 012-3456",
  }).returning();

  // Create services
  const [svc1] = await db.insert(servicesTable).values({
    name: "Microsoft 365 Copilot Deployment",
    description: "Full Copilot rollout including readiness assessment, pilot, training, and go-live.",
    category: "Copilot AI",
    deliverables: "Readiness Report, Deployment Plan, Training Materials, Go-Live Support",
    price: "9500.00",
    durationDays: 45,
  }).returning();

  const [svc2] = await db.insert(servicesTable).values({
    name: "SharePoint Intranet Redesign",
    description: "Modern SharePoint intranet design and migration from legacy platform.",
    category: "SharePoint",
    deliverables: "Information Architecture, Page Templates, Migration Script, User Guide",
    price: "7200.00",
    durationDays: 30,
  }).returning();

  const [svc3] = await db.insert(servicesTable).values({
    name: "M365 Governance Quick-Start",
    description: "Governance framework, DLP policies, and sensitivity labels configured in 5 days.",
    category: "Governance",
    deliverables: "Governance Policy Doc, DLP Config, Sensitivity Label Schema",
    price: "3500.00",
    durationDays: 5,
  }).returning();

  // Create project
  const [project] = await db.insert(projectsTable).values({
    title: "Contoso M365 Copilot Deployment",
    description: "Full Microsoft 365 Copilot rollout for Contoso Corporation — 500 seat enterprise.",
    status: "active",
    phase: "Pilot Phase",
    progress: 45,
    clientUserId: client.id,
    startDate: new Date("2026-05-01"),
    endDate: new Date("2026-07-15"),
  }).returning();

  // Assign services to client
  const [cs1] = await db.insert(clientServicesTable).values({
    clientUserId: client.id,
    serviceId: svc1.id,
    projectId: project.id,
    status: "active",
    progress: 45,
    startDate: new Date("2026-05-01"),
    nextMilestone: "Pilot go-live with 50 users",
    nextMilestoneDate: new Date("2026-06-30"),
  }).returning();

  const [cs2] = await db.insert(clientServicesTable).values({
    clientUserId: client.id,
    serviceId: svc2.id,
    projectId: project.id,
    status: "active",
    progress: 20,
    startDate: new Date("2026-05-15"),
    nextMilestone: "IA review sign-off",
    nextMilestoneDate: new Date("2026-06-20"),
  }).returning();

  await db.insert(clientServicesTable).values({
    clientUserId: client.id,
    serviceId: svc3.id,
    projectId: null,
    status: "completed",
    progress: 100,
    startDate: new Date("2026-04-07"),
    nextMilestone: null,
    nextMilestoneDate: null,
  }).returning();

  // Workflow steps for service 1
  await db.insert(workflowStepsTable).values([
    { clientServiceId: cs1.id, title: "Readiness Assessment", description: "Survey 50 stakeholders and assess M365 tenant health.", status: "completed", order: 1, completedAt: new Date("2026-05-15") },
    { clientServiceId: cs1.id, title: "Pilot User Selection", description: "Identify and onboard 50 pilot users across departments.", status: "completed", order: 2, completedAt: new Date("2026-05-28") },
    { clientServiceId: cs1.id, title: "Training Delivery", description: "Run 3 live training sessions + async video modules.", status: "in_progress", order: 3 },
    { clientServiceId: cs1.id, title: "Pilot Go-Live", description: "Enable Copilot licences for pilot cohort, monitor adoption.", status: "pending", order: 4 },
    { clientServiceId: cs1.id, title: "Broader Rollout", description: "Expand to all 500 seats with support runway.", status: "pending", order: 5 },
  ]);

  // Workflow steps for service 2
  await db.insert(workflowStepsTable).values([
    { clientServiceId: cs2.id, title: "Information Architecture", description: "Design site map and navigation structure.", status: "completed", order: 1, completedAt: new Date("2026-05-22") },
    { clientServiceId: cs2.id, title: "Design Review", description: "Stakeholder review of wireframes and brand alignment.", status: "in_progress", order: 2 },
    { clientServiceId: cs2.id, title: "Content Migration", description: "Migrate pages from legacy SharePoint 2016.", status: "pending", order: 3 },
    { clientServiceId: cs2.id, title: "User Acceptance Testing", description: "UAT with department leads.", status: "pending", order: 4 },
    { clientServiceId: cs2.id, title: "Go-Live", description: "Publish new intranet and decommission old site.", status: "pending", order: 5 },
  ]);

  // Workflow steps for project
  await db.insert(workflowStepsTable).values([
    { projectId: project.id, title: "Kick-off Meeting", status: "completed", order: 1, completedAt: new Date("2026-05-02") },
    { projectId: project.id, title: "Tenant Assessment", status: "completed", order: 2, completedAt: new Date("2026-05-12") },
    { projectId: project.id, title: "Pilot Deployment", status: "in_progress", order: 3 },
    { projectId: project.id, title: "Training Programme", status: "in_progress", order: 4 },
    { projectId: project.id, title: "Full Rollout", status: "pending", order: 5 },
    { projectId: project.id, title: "Handover & Documentation", status: "pending", order: 6 },
  ]);

  // Kanban tasks
  await db.insert(kanbanTasksTable).values([
    { projectId: project.id, title: "Configure Copilot policies in M365 admin", column: "completed", order: 1, assignedTo: "Shane" },
    { projectId: project.id, title: "Complete readiness survey analysis", column: "completed", order: 2, assignedTo: "Shane" },
    { projectId: project.id, title: "Run training session for Finance dept", column: "in_progress", order: 1, assignedTo: "Shane", dueDate: new Date("2026-06-25") },
    { projectId: project.id, title: "Review Teams meeting room standards", column: "in_progress", order: 2, assignedTo: "Client IT", dueDate: new Date("2026-06-28") },
    { projectId: project.id, title: "Enable Copilot for pilot cohort (50 users)", column: "waiting_on_customer", order: 1, assignedTo: "Client IT", dueDate: new Date("2026-06-30") },
    { projectId: project.id, title: "Approve final governance policy document", column: "waiting_on_customer", order: 2, dueDate: new Date("2026-07-05") },
    { projectId: project.id, title: "Build SharePoint IA wireframes", column: "backlog", order: 1, assignedTo: "Shane" },
    { projectId: project.id, title: "Conduct UAT for intranet redesign", column: "backlog", order: 2 },
    { projectId: project.id, title: "Draft full-rollout change management plan", column: "backlog", order: 3, assignedTo: "Shane", dueDate: new Date("2026-07-10") },
  ]);

  // Project updates (communication log)
  await db.insert(projectUpdatesTable).values([
    { projectId: project.id, authorUserId: null, content: "Project kicked off. Kick-off call completed with IT and HR stakeholders.", type: "milestone", createdAt: new Date("2026-05-02") },
    { projectId: project.id, authorUserId: null, content: "Tenant health assessment completed. 3 licensing gaps identified and flagged to IT.", type: "update", createdAt: new Date("2026-05-12") },
    { projectId: project.id, authorUserId: null, content: "Readiness survey closed — 47 of 50 responses received. Full report shared in Documents.", type: "update", createdAt: new Date("2026-05-20") },
    { projectId: project.id, authorUserId: null, content: "Pilot user list finalised: 50 users across Finance, HR, and IT confirmed.", type: "milestone", createdAt: new Date("2026-05-28") },
    { projectId: project.id, authorUserId: null, content: "Training session 1 (Finance) delivered via Teams. Recording uploaded to SharePoint.", type: "update", createdAt: new Date("2026-06-10") },
  ]);

  // Invoices
  await db.insert(invoicesTable).values([
    {
      clientUserId: client.id,
      projectId: project.id,
      invoiceNumber: "INV-2026-001",
      description: "M365 Copilot Deployment — Milestone 1: Readiness & Setup",
      amount: "4750.00",
      currency: "usd",
      status: "paid",
      dueDate: new Date("2026-05-15"),
      paidAt: new Date("2026-05-14"),
    },
    {
      clientUserId: client.id,
      projectId: project.id,
      invoiceNumber: "INV-2026-002",
      description: "M365 Copilot Deployment — Milestone 2: Pilot & Training",
      amount: "4750.00",
      currency: "usd",
      status: "due",
      dueDate: new Date("2026-07-01"),
    },
    {
      clientUserId: client.id,
      projectId: project.id,
      invoiceNumber: "INV-2026-003",
      description: "SharePoint Intranet Redesign — Milestone 1",
      amount: "3600.00",
      currency: "usd",
      status: "overdue",
      dueDate: new Date("2026-06-01"),
    },
  ]);

  // Notifications
  await db.insert(notificationsTable).values([
    {
      userId: client.id,
      title: "Training session 1 completed",
      body: "Finance department training session recorded and uploaded.",
      type: "project_update",
      read: true,
      linkPath: `/portal/projects/${project.id}`,
    },
    {
      userId: client.id,
      title: "Invoice INV-2026-002 due 1 July",
      body: "Your invoice for $4,750 is due on July 1, 2026.",
      type: "invoice",
      read: false,
      linkPath: "/portal/billing",
    },
    {
      userId: client.id,
      title: "Invoice INV-2026-003 is overdue",
      body: "Invoice for $3,600 was due June 1. Please arrange payment.",
      type: "invoice",
      read: false,
      linkPath: "/portal/billing",
    },
    {
      userId: client.id,
      title: "Action required: Enable Copilot licences",
      body: "Please enable Copilot licences for the 50 pilot users in M365 Admin.",
      type: "project_update",
      read: false,
      linkPath: `/portal/projects/${project.id}`,
    },
  ]);
}
