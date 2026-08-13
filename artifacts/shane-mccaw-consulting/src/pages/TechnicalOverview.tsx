import { SEOMeta } from "@/components/SEOMeta";
import { Layout } from "@/components/Layout";
import { ChatCTA } from "@/components/ChatCTA";
import { Link } from "wouter";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-12">
      <h2 className="font-display text-xl font-bold text-text-primary mb-4 pb-3 border-b border-white/[0.06]">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold text-text-primary mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-text-secondary leading-relaxed">{children}</p>;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-charcoal-0 border border-white/[0.08] rounded-xl px-5 py-4 text-sm font-numeric text-accent-blue overflow-x-auto whitespace-pre-wrap">
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-300 leading-relaxed">
      <span className="font-semibold">Note: </span>{children}
    </div>
  );
}

function ItemList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-text-secondary leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0 mt-2" />
          {item}
        </li>
      ))}
    </ul>
  );
}

const TOC_ITEMS = [
  "Consent & Access Architecture",
  "Microsoft Graph Data Collection",
  "Data Collected per Scan Type",
  "AI Scoring Model",
  "Project Auto-Generation",
  "Application Permissions Model",
  "Manual vs Automated Steps",
  "Data Residency and Retention",
  "Revoking Access",
];

export default function TechnicalOverview() {
  return (
    <Layout>
      <SEOMeta
        title="Technical Overview | Shane McCaw Consulting"
        description="Technical documentation covering the consent-based access model, Microsoft Graph data collection, AI scoring, project generation, and the application permissions model used in Shane McCaw Consulting engagements."
        ogUrl="https://shanemccawconsulting.com/technical-overview"
      />

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Link href="/how-it-works" className="text-text-secondary/70 hover:text-text-secondary text-sm transition-colors">How It Works</Link>
            <span className="text-text-secondary/40 text-sm">›</span>
            <span className="text-text-secondary text-sm">Technical Overview</span>
          </div>
          <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-4">Documentation</p>
          <h1 className="font-display text-3xl md:text-5xl font-bold text-text-primary leading-tight max-w-3xl mb-5">
            Technical Overview
          </h1>
          <p className="text-text-secondary text-base max-w-2xl leading-relaxed">
            A documentation-level breakdown of the consent-based access model, Microsoft Graph data collection, AI scoring model, project auto-generation, and the application permissions model. Written for IT administrators and security teams who need to understand the technical implementation before granting access.
          </p>
        </div>
      </section>

      {/* Table of contents */}
      <section className="border-t border-b border-white/[0.06] py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary mb-4">Contents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            {TOC_ITEMS.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-accent-blue hover:text-accent-violet cursor-pointer transition-colors">
                <span className="text-[10px] font-numeric text-text-secondary w-4">{String(i + 1).padStart(2, "0")}</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Doc body */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">

          <DocSection title="1. Consent & Access Architecture">
            <Para>
              The platform is registered with Microsoft as a multi-tenant Azure AD application. Granting access is a single Microsoft-hosted admin consent grant — there is no App Registration for you to create, no secret to generate, and no script or agent installed in your tenant. Consent is the only artifact left behind, and it lives entirely in your own Entra ID admin center.
            </Para>
            <SubSection title="Execution flow">
              <Para>When a scan runs (either on a schedule or manually triggered by Shane):</Para>
              <ItemList items={[
                "The platform requests a fresh application-only access token from Microsoft's identity platform, using its own credentials — you never generate, see, or handle a secret.",
                "The platform authenticates to Microsoft Graph using application permissions (app-only, not delegated) — it never acts as you or as any user in your organization.",
                "API calls are made against your tenant's Graph endpoints. All calls are read-only (HTTP GET).",
                "Results are stored in the platform's own infrastructure, under the same security controls that govern the rest of the service.",
                "The scan completes and logs execution metadata (start time, duration, success/failure) — but never logs API response payloads to any shared log store.",
              ]} />
            </SubSection>
            <SubSection title="Scheduling">
              <Para>
                For one-time assessments, the scan is triggered once when the engagement begins. For retainer clients, scans repeat on a recurring cadence (typically monthly). Scans can be paused or stopped by Shane at any time, and by you at any time — by revoking consent in your own Entra ID admin center. Revoking consent stops every future scan instantly; there is nothing further for you to configure or delete.
              </Para>
            </SubSection>
          </DocSection>

          <DocSection title="2. Microsoft Graph Data Collection">
            <Para>
              All data collection happens through Microsoft Graph API v1.0 and beta endpoints, using the application permissions you approved during admin consent. The Graph API is Microsoft's unified gateway to Microsoft 365 data — the same API used by Microsoft's own first-party applications.
            </Para>
            <SubSection title="Authentication">
              <Para>
                The platform authenticates using the OAuth 2.0 client credentials flow — a standard, Microsoft-documented pattern for app-only access. The credentials involved belong exclusively to the platform's own registered application; nothing about this step touches your tenant beyond the read calls it authorizes. The access token returned is short-lived (typically one hour) and used only for the duration of the scan. It is never persisted.
              </Para>
            </SubSection>
            <SubSection title="API call pattern">
              <Para>All Graph API calls follow this pattern: read-only HTTP GET requests, no pagination side effects, no write operations at any point in any scan. In this release, no endpoint requiring write permission is used.</Para>
            </SubSection>
          </DocSection>

          <DocSection title="3. Data Collected per Scan Type">
            <Para>The exact data collected depends on the engagement type. Below is the complete list by scan category.</Para>

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
              Scan output is passed to Claude (Anthropic's AI) via the Anthropic API. The API connection is configured with prompt caching disabled and no training data contribution — responses are not used to improve Anthropic's models.
            </Para>
            <SubSection title="Input structure">
              <Para>Each AI analysis call receives: the raw structured JSON from the relevant scans, a system prompt defining the scoring rubric and output schema, and contextual metadata about the engagement type and client profile (industry, size, known focus areas).</Para>
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

          <DocSection title="6. Application Permissions Model">
            <Para>
              The consent you grant authorizes exclusively Application-level (app-only) permissions — never Delegated (user-impersonation) permissions. This is a structural distinction Microsoft enforces at the platform level: application permissions mean the platform acts under its own service identity, with a fixed set of tenant-wide read scopes — never as any specific user, and never with the ability to act on a user's behalf.
            </Para>
            <SubSection title="Requested permissions">
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
            <Note>Every permission listed is Application type (background service) and read-only. In this release, no write-capable Graph permission is requested for any engagement, including Config Pack and other write-adjacent offerings. Admin consent is required and is granted once, during onboarding.</Note>
          </DocSection>

          <DocSection title="7. Manual vs Automated Steps">
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-white/[0.04]">
                    <th className="text-left px-5 py-3.5 font-semibold text-text-secondary text-xs uppercase tracking-widest">Step</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-text-secondary text-xs uppercase tracking-widest">Automated</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-text-secondary text-xs uppercase tracking-widest">Manual (Shane)</th>
                    <th className="text-center px-5 py-3.5 font-semibold text-text-secondary text-xs uppercase tracking-widest">Manual (Client)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Admin consent grant", "", "", "✓"],
                    ["Scan execution & data collection", "✓", "", ""],
                    ["AI analysis & scoring", "✓", "", ""],
                    ["Output review & validation", "", "✓", ""],
                    ["Project creation in portal", "✓", "", ""],
                    ["Status reports & updates", "", "✓", ""],
                    ["Findings session / presentation", "", "✓", ""],
                    ["Remediation execution", "", "✓ (if included)", ""],
                    ["Recurring health monitoring", "✓", "", ""],
                    ["Access revocation", "", "", "✓ (optional)"],
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-white/[0.02]"}>
                      {row.map((cell, j) => (
                        <td key={j} className={`px-5 py-3.5 border-t border-white/[0.06] ${j === 0 ? "font-medium text-text-primary" : "text-center text-accent-blue font-bold"}`}>
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
              Scan output is written to the platform's own infrastructure, under Microsoft's standard Azure data residency guarantees for the region the platform operates in.
            </Para>
            <ItemList items={[
              "Scan output JSON: retained for 24 months from engagement close, then permanently deleted.",
              "AI analysis outputs: stored alongside scan output, same retention period.",
              "Access tokens: short-lived (typically one hour) and never persisted beyond the scan that used them.",
              "Client portal data (project, tasks, documents): retained for the duration of the client relationship. Exported and deleted within 30 days of a written request.",
              "Findings reports (PDF): provided to the client and stored in their portal document library. Deleted from Shane's systems upon request.",
            ]} />
          </DocSection>

          <DocSection title="9. Revoking Access">
            <Para>
              You retain full control over the consent grant at all times. To immediately terminate all access:
            </Para>
            <ItemList items={[
              "Sign in to entra.microsoft.com (or portal.azure.com) as a Global Administrator.",
              "Navigate to Microsoft Entra ID → Enterprise Applications and find Shane McCaw Consulting in the list.",
              "Remove the application, or revoke its granted permissions. Confirm the action.",
            ]} />
            <Para>
              Revoking consent immediately invalidates every access token issued to the platform for your tenant. Any in-progress scan will fail at the next API call. No further data can be collected. This action is instant and permanent.
            </Para>
            <Note>You do not need to notify Shane before revoking access. Scanning will simply stop working, and Shane will reach out if a scheduled scan fails.</Note>
          </DocSection>

        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="font-display text-text-primary font-bold text-lg mb-1">Questions for your IT or security team?</p>
            <p className="text-text-secondary text-sm">Shane is happy to walk through the technical architecture in detail before any engagement begins.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <ChatCTA
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-white text-sm transition-opacity hover:opacity-90 whitespace-nowrap"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Ask a Question
            </ChatCTA>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm font-medium border border-white/[0.12] hover:border-white/[0.2] px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap"
            >
              ← Back to How It Works
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
