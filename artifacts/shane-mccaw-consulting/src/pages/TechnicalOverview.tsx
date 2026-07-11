import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="text-xl font-extrabold text-[#0A2540] mb-4 pb-3 border-b border-border">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold text-[#0A2540] mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-foreground leading-relaxed">{children}</p>;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0A2540] rounded-xl px-5 py-4 text-sm font-mono text-[#00B4D8] overflow-x-auto whitespace-pre-wrap">
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 leading-relaxed">
      <span className="font-semibold">Note: </span>{children}
    </div>
  );
}

function ItemList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-2" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function TechnicalOverview() {
  return (
    <Layout>
      <SEOMeta
        title="Technical Overview | Shane McCaw Consulting"
        description="Technical documentation covering Azure Automation, Microsoft Graph data collection, AI scoring, project generation, and the delegated permissions model used in Shane McCaw Consulting engagements."
        ogUrl="https://shanemccawconsulting.com/how-it-works/technical"
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[172px] pb-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="flex items-center gap-2 mb-4">
            <Link href="/how-it-works" className="text-white/50 hover:text-white/80 text-sm transition-colors">How It Works</Link>
            <span className="text-white/30 text-sm">›</span>
            <span className="text-white/80 text-sm">Technical Overview</span>
          </div>
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Documentation</p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl">
            Technical Overview
          </h1>
          <p className="text-white/60 text-base mt-5 max-w-2xl leading-relaxed">
            A documentation-level breakdown of the Azure Automation architecture, Microsoft Graph data collection, AI scoring model, project auto-generation, and the delegated permissions model. Written for IT administrators and security teams who need to understand the technical implementation before granting access.
          </p>
        </div>
      </section>

      {/* Table of contents */}
      <section className="bg-[#F7F9FC] border-b border-border py-8">
        <div className="max-w-[900px] mx-auto px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Contents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            {[
              "Azure Automation Architecture",
              "Microsoft Graph Data Collection",
              "Data Collected per Runbook Type",
              "AI Scoring Model",
              "Project Auto-Generation",
              "Delegated Permissions Model",
              "Manual vs Automated Steps",
              "Data Residency and Retention",
              "Revoking Access",
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-[#0078D4] hover:text-[#005A9E] cursor-pointer transition-colors">
                <span className="text-[10px] font-mono text-muted-foreground w-4">{String(i + 1).padStart(2, "0")}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Doc body */}
      <section className="bg-white py-16">
        <div className="max-w-[900px] mx-auto px-6">

          <DocSection title="1. Azure Automation Architecture">
            <Para>
              Shane's practice uses Microsoft Azure — a managed script execution environment — as the runtime for all tenant-side PowerShell scripts. Azure is a first-party Microsoft service, hosted within Shane's Azure subscription, and communicates with your tenant exclusively through Microsoft's own API surface (Microsoft Graph and Exchange Online PowerShell).
            </Para>
            <SubSection title="Execution flow">
              <Para>When a runbook is triggered (either on a schedule or manually):</Para>
              <ItemList items={[
                "Azure Automation retrieves your App Registration credentials from Azure Key Vault using a managed service identity (no human involvement).",
                "The runbook authenticates to Microsoft Graph using the client credentials grant flow (application permissions, not delegated).",
                "API calls are made against your tenant's Graph endpoints. All calls are read-only (HTTP GET).",
                "Results are serialised to JSON and written to a structured Azure Blob Storage container within Shane's subscription.",
                "The runbook completes and logs execution metadata (start time, duration, success/failure) — but never logs API response payloads to any shared log store.",
              ]} />
            </SubSection>
            <SubSection title="Scheduling">
              <Para>
                For one-time assessments, scripts are triggered manually when the engagement begins. For retainer clients, a recurring Azure schedule runs each script on a monthly cadence (default: first Monday of each month at 02:00 UTC). Schedules can be paused, modified, or deleted by Shane at any time, and by you at any time by deleting or suspending your App Registration.
              </Para>
            </SubSection>
          </DocSection>

          <DocSection title="2. Microsoft Graph Data Collection">
            <Para>
              All data collection happens through Microsoft Graph API v1.0 and beta endpoints, using Application-level permissions granted during your App Registration setup. The Graph API is Microsoft's unified gateway to Microsoft 365 data — the same API used by Microsoft's own first-party applications.
            </Para>
            <SubSection title="Authentication">
              <CodeBlock>{`POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
grant_type=client_credentials
client_id={your_app_registration_client_id}
client_secret={retrieved from Key Vault at runtime}
scope=https://graph.microsoft.com/.default`}</CodeBlock>
              <Para>The access token returned is short-lived (typically 3600 seconds) and used only for the duration of the runbook execution. It is not persisted anywhere.</Para>
            </SubSection>
            <SubSection title="API call pattern">
              <Para>All Graph API calls follow this pattern: read-only HTTP GET requests, no pagination side effects, no write operations at any point in any runbook. If a Graph endpoint requires write permission to read (none currently in use do), that endpoint is excluded.</Para>
            </SubSection>
          </DocSection>

          <DocSection title="3. Data Collected per Runbook Type">
            <Para>The exact data collected depends on the engagement type. Below is the complete list by runbook category.</Para>

            <SubSection title="Licensing & User Inventory">
              <ItemList items={[
                "Total licensed user count and per-SKU breakdown (M365 E3, E5, Business Premium, Copilot, etc.)",
                "Active vs assigned user ratio (Graph: subscribedSkus, users)",
                "Unlicensed user accounts that remain in Azure AD",
                "Guest user count and external domain distribution",
              ]} />
            </SubSection>

            <SubSection title="Security Posture">
              <ItemList items={[
                "MFA registration status per user (Graph: credentialUserRegistrationDetails)",
                "Conditional Access policy inventory — names, conditions, grant controls, enabled/disabled state",
                "Legacy authentication block status",
                "Entra ID P1/P2 license presence",
                "Microsoft Defender for M365 plan (Plan 1 / Plan 2) — subscription check only",
                "Intune device management enrollment counts",
              ]} />
            </SubSection>

            <SubSection title="Governance & Compliance">
              <ItemList items={[
                "Sensitivity label policy count and label names",
                "Retention policy inventory — scopes, durations, and workloads covered",
                "DLP policy count and workload coverage (Exchange, SharePoint, Teams, Devices)",
                "Communication compliance policy presence",
                "Insider Risk Management enablement status",
                "Microsoft Purview compliance score (if available via API)",
              ]} />
            </SubSection>

            <SubSection title="SharePoint & OneDrive">
              <ItemList items={[
                "Total site collection count and storage consumption",
                "External sharing configuration (tenant-level and per-site where accessible)",
                "Sites with unique permissions overriding inheritance (risk indicator)",
                "OneDrive adoption rate (users with any files vs licensed users)",
                "Hub site associations and orphaned sites",
              ]} />
            </SubSection>

            <SubSection title="Teams & Collaboration">
              <ItemList items={[
                "Total team count, active vs inactive (by last activity date)",
                "Private channel count per team",
                "Guest access configuration (tenant and per-team)",
                "Teams with external members",
                "Direct message-only users (no team membership)",
              ]} />
            </SubSection>

            <SubSection title="Exchange Online">
              <ItemList items={[
                "Shared mailbox count and size distribution",
                "Distribution group vs M365 Group breakdown",
                "Mail-enabled security groups",
                "Forwarding rules to external domains (high-risk indicator)",
                "DMARC/DKIM/SPF configuration status",
              ]} />
            </SubSection>

            <SubSection title="Copilot Readiness (Copilot engagements only)">
              <ItemList items={[
                "Copilot for M365 license assignment count",
                "MFA enforcement rate (prerequisite check)",
                "Sensitivity label coverage across SharePoint and OneDrive",
                "Oversharing risk indicators (SharePoint sites with Everyone permissions)",
                "Data access governance policy presence",
              ]} />
            </SubSection>

            <Note>Data is collected as structured metadata — counts, configuration flags, and policy names. No email content, document content, Teams message content, or user-identifiable personal data is read or transmitted.</Note>
          </DocSection>

          <DocSection title="4. AI Scoring Model">
            <Para>
              Runbook output is passed to Claude (Anthropic's AI) via the Anthropic API. The API connection is configured with prompt caching disabled and no training data contribution — responses are not used to improve Anthropic's models.
            </Para>
            <SubSection title="Input structure">
              <Para>Each AI analysis call receives: the raw structured JSON from the relevant runbooks, a system prompt defining the scoring rubric and output schema, and contextual metadata about the engagement type and client profile (industry, size, known focus areas).</Para>
            </SubSection>
            <SubSection title="Scoring dimensions">
              <ItemList items={[
                "Security & Identity (0–100): MFA coverage, Conditional Access maturity, legacy auth block, Defender plan",
                "Governance & Compliance (0–100): label deployment, retention coverage, DLP scope, insider risk",
                "Licensing Efficiency (0–100): active/assigned ratio, redundant SKUs, Copilot prerequisites",
                "Copilot Readiness (0–100): prerequisites check, oversharing risk, label coverage, MFA rate",
                "Collaboration Adoption (0–100): Teams activity, OneDrive adoption, guest access hygiene",
                "SharePoint Health (0–100): permission inheritance, oversharing, structure clarity",
              ]} />
            </SubSection>
            <SubSection title="Output schema">
              <Para>The AI returns a structured JSON object containing: per-dimension scores with reasoning, a ranked list of findings with severity (Critical / High / Medium / Low), plain-English explanation of each finding, estimated remediation effort (hours / days / weeks), and recommended next steps ordered by impact-to-effort ratio.</Para>
            </SubSection>
            <SubSection title="Shane's review step">
              <Para>Every AI output is reviewed by Shane before it reaches the client portal or any client-facing document. Shane has full authority to modify scores, remove findings that don't apply, add findings the AI missed, and rewrite recommendations. The AI is an analysis tool — Shane is the architect who owns the output.</Para>
            </SubSection>
          </DocSection>

          <DocSection title="5. Project Auto-Generation">
            <Para>
              After Shane reviews and approves the AI output, the engagement system automatically creates a project in the client portal. The project structure is derived from the findings — high-severity items become early-phase tasks; lower-severity items are sequenced into later phases.
            </Para>
            <ItemList items={[
              "Project phases: Discovery (complete), Analysis (complete), Remediation Planning, Implementation, Validation",
              "Kanban task board: pre-populated with action items from the findings, assigned to Shane by default",
              "Workflow steps: sequential milestones with status tracking visible to the client",
              "Document store: receives the formal findings report as a PDF once prepared",
              "Status reports: Shane publishes these as work progresses — clients receive email notifications",
            ]} />
          </DocSection>

          <DocSection title="6. Delegated Permissions Model">
            <Para>
              The App Registration you create uses Application-level permissions (not delegated user permissions). This is the correct grant type for background automation: it does not impersonate any user, it operates as a service identity.
            </Para>
            <SubSection title="Minimum required permissions">
              <CodeBlock>{`Directory.Read.All          — Read Azure AD objects (users, groups, policies)
User.Read.All               — Read all user profiles and license assignments
Organization.Read.All       — Read tenant-level settings
Policy.Read.All             — Read Conditional Access and authorization policies
Reports.Read.All            — Read M365 usage reports and activity data
Sites.Read.All              — Read SharePoint site metadata and structure
Team.ReadBasic.All          — Read Teams membership and channel structure
TeamSettings.Read.All       — Read Teams configuration settings
MailboxSettings.Read        — Read Exchange mailbox and forwarding settings`}</CodeBlock>
            </SubSection>
            <Note>All permissions are Application type (background service), not Delegated (user-impersonation). Admin consent is required and is granted once during App Registration setup.</Note>
          </DocSection>

          <DocSection title="7. Manual vs Automated Steps">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#0A2540] text-white">
                    <th className="text-left px-5 py-3.5 font-semibold text-white/70 text-xs uppercase tracking-widest">Step</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-white/70 text-xs uppercase tracking-widest">Automated</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-white/70 text-xs uppercase tracking-widest">Manual (Shane)</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-white/70 text-xs uppercase tracking-widest">Manual (Client)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["App Registration creation", "", "", "✓"],
                    ["Runbook execution & data collection", "✓", "", ""],
                    ["AI analysis & scoring", "✓", "", ""],
                    ["Output review & validation", "", "✓", ""],
                    ["Project creation in portal", "✓", "", ""],
                    ["Status reports & updates", "", "✓", ""],
                    ["Findings session / presentation", "", "✓", ""],
                    ["Remediation execution", "", "✓ (if included)", ""],
                    ["Recurring health monitoring", "✓", "", ""],
                    ["Access revocation", "", "", "✓ (optional)"],
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#F7F9FC]"}>
                      {row.map((cell, j) => (
                        <td key={j} className={`px-5 py-3.5 ${j === 0 ? "font-medium text-[#0A2540]" : "text-center text-[#0078D4] font-bold"}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocSection>

          <DocSection title="8. Data Residency and Retention">
            <Para>
              Runbook output is written to Azure Blob Storage in Shane's Azure subscription, in the East US 2 region. Microsoft's standard Azure data residency guarantees apply.
            </Para>
            <ItemList items={[
              "Runbook output JSON: retained for 24 months from engagement close, then permanently deleted.",
              "AI analysis outputs: stored in the same Azure Storage account, same retention period.",
              "App Registration credentials: stored in Azure Key Vault, never written to application databases. Deleted immediately upon engagement close or at client request.",
              "Client portal data (project, tasks, documents): retained for the duration of the client relationship. Exported and deleted within 30 days of a written request.",
              "Findings reports (PDF): provided to the client and stored in their portal document library. Deleted from Shane's systems upon request.",
            ]} />
          </DocSection>

          <DocSection title="9. Revoking Access">
            <Para>
              You retain full control over the service identity at all times. To immediately terminate all automation access:
            </Para>
            <ItemList items={[
              "Sign in to portal.azure.com as a Global Administrator.",
              "Navigate to Microsoft Entra ID → App Registrations → Shane McCaw Automation.",
              "Click Delete. Confirm the deletion.",
            ]} />
            <Para>
              Deletion of the App Registration immediately invalidates all access tokens issued to it. Any in-progress runbook execution will fail at the next API call. No further data can be collected. This action is instant and permanent.
            </Para>
            <Note>You do not need to notify Shane before revoking access. The automation will simply stop working, and Shane will reach out if a scheduled run fails.</Note>
          </DocSection>

        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0A2540] py-16">
        <div className="max-w-[900px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-white font-extrabold text-lg mb-1">Questions for your IT or security team?</p>
            <p className="text-white/60 text-sm">Shane is happy to walk through the technical architecture in detail before any engagement begins.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <CTAButton href="/book">Book a Discovery Call</CTAButton>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm font-medium border border-white/20 hover:border-white/40 px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap"
            >
              ← Back to How It Works
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
