import bcrypt from "bcryptjs";
import {
  db, usersTable, servicesTable, projectsTable, clientServicesTable,
  workflowStepsTable, kanbanTasksTable, invoicesTable, notificationsTable, projectUpdatesTable
} from "@workspace/db";
import { eq } from "drizzle-orm";

export async function seedMicroOffers(): Promise<void> {
  const [existing] = await db.select().from(servicesTable).where(eq(servicesTable.slug, "m365-health-check")).limit(1);
  if (existing) return;

  await db.insert(servicesTable).values([
    {
      slug: "m365-health-check",
      name: "M365 Health Check",
      description: "A comprehensive audit of your Microsoft 365 environment — covering security posture, licensing efficiency, adoption gaps, and configuration hygiene — delivered as an actionable report in 5 business days.",
      category: "Microsoft 365",
      deliverables: "Executive Health Check Report, Risk Register, Prioritised Remediation Roadmap",
      price: "497.00",
      durationDays: 5,
      turnaround: "5 business days",
      isPublic: true,
    },
    {
      slug: "copilot-readiness",
      name: "Copilot Readiness Assessment",
      description: "Find out if your Microsoft 365 tenant is ready for Copilot — covering licensing, data governance, sensitivity labels, and user adoption posture. Delivered as a scored readiness report with a 90-day activation roadmap.",
      category: "Copilot AI",
      deliverables: "Copilot Readiness Score Report, Gap Analysis, 90-Day Activation Roadmap",
      price: "797.00",
      durationDays: 7,
      turnaround: "7 business days",
      isPublic: true,
    },
    {
      slug: "sharepoint-blueprint",
      name: "SharePoint Intranet Blueprint",
      description: "A detailed information architecture and design blueprint for a modern SharePoint intranet — including site map, navigation design, page type wireframes, and governance recommendations. Ready to hand to any build team.",
      category: "SharePoint",
      deliverables: "Information Architecture Document, Navigation Design, Page Wireframes, Governance Recommendations",
      price: "997.00",
      durationDays: 10,
      turnaround: "10 business days",
      isPublic: true,
    },
    {
      slug: "power-automate",
      name: "Power Automate Quick Win",
      description: "Pick one manual process and we'll automate it end-to-end using Power Automate — scoping, build, test, and handover all included. Delivered in one week.",
      category: "Power Platform",
      deliverables: "Working Power Automate Flow, Process Documentation, 30-Day Support Window",
      price: "597.00",
      durationDays: 5,
      turnaround: "5 business days",
      isPublic: true,
    },
    {
      slug: "security-audit",
      name: "M365 Security & Governance Audit",
      description: "A deep-dive security and governance audit of your Microsoft 365 tenant — covering identity, data protection, device compliance, threat policies, and admin hygiene — with a prioritised remediation plan.",
      category: "Governance",
      deliverables: "Security Audit Report, Risk Matrix, Prioritised Remediation Plan, Optional Debrief Call",
      price: "897.00",
      durationDays: 7,
      turnaround: "7 business days",
      isPublic: true,
    },
    {
      slug: "copilot-prompts",
      name: "Copilot Prompt Library Build",
      description: "A ready-to-use, role-organised Microsoft 365 Copilot prompt library built for your team — covering Word, Excel, Teams, Outlook, and Loop — delivered as an editable SharePoint page or Word document.",
      category: "Copilot AI",
      deliverables: "Role-Organised Prompt Library, Short Video Walkthrough, Prompt Maintenance Guide",
      price: "397.00",
      durationDays: 5,
      turnaround: "5 business days",
      isPublic: true,
    },
  ]);
}

export async function seedConsultingServices(): Promise<void> {
  const [existing] = await db.select().from(servicesTable).where(eq(servicesTable.slug, "m365-consulting")).limit(1);
  if (existing) return;

  await db.insert(servicesTable).values([
    {
      slug: "m365-consulting",
      name: "Microsoft 365 Setup & Optimization",
      description: "Ongoing Microsoft 365 architecture consulting — tenant configuration, security hardening, workload adoption, and continuous optimization. Billed monthly, cancel any time.",
      category: "Microsoft 365",
      deliverables: "Monthly strategy call, tenant health monitoring, priority recommendations, written progress report",
      price: "1500.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
    {
      slug: "copilot-ai-consulting",
      name: "Copilot AI Readiness & Deployment",
      description: "Ongoing Copilot AI governance, deployment, and adoption support — from readiness assessment through rollout and user training. Billed monthly.",
      category: "Copilot AI",
      deliverables: "Monthly strategy call, copilot governance review, adoption metrics, written progress report",
      price: "2000.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
    {
      slug: "sharepoint-consulting",
      name: "SharePoint Architecture & Intranets",
      description: "Ongoing SharePoint architecture, intranet design, and governance consulting. Covers information architecture, navigation, taxonomy, and permissions. Billed monthly.",
      category: "SharePoint",
      deliverables: "Monthly strategy call, IA review, governance recommendations, written progress report",
      price: "1500.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
    {
      slug: "power-platform-consulting",
      name: "Power Platform & Automation",
      description: "Ongoing Power Automate and Power Apps consulting — automation design, build oversight, governance, and continuous improvement. Billed monthly.",
      category: "Power Platform",
      deliverables: "Monthly strategy call, automation review, flow builds and improvements, written progress report",
      price: "1500.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
    {
      slug: "governance-consulting",
      name: "Governance, Compliance & Security",
      description: "Ongoing Microsoft 365 security, compliance, and governance consulting — DLP, sensitivity labels, Purview, conditional access, and admin hygiene. Billed monthly.",
      category: "Governance",
      deliverables: "Monthly strategy call, security posture review, policy updates, written progress report",
      price: "2000.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
    {
      slug: "cloud-migration-consulting",
      name: "Cloud Migration Services",
      description: "Ongoing cloud migration planning, execution oversight, and post-migration support — Exchange, SharePoint, and full M365 migrations. Billed monthly.",
      category: "Migration",
      deliverables: "Monthly strategy call, migration planning, execution oversight, written progress report",
      price: "2500.00",
      turnaround: null,
      billingType: "recurring_monthly",
      isPublic: true,
    },
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
