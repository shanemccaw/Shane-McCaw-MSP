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

export async function seedMarketingServices(): Promise<void> {
  const { sql: sqlTag, inArray } = await import("drizzle-orm");

  // Fix stale records that were mis-categorised as "service_area" in an earlier seed
  // run but don't have dedicated /services/* sub-pages. Reclassify them as "retainer"
  // and point their pageHref at the pricing page where they actually live.
  const staleSlugs = ["architect-essentials", "architect-growth", "architect-enterprise", "fractional-m365-architect-retainer"];
  await db
    .update(servicesTable)
    .set({ serviceType: "retainer", pageHref: "/pricing" })
    .where(inArray(servicesTable.slug, staleSlugs));
  const microOffers = [
    {
      slug: "m365-health-check",
      name: "M365 Health Check",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "497.00",
      turnaround: "2 business days",
      description: "A full audit of your M365 tenant configuration — permissions, sharing policies, licensing gaps, and security posture — with a prioritized remediation report.",
      deliverables: "Written audit report + remediation priority list",
      targetAudience: "Organizations unsure how well their M365 tenant is configured or who want a baseline before deeper work.",
      inclusions: [
        "90-minute live audit session via video call",
        "Review of tenant settings, security configuration, and permissions",
        "Assessment of Teams, SharePoint, OneDrive, and Exchange setup",
        "Comprehensive written report with prioritized findings",
        "30-minute debrief call to walk through recommendations",
      ],
      badge: null,
      highlighted: false,
      sortOrder: 0,
      isPublic: true,
    },
    {
      slug: "copilot-readiness",
      name: "Copilot Readiness Assessment",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "797.00",
      turnaround: "5 business days",
      description: "A six-dimension readiness scorecard for Copilot deployment: licensing, identity, permissions, governance, sensitivity labeling, and oversharing risk.",
      deliverables: "Readiness scorecard + deployment roadmap",
      targetAudience: "Organizations that have purchased or are considering Microsoft Copilot licenses and want to ensure safe, successful deployment.",
      inclusions: [
        "Full audit of data governance, sensitivity labels, and DLP policies",
        "Review of SharePoint permissions and oversharing risks",
        "Licensing review and optimization recommendations",
        "Copilot deployment readiness score with findings report",
        "Custom deployment roadmap and adoption strategy",
        "45-minute debrief and Q&A session",
      ],
      badge: "Most requested",
      highlighted: false,
      sortOrder: 1,
      isPublic: true,
    },
    {
      slug: "sharepoint-blueprint",
      name: "SharePoint Intranet Blueprint",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "997.00",
      turnaround: "7 business days",
      description: "A complete information architecture and navigation blueprint for a SharePoint intranet — site structure, permission model, governance policy, and rollout sequence.",
      deliverables: "IA document + governance policy + rollout plan",
      targetAudience: "Organizations planning a new SharePoint intranet or needing to redesign an existing one that isn't working.",
      inclusions: [
        "Discovery session to understand organizational structure and needs",
        "Information architecture design",
        "Site map and navigation strategy",
        "Taxonomy and metadata framework",
        "Wireframe for key page types",
        "Written blueprint document with implementation guidance",
      ],
      badge: null,
      highlighted: false,
      sortOrder: 2,
      isPublic: true,
    },
    {
      slug: "power-automate",
      name: "Power Automate Quick Win",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "597.00",
      turnaround: "5–7 business days",
      description: "Shane identifies, designs, and builds one high-impact Power Automate flow for your organization — documented and handed off with user instructions.",
      deliverables: "Live flow + documentation + handoff walkthrough",
      targetAudience: "Organizations with a specific manual process they want to automate using Power Automate.",
      inclusions: [
        "Discovery call to document the target process",
        "Design and build of one Power Automate flow",
        "Testing and error handling configuration",
        "Documentation and knowledge transfer",
        "30-day email support post-delivery",
      ],
      badge: null,
      highlighted: false,
      sortOrder: 3,
      isPublic: true,
    },
    {
      slug: "security-audit",
      name: "M365 Security & Governance Audit",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "897.00",
      turnaround: "5 business days",
      description: "An in-depth review of your DLP policies, retention labels, conditional access rules, and Entra ID posture — with specific remediation steps for each gap found.",
      deliverables: "Security audit report + DLP/retention gap analysis",
      targetAudience: "Organizations in regulated industries or those who've experienced a security incident and need a compliance assessment.",
      inclusions: [
        "Full review of DLP policies, sensitivity labels, and retention",
        "Conditional access policy audit",
        "Admin role and permissions review",
        "Guest access and external sharing assessment",
        "Purview compliance posture review",
        "Prioritized remediation report",
      ],
      badge: null,
      highlighted: false,
      sortOrder: 4,
      isPublic: true,
    },
    {
      slug: "copilot-prompts",
      name: "Copilot Prompt Library Build",
      serviceType: "micro_offer",
      billingType: "one_time" as const,
      price: "397.00",
      turnaround: "5 business days",
      description: "A custom library of 25+ role-specific Copilot prompts built for your organization's departments — covering your actual workflows, not generic examples.",
      deliverables: "Role-specific prompt library (Word + SharePoint-ready)",
      targetAudience: "Organizations that have deployed Copilot but are struggling with adoption because employees don't know how to use it effectively.",
      inclusions: [
        "Discovery call to understand your team's key use cases",
        "Custom library of 25+ role-specific Copilot prompts",
        "Prompts organized by department and task type",
        "Formatted as a sharable, editable document",
        "Tips for prompt refinement and iteration",
      ],
      badge: null,
      highlighted: false,
      sortOrder: 5,
      isPublic: true,
    },
  ];

  const retainers = [
    {
      slug: "architect-essentials",
      name: "Architect Essentials",
      serviceType: "retainer",
      billingType: "recurring_monthly" as const,
      price: "1500.00",
      hoursPerMonth: "10 hours",
      tagline: "Right for organizations that need a senior M365 resource on call — without the overhead of a full-time hire.",
      features: [
        "10 hours of consulting per month",
        "Email and Teams support",
        "Monthly strategy call (60 min)",
        "Standard response within 1 business day",
        "Access to all M365 service areas",
        "Monthly written summary",
      ],
      highlighted: false,
      sortOrder: 0,
      isPublic: true,
    },
    {
      slug: "architect-growth",
      name: "Architect Growth",
      serviceType: "retainer",
      billingType: "recurring_monthly" as const,
      price: "3000.00",
      hoursPerMonth: "25 hours",
      tagline: "Right for organizations actively modernizing their M365 environment or planning a Copilot deployment.",
      features: [
        "25 hours of consulting per month",
        "Priority email and Teams support",
        "Two strategy calls per month (60 min each)",
        "Priority response within 4 business hours",
        "Access to all M365 service areas",
        "Monthly written progress report",
        "Proactive tenant health monitoring",
      ],
      highlighted: true,
      badge: "Most Popular",
      sortOrder: 1,
      isPublic: true,
    },
    {
      slug: "architect-enterprise",
      name: "Architect Enterprise",
      serviceType: "retainer",
      billingType: "recurring_monthly" as const,
      price: "5500.00",
      hoursPerMonth: "50 hours",
      tagline: "Right for organizations that need a dedicated senior architect embedded in their operations every week.",
      features: [
        "50 hours of consulting per month",
        "Dedicated Teams support channel",
        "Weekly strategy calls (60 min)",
        "Same-day emergency response",
        "Access to all M365 service areas",
        "Monthly written progress report",
        "Custom technology roadmap",
        "Quarterly strategic review",
      ],
      highlighted: false,
      sortOrder: 2,
      isPublic: true,
    },
  ];

  const serviceAreas = [
    {
      slug: "service-area-m365",
      name: "Microsoft 365 Setup & Optimization",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "Whether starting fresh or fixing a misconfigured tenant, I architect M365 environments that are secure, scalable, and built for your team.",
      iconName: "Cloud",
      pageHref: "/services/microsoft-365",
      sortOrder: 0,
      isPublic: true,
    },
    {
      slug: "service-area-copilot-ai",
      name: "Copilot AI Readiness & Deployment",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "I assess readiness, govern your data, configure your environment, and coach your team so your Copilot investment pays off from day one.",
      iconName: "Bot",
      pageHref: "/services/copilot-ai",
      sortOrder: 1,
      isPublic: true,
    },
    {
      slug: "service-area-sharepoint",
      name: "SharePoint Architecture & Intranets",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "Modern intranets employees actually use — built with expert information architecture, navigation, and taxonomy design.",
      iconName: "Layout",
      pageHref: "/services/sharepoint",
      sortOrder: 2,
      isPublic: true,
    },
    {
      slug: "service-area-power-platform",
      name: "Power Platform & Automation",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "Replace manual processes with Power Automate workflows and custom Power Apps at a fraction of traditional development cost.",
      iconName: "Zap",
      pageHref: "/services/power-platform",
      sortOrder: 3,
      isPublic: true,
    },
    {
      slug: "service-area-governance",
      name: "Governance, Compliance & Security",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "DLP policies, sensitivity labels, retention, Purview, and permissions built to NASA-grade standards.",
      iconName: "Shield",
      pageHref: "/services/governance",
      sortOrder: 4,
      isPublic: true,
    },
    {
      slug: "service-area-cloud-migration",
      name: "Cloud Migration Services",
      serviceType: "service_area",
      billingType: "one_time" as const,
      description: "Exchange, SharePoint, and M365 migrations executed with zero-drama precision and zero data loss.",
      iconName: "Server",
      pageHref: "/services/cloud-migration",
      sortOrder: 5,
      isPublic: true,
    },
  ];

  for (const record of [...microOffers, ...retainers, ...serviceAreas]) {
    const { slug, ...rest } = record as Record<string, unknown> & { slug: string };
    await db
      .insert(servicesTable)
      .values({ slug, ...(rest as typeof servicesTable.$inferInsert) })
      .onConflictDoUpdate({
        target: servicesTable.slug,
        set: rest as Partial<typeof servicesTable.$inferInsert>,
      });
  }
  void sqlTag;
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
