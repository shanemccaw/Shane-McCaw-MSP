import { db, articlesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const SEED_ARTICLES = [
  {
    slug: "copilot-rollout-failing",
    category: "Copilot AI Tips",
    title: "5 Reasons Your Copilot Rollout Is Failing (And How to Fix It)",
    summary: "Most Copilot deployments underperform not because of the AI, but because of data governance gaps and lack of adoption strategy. Here are the five most common failure points and exactly how to address each one.",
    date: "June 5, 2025",
    content: `Microsoft 365 Copilot is the most powerful productivity tool Microsoft has shipped in a generation. But in my work helping organizations deploy it — including managing enterprise M365 environments at NASA — I keep seeing the same failure patterns play out. The problem is almost never the AI itself. It's the environment around it.

If your Copilot rollout is delivering disappointing results, here are the five most common reasons — and exactly what to do about each one.

## 1. Your Data Governance Foundation Is Broken

Copilot surfaces content from across your Microsoft 365 tenant — SharePoint, Teams, Outlook, OneDrive — based on the permissions of the user asking. If your permissions are overly broad (which is true in most tenants), Copilot will eagerly surface sensitive content that users shouldn't be seeing at all.

Before any Copilot rollout, you need a permission audit. Map which SharePoint sites, Teams channels, and document libraries have 'Everyone' or 'Everyone except external users' access. Tighten those permissions before Copilot gets turned on. This is non-negotiable.

> Fix: Run a SharePoint permission report using the SharePoint Admin Center or PnP PowerShell. Remediate sites with overly broad access before enabling Copilot for any users.

## 2. Sensitivity Labels Are Either Missing or Not Enforced

Sensitivity labels are the control plane for Copilot. Without them, the AI has no way to understand the classification of the content it's working with. Organizations that deploy Copilot without a mature sensitivity labeling scheme end up with an AI that treats a confidential contract the same as a cafeteria menu.

You need a label taxonomy that maps to your actual data classifications, auto-labeling policies for high-value content, and DLP rules that restrict what Copilot can do with labeled content. This takes time to get right, but it's the only way to deploy responsibly.

## 3. No Adoption Strategy — Just License Assignment

I see this constantly. An IT team gets Copilot licenses approved, assigns them to users, sends a single 'Copilot is now available!' email, and wonders why adoption is flat six months later.

Copilot requires habit change. Users need to understand what it can do for their specific job role, see it demonstrated in workflows they care about, and have a place to ask questions and share wins. A dedicated Copilot Champions program — even a small one — dramatically accelerates adoption.

- Identify 5–10 power users as Copilot Champions in each department
- Create a shared Teams channel for Copilot tips, questions, and success stories
- Run role-specific training sessions, not generic 'here's what Copilot can do' demos
- Publish a monthly digest of the best Copilot prompts discovered by the team

## 4. Prompting Skills Are Not Being Developed

Copilot's output quality is directly proportional to the quality of the prompts it receives. 'Summarize this meeting' gets a very different result from 'Summarize this meeting, highlighting action items assigned to me and any decisions that need leadership approval.' The second prompt is what great Copilot users write naturally. The first is what most users start with.

Build a prompt library for your organization. Collect the most effective prompts for your team's common workflows — meeting preparation, document drafting, data analysis, email composition — and make them easily accessible in a SharePoint page or Teams tab.

## 5. You Deployed to the Wrong Users First

Copilot license costs are significant. Many organizations try to maximize ROI by giving licenses to senior executives and knowledge workers first. This seems logical, but it often backfires: executives have high-complexity workflows and limited patience for iterating on prompts, while their assistants — who manage their calendars and communications — would unlock massive value immediately.

The best Copilot rollouts start with highly motivated, tech-comfortable users in roles with clear, repeatable workflows: project managers, content creators, analysts, and team leads. They'll generate the success stories that build momentum for broader adoption.

> The organizations that succeed with Copilot treat it as a change management initiative first, and a technology deployment second. The technology works. The hard part is the human side.

If your Copilot rollout is struggling, I offer a focused Copilot Readiness Assessment that diagnoses exactly where the gaps are and gives you a prioritized remediation plan. Reach out to discuss what that looks like for your organization.`,
  },
  {
    slug: "dlp-sensitivity-labels",
    category: "Governance & Compliance",
    title: "DLP and Sensitivity Labels: The Governance Stack Every Organization Needs",
    summary: "Data loss prevention and sensitivity labeling are the foundation of a secure Microsoft 365 environment — especially with Copilot in the picture. Here's how to build and govern them correctly.",
    date: "April 10, 2025",
    content: `Copilot changes the stakes for data governance fundamentally. In a traditional M365 environment, a user can only access content they navigate to. With Copilot, the AI can surface and summarize content from across the tenant — limited only by the user's permissions. If your permissions are sloppy and your data classification is nonexistent, Copilot will eagerly expose things that should never be surfaced.

This is why I tell every organization: before you turn on Copilot, get your sensitivity labels and DLP policies right. Here's how.

## Start With a Data Classification Framework

Sensitivity labels are only as good as the classification framework behind them. Before you configure anything in the Microsoft Purview compliance portal, spend time defining your data classification taxonomy. Most organizations need four to five levels: something like Public, Internal, Confidential, Highly Confidential, and Restricted.

Each level should have a clear definition that any employee can understand. 'Confidential' means something specific about who can access it, how it can be shared, and what controls apply. That definition drives the label configuration — it's not the other way around.

> Critical: Your classification framework must be built with your Legal, HR, and Information Security teams — not just IT. The definitions of 'Confidential' and 'Restricted' have legal implications that IT cannot define unilaterally.

## Sensitivity Label Configuration

Once the framework is defined, configure the labels in Microsoft Purview. Key decisions for each label include: Does it apply encryption? Does it add visual markings (headers, footers, watermarks)? Does it restrict copying, printing, or forwarding? Does it prevent sharing outside the organization?

- Start with labels that apply markings only, before adding encryption — this builds the habit without disrupting workflows
- Use sublabels for use-case-specific variants (e.g., Confidential > HR Only, Confidential > Legal Only)
- Configure label inheritance for Teams and SharePoint sites — container labels apply to all content within
- Test encryption labels thoroughly with cross-tenant and external sharing scenarios before rolling out broadly

## Auto-Labeling Policies

Manual labeling by users is valuable but insufficient. Users are busy and inconsistent. Auto-labeling policies in Microsoft Purview can automatically apply or recommend labels based on content detected in documents and emails — credit card numbers, Social Security numbers, medical record numbers, passport numbers, and hundreds of other sensitive information types.

Run auto-labeling in simulation mode first. Before you turn on automatic enforcement, run policies in 'simulation' mode for at least two weeks. The simulation report shows you how many items would be labeled and lets you tune the policies to reduce false positives before enforcement begins.

## Data Loss Prevention Policies

DLP policies are the enforcement layer. They detect sensitive content in SharePoint, OneDrive, Exchange, Teams, and endpoint devices, and take action — blocking sharing, generating alerts, requiring user justification — based on rules you configure.

The most important DLP policies to get right are those governing external sharing of sensitive content. A policy that prevents a user from emailing a document labeled 'Highly Confidential' to an external address is one of the highest-impact controls you can put in place.

- Block external sharing of Highly Confidential and Restricted labeled content
- Require business justification for sharing Confidential content externally
- Alert the compliance team when labeled content is accessed from unmanaged devices
- Configure endpoint DLP to control copying sensitive content to USB drives or personal cloud storage

## Governing the Governance

The final piece is often the most neglected: label and DLP policy governance. Your taxonomy needs a review cadence. New data types, regulatory changes, and business evolution all require updates to your classification framework. Assign a data governance committee that meets at least annually to review and update the framework. Without this, labels become stale and users stop trusting them.

Building a mature sensitivity labeling and DLP posture is one of the most complex compliance initiatives an M365 organization can undertake — and one of the most important. If you're starting from scratch or trying to remediate a messy existing implementation, a structured Governance & Compliance Sprint is usually the right starting point.`,
  },
  {
    slug: "m365-migration-checklist",
    category: "Digital Transformation",
    title: "Microsoft 365 Migration Checklist: 30 Things to Do Before You Move",
    summary: "M365 migrations fail when teams skip the discovery and planning phase. This checklist covers every critical item — from license mapping to identity readiness — that you should verify before migrating a single mailbox.",
    date: "March 27, 2025",
    content: `In my experience overseeing M365 migrations for large organizations, the failures almost always trace back to one cause: insufficient discovery and planning. Teams move too fast to get to the 'exciting' parts — the cutover, the new features, the clean new environment — and skip the hard, unglamorous work of understanding the current state.

This checklist covers the 30 critical items I verify before any M365 migration begins. Use it as a pre-migration gate — don't proceed until every item is addressed.

## Identity Readiness (Items 1–7)

- 1. Directory is clean: no stale accounts, service accounts documented, guest accounts reviewed
- 2. UPN suffix matches the primary SMTP domain users will use in M365
- 3. Azure AD Connect (or Entra Connect) is scoped, tested, and validated in staging
- 4. MFA rollout plan is complete before first user migrations begin
- 5. Conditional Access baseline policies are configured in the target tenant
- 6. Privileged Identity Management is configured for admin roles
- 7. Break-glass emergency access accounts are created and documented

## Licensing (Items 8–12)

- 8. License requirements are mapped by user role, not assumed to be one-size-fits-all
- 9. License count includes a buffer for the overlap period during migration
- 10. Licensing for hybrid coexistence features (Exchange hybrid, Teams interop) is confirmed
- 11. Any third-party tools with M365 dependencies have compatible licensing
- 12. License assignment strategy is defined — direct assignment, group-based, or via automation

## Exchange Online Readiness (Items 13–17)

> Email is the migration item users feel most immediately. Problems here generate the most support tickets and erode confidence in the entire project. Get it right.

- 13. DNS records (MX, SPF, DKIM, DMARC) are planned, tested, and staged for cutover
- 14. Mailbox size distribution is understood — large mailboxes need migration priority planning
- 15. Shared mailboxes, room mailboxes, and equipment mailboxes are inventoried
- 16. Shared calendar and resource booking workflows are documented
- 17. Mail flow rules and connectors in the source environment are inventoried for re-creation

## SharePoint and OneDrive (Items 18–22)

- 18. Content inventory is complete: sites, document libraries, list items, and estimated data volume
- 19. Customizations (classic web parts, InfoPath forms, custom workflows) are documented and have a modernization plan
- 20. External sharing and permissions are audited before migration (don't migrate broken permissions)
- 21. OneDrive sync client version is confirmed compatible with the target tenant
- 22. Large file exclusions are configured in the migration tool — files over the M365 size limit will fail

## Teams and Collaboration (Items 23–26)

- 23. Teams creation policy is defined before users get access — governance later is harder
- 24. Guest access policy is configured based on your security requirements
- 25. Phone System / Direct Routing dependencies are identified if voice is in scope
- 26. Third-party integrations (connectors, bots, apps) are inventoried and validated for M365 compatibility

## Governance and Compliance (Items 27–30)

- 27. Retention policies are designed for the target environment before any content moves
- 28. eDiscovery holds in the source environment are documented and preserved
- 29. Audit log settings are configured in the target tenant before migration begins
- 30. Data residency requirements are confirmed and the correct M365 geography is provisioned

Thirty items is a lot — but each one represents a category of migration failure I've seen happen. The organizations that move fast and skip this checklist often end up spending more time on remediation than they saved on planning.

If you're planning an M365 migration and want an experienced architect to validate your readiness before you move, a migration readiness assessment is the right first step. Get in touch to discuss your timeline and current state.`,
  },
  {
    slug: "m365-tenant-health-check",
    category: "M365 Best Practices",
    title: "The M365 Tenant Health Check: What We Look For at NASA Scale",
    summary: "After years of managing Microsoft 365 for one of the world's most security-sensitive organizations, I've developed a systematic audit methodology. This is what we check — and why each item matters.",
    date: "May 22, 2025",
    content: `Managing Microsoft 365 at NASA means operating under constraints most organizations never encounter: strict federal compliance requirements, national security considerations, a user base of scientists and engineers with specialized workflows, and zero tolerance for data exposure. Over the years, I've developed a systematic health check methodology that I now apply to every M365 consulting engagement.

Here's what a thorough M365 tenant health check covers — and why each area matters.

## Identity and Access Management

Everything starts with identity. A compromised account in a poorly-governed tenant can cascade into a catastrophic breach. We look at MFA enrollment rates (the target is 100% — no exceptions), Conditional Access policy coverage, privileged identity management for admin accounts, and sign-in risk policies.

- MFA enrollment: Is it enforced via Conditional Access (not just 'enabled' in legacy per-user settings)?
- Admin accounts: Do global admins have separate cloud-only admin accounts?
- Privileged Identity Management: Are admin roles just-in-time rather than permanently assigned?
- Guest accounts: Are there stale guests with broad access? When were they last reviewed?
- Break-glass accounts: Are emergency access accounts configured, monitored, and tested?

## Exchange Online and Email Security

Email remains the primary attack vector for most organizations. A healthy Exchange Online configuration has defense-in-depth: DMARC, DKIM, and SPF properly configured to prevent spoofing; Defender for Office 365 anti-phishing, anti-malware, and Safe Links policies active; and mailbox audit logging enabled.

> One finding I see in nearly every audit: organizations that have SPF and DKIM configured but no DMARC enforcement policy. DMARC without a 'reject' or 'quarantine' policy is not protecting you from spoofing.

## SharePoint and OneDrive Sharing Policies

SharePoint's default sharing settings are far too permissive for most organizations. We audit tenant-level and site-level sharing policies, check for anonymous sharing links (a significant risk that's often overlooked), review external sharing domains, and verify that site access request workflows route to the right owners.`,
  },
  {
    slug: "power-automate-approval-workflows",
    category: "Power Platform How-Tos",
    title: "Power Automate Approval Workflows: Build Once, Scale Forever",
    summary: "Approval workflows are one of the highest-ROI automations in Power Automate. Learn the design patterns that keep workflows maintainable as your organization's processes evolve.",
    date: "April 24, 2025",
    content: `Approval workflows are among the most impactful automations you can build with Power Automate. They replace email chains, ad hoc Teams messages, and spreadsheet trackers with structured, auditable, repeatable processes. Done right, they transform how an organization handles procurement approvals, content publishing, IT change requests, HR processes, and dozens of other high-friction workflows.

Done wrong, they become brittle nightmares that break every time someone changes roles, get bypassed by frustrated users, and generate more maintenance burden than the manual process they replaced.

Here are the design patterns that make the difference.

## Use SharePoint Lists as Your Data Layer

Every approval workflow needs a persistent record of requests and their outcomes. Don't store this state inside the flow itself — flows can fail, be updated, or be deleted. Store request data in a SharePoint list. This gives you a permanent audit trail, a source of truth for reporting, and a data source you can query and report on independently of the flow.

Design your SharePoint list schema first, before building the flow. Think about what data you'll need for reporting: who requested it, when, what approval stage it's at, who approved or rejected it, and why. These columns are easy to add upfront and painful to add after the fact.

## Decouple Approver Identity from the Workflow

The most brittle approval workflows have approver email addresses hardcoded into the flow. Every time someone changes roles, a flow breaks. Instead, drive approver identity from configuration — a SharePoint list, a Microsoft 365 Group, or a custom lookup.

> Best practice: Store approval routing in a SharePoint 'Workflow Configuration' list. The flow looks up the current approver for each approval type at runtime. When approvers change, update the list — no flow modifications needed.

## Build Delegation and Escalation In From the Start

Every approval workflow eventually encounters the same problems: the approver is on vacation, the approver doesn't respond within the required SLA, or the request needs to go to a backup approver. Build these scenarios into the workflow from the beginning, not as an afterthought.

- Set a timeout on every approval action — never wait indefinitely
- When a timeout occurs, escalate to the approver's manager or a defined backup
- Send reminder notifications before the timeout, not just when it expires
- Log every timeout and escalation to the SharePoint list for reporting

## Adaptive Cards Over Email Notifications

The default Power Automate approval sends an email with approve/reject buttons. This works, but Adaptive Cards in Teams are significantly better for most organizational contexts: they surface where users already spend their time, support richer formatting, and allow inline action without leaving Teams.

Use the 'Post an Adaptive Card and wait for a response' action in Teams instead of the generic approval action when you want full control over the approval experience. You can include request details, attachments, a required comments field, and custom buttons.

## Version Your Flows

Power Automate flows don't have native version control in the traditional sense, but you can build your own versioning discipline. Before making significant changes to a production flow, export it to a JSON file and store it in a SharePoint document library. Document what changed and why in a change log list. This creates the audit trail you'll need when something goes wrong — and something always eventually goes wrong.

## Monitor With Flow Analytics

Once a workflow is in production, don't just assume it's working. Use the Power Automate analytics dashboard to monitor run history, failure rates, and performance. Set up a separate alert flow that notifies the IT team when a critical approval workflow fails more than a defined number of times in a rolling window.

If your organization has approval processes that are still being handled manually or through ad hoc email chains, Power Automate can transform them — but the architecture decisions matter. I'm happy to discuss what an automation assessment for your workflows would look like.`,
  },
  {
    slug: "sharepoint-intranet-architecture",
    category: "M365 Best Practices",
    title: "SharePoint Intranet Architecture: The Blueprint That Actually Works",
    summary: "Most SharePoint intranets fail because they were built without a coherent information architecture. Here's the planning framework I use for every modern intranet engagement — from hub structure to taxonomy design.",
    date: "May 8, 2025",
    content: `I've seen a lot of SharePoint intranets. I've seen ones built in 2008 that are still somehow running, ones that cost millions in consulting fees and were abandoned within two years, and ones that genuinely transformed how an organization communicates and collaborates. The difference between the successful ones and the failures almost always comes down to information architecture.

This is the planning framework I use for every modern SharePoint intranet engagement. It's developed from real deployments, including managing a complex M365 environment at one of the world's most information-intensive organizations.

## Start With User Research, Not IT Requirements

The first and most important step is understanding how your users actually work — not how IT thinks they work, and not how leadership wishes they worked. This means interviews, surveys, card sorting exercises, and observation. What information do people need to do their jobs? Where do they currently go to find it? What's frustrating about the current state?

The outputs of this research should drive everything: your navigation structure, your content types, your hub organization, and your governance model. Skip this step and you're building an intranet for an imaginary user.

## Hub and Site Architecture

The modern SharePoint architecture centers on hub sites. Hubs are the organizing structure that groups related sites together, enables cross-site search and navigation, and provides consistent branding and security across a portfolio of sites.

A typical mid-size organization might have hubs organized around: functional departments (HR, Finance, IT, Legal), major business units or regions, and a root intranet hub that serves as the top-level landing experience. The key is that hub structure should reflect how users think about information, not how the org chart is drawn.

> One of the most common mistakes: building hub structure that mirrors the organizational hierarchy. Users don't look for information by thinking 'which department owns this?' They think 'I need to find the expense reporting form.' Design for the task, not the org chart.

## Taxonomy and Managed Metadata

SharePoint's Managed Metadata Service gives you a controlled vocabulary for tagging content across the intranet. Used well, it's powerful: users can find content by topic, not just by navigating to a specific site. Used poorly — or ignored — it becomes a maintenance nightmare or an abandoned feature.

- Start with a small, purposeful taxonomy. Five well-chosen term sets are better than fifty abandoned ones.
- Assign a term set owner for each set who is responsible for governance.
- Use managed metadata for cross-site navigation menus, not just document tagging.
- Build a review cadence — taxonomy needs maintenance as the organization evolves.

## Navigation Design

Navigation is where intranet projects most often fail usability. The temptation is to create a navigation that's comprehensive — a place for everything, everything in its place. The result is navigation so deep and complex that users give up and use search instead.

Modern SharePoint supports three navigation layers: global (tenant-level app bar), hub navigation, and local site navigation. Each should serve a different purpose. Global is for universal tools — the directory, IT help desk, HR portal. Hub navigation is for departmental resources. Local is for within-site wayfinding.

## Governance Before Launch

Content governance is what separates intranets that stay current from intranets that become digital graveyards. Before launch, you need clear answers to: Who owns each section of the intranet? How often must content be reviewed? What's the process for requesting new pages or sections? What happens to orphaned content when people change roles?

The governance model doesn't have to be complex — but it must exist and be enforced. I recommend building a content ownership matrix as part of every intranet project, assigning a named owner and a review cadence to every major content area.

Building a SharePoint intranet the right way is one of the highest-impact things an organization can do for its internal communications and knowledge management. If you're planning an intranet project and want to get the architecture right from the start, let's talk.`,
  },
];

export async function seedArticles(): Promise<void> {
  try {
    const existing = await db.select({ slug: articlesTable.slug }).from(articlesTable);
    if (existing.length > 0) return;

    await db.insert(articlesTable).values(SEED_ARTICLES).onConflictDoNothing();
    logger.info({ count: SEED_ARTICLES.length }, "articles: seeded default articles");
  } catch (err) {
    logger.warn({ err }, "articles: seed failed (non-fatal)");
  }
}
