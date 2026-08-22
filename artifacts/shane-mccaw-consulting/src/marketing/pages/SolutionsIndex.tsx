import React from "react";
import { Link } from "wouter";
import { Key, Shield, Truck, Brush, Brain, ArrowRight } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";

// Route /solutions — recreated verbatim from Marketing Solutions.dc.html: the full 33-project
// reference catalogue across five categories. This is the design's own framing, restated for the
// build: "not a shop", nothing here is bought from a list — the free scan is what decides which of
// these, if any, apply to a given tenant.

type ServiceEntry = {
  name: string;
  searchLine: string;
  problem: string;
  who: string;
  why: string;
};

type CategoryEntry = {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  blurb: string;
  services: ServiceEntry[];
};

const FUNNEL: { n: number; title: string; body: string }[] = [
  {
    n: 1,
    title: "Free scan",
    body: "A read-only Graph connection reads your real configuration. No agent, no card, about two minutes.",
  },
  {
    n: 2,
    title: "Real findings",
    body: "Every problem it finds, in plain English, with the actual accounts, files and settings behind it.",
  },
  {
    n: 3,
    title: "One scoped SOW",
    body: "The pricing engine turns those findings into named phases from the catalogue below, priced individually.",
  },
  {
    n: 4,
    title: "You choose",
    body: "Enable the phases you want, defer the rest. Deferred work keeps its price; nothing starts unsigned.",
  },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const CATEGORIES: CategoryEntry[] = [
  {
    id: "identity",
    name: "Identity & Access",
    icon: Key,
    blurb:
      "Who can sign in, what they can reach once they are in, and whether an attacker with a stolen password gets anywhere. This is the work that closes the gaps behind almost every real Microsoft 365 breach.",
    services: [
      {
        name: "Identity Modernization & Conditional Access Build-Out",
        searchLine: "conditional access implementation · Entra ID modernization",
        problem:
          "Conditional Access policies were added one at a time, by different people, over several years. Some overlap, some contradict each other, several have exclusion groups nobody remembers creating, and at least one leaves a bypass path wide open.",
        who: "Organizations running Microsoft 365 with more than a handful of Conditional Access policies and no written record of why each one exists.",
        why: "Conditional Access is the actual front door of your tenant. An unreviewed policy set does not fail loudly — it silently permits the one sign-in scenario you assumed was blocked.",
      },
      {
        name: "Zero Trust Architecture Implementation",
        searchLine: "zero trust architecture consulting · Microsoft Zero Trust rollout",
        problem:
          "Access still assumes the corporate network is trustworthy: unmanaged devices reach company data, service accounts hold standing privilege, and lateral movement inside the tenant is unmonitored.",
        who: "Organizations under contractual or insurance pressure to demonstrate a Zero Trust posture, or moving away from a VPN-and-firewall model.",
        why: "Zero Trust done properly is an architecture, not a product purchase. Sequenced badly it locks out your own staff; sequenced properly it removes whole categories of attack without users noticing.",
      },
      {
        name: "MFA / Passwordless Rollout",
        searchLine: "MFA rollout Microsoft 365 · passwordless authentication deployment",
        problem:
          "MFA covers most people but not all — usually the admins, the service accounts and the executives who asked to be excluded. Legacy authentication protocols are often still enabled, quietly bypassing MFA entirely.",
        who: "Any tenant where MFA coverage is under 100% of privileged accounts, or where legacy auth has never been formally disabled.",
        why: "Partial MFA is the same as no MFA to an attacker: they only need the one account that was left out. Passwordless removes the password as a target altogether.",
      },
      {
        name: "Privileged Identity Management (PIM) Rollout",
        searchLine: "Entra PIM implementation · just-in-time admin access",
        problem:
          "Administrator roles are assigned permanently. Ten people hold Global Administrator, several no longer need it, and nobody has to justify or record why they used it.",
        who: "Organizations with more than two or three standing privileged accounts, or facing an audit that asks who had admin rights on a given date.",
        why: "Standing admin rights are the difference between a compromised account and a compromised tenant. Just-in-time elevation with approval and expiry turns admin access into an auditable event.",
      },
      {
        name: "Identity & Access Hardening",
        searchLine: "Entra ID hardening · Microsoft 365 identity security review",
        problem:
          "Stale accounts still enabled, guests from ended projects, over-permissioned OAuth app consents granted by users years ago, and no review cycle for any of it.",
        who: "Tenants that have grown, reorganised or acquired, and never went back to clean up identity afterwards.",
        why: "Identity sprawl accumulates silently and is invisible in day-to-day operations. Every dormant account and forgotten app consent is a working credential somebody still holds.",
      },
    ],
  },
  {
    id: "data",
    name: "Data & Compliance",
    icon: Shield,
    blurb:
      "Where sensitive data lives, who can reach it, what leaves the tenant, and whether you could prove any of it later. This is the work auditors, insurers and regulators actually ask about.",
    services: [
      {
        name: "Data Classification & Sensitivity Label Rollout",
        searchLine: "sensitivity label rollout · Microsoft Purview data classification",
        problem:
          "No labels published, or labels published and never applied. Confidential material is indistinguishable from a lunch menu, so no protection policy can be targeted at it.",
        who: "Organizations handling regulated, contractual or client-confidential data, and anyone preparing a tenant for Copilot.",
        why: "Classification is the foundation everything else stands on — DLP, retention, encryption and Copilot governance all depend on knowing what the data is. Rolled out badly it becomes shelfware nobody uses.",
      },
      {
        name: "DLP Policy Implementation",
        searchLine: "DLP policy implementation Microsoft 365 · data loss prevention rollout",
        problem:
          "DLP either does not exist, or sits in test mode with policy tips disabled — generating thousands of matches nobody sees and blocking nothing.",
        who: "Organizations that need to demonstrate control over data leaving the tenant, particularly through email, Teams chat and endpoints.",
        why: "DLP switched on carelessly blocks legitimate work and destroys trust in the control. Measured first, then enforced in stages, it stops the real leaks without a revolt.",
      },
      {
        name: "Compliance Framework Implementation",
        searchLine: "Microsoft 365 compliance implementation · security control mapping",
        problem:
          "A framework has been adopted on paper, but the tenant configuration behind each control was never actually implemented or evidenced.",
        who: "Organizations working to a named security framework, responding to client security questionnaires, or preparing for a first audit.",
        why: "Auditors ask for evidence, not intentions. Controls implemented in the tenant and documented as you go make an audit routine instead of a fire drill.",
      },
      {
        name: "Retention & Records Management Implementation",
        searchLine: "Microsoft 365 retention policy implementation · records management rollout",
        problem:
          "Retention is at defaults, so either everything is kept forever or nothing is kept long enough. Legal holds cover nobody, and the records schedule exists only in a document.",
        who: "Organizations with a records schedule, a legal hold obligation, or regulatory retention requirements they cannot currently prove.",
        why: "Keeping everything is a liability and keeping nothing is a different liability. Retention aligned to a real schedule is the only defensible position in a dispute.",
      },
      {
        name: "Email Security Hardening",
        searchLine: "Exchange Online email security hardening · anti-phishing configuration",
        problem:
          "Anti-phishing and anti-spoofing policies are at defaults, SPF, DKIM and DMARC are incomplete, and external auto-forwarding rules quietly send mail out of the organization.",
        who: "Every organization using Exchange Online, and particularly anyone who has already had a business email compromise attempt.",
        why: "Email remains the primary way attackers get in and the primary way data walks out. Default protection stops the obvious attacks and not the targeted ones.",
      },
      {
        name: "Security & Compliance Hardening for M365",
        searchLine: "Microsoft 365 security hardening services · tenant baseline configuration",
        problem:
          "The tenant is running largely as it shipped. Secure Score is middling, hardening was never done as a deliberate project, and nobody can say which settings were changed on purpose.",
        who: "Tenants that were stood up quickly, inherited from another provider, or never formally hardened after go-live.",
        why: "A baseline is what makes drift detectable later. Without one there is no such thing as an unauthorised change, because there is nothing to compare against.",
      },
      {
        name: "Data Protection Baseline",
        searchLine: "Microsoft 365 data protection baseline · information protection setup",
        problem:
          "Encryption, external sharing rules, guest access defaults and device access rules were each set independently, and together they do not add up to a coherent position on how company data may be handled.",
        who: 'Organizations that need one clear, documented answer to "how is our data protected" rather than a list of features they own.',
        why: "Protection controls interact. Set individually they leave gaps at the seams — exactly where data tends to escape.",
      },
      {
        name: "BCDR Implementation",
        searchLine: "Microsoft 365 backup and disaster recovery · BCDR implementation",
        problem:
          "Recovery is assumed rather than tested. Retention settings are treated as backup, restore has never been rehearsed, and nobody has stated an acceptable recovery time.",
        who: "Organizations with a real dependency on Microsoft 365 availability, or a contractual recovery obligation to a client.",
        why: "Microsoft protects the platform, not your content decisions. Deleted, encrypted or maliciously altered data is your problem, and the first honest test of recovery should not be a real incident.",
      },
    ],
  },
  {
    id: "migration",
    name: "Migration & Deployment",
    icon: Truck,
    blurb:
      "Moving into Microsoft 365, between tenants, or onto a workload you have licences for but never rolled out properly. Discovery first, locked design, rehearsed cutover.",
    services: [
      {
        name: "Microsoft 365 Migration Execution",
        searchLine: "Microsoft 365 migration services · M365 migration execution",
        problem:
          "The real scope only surfaces once the migration is underway — mailbox sizes, file shares nobody documented, legacy directory objects, applications that authenticate in ways nobody remembered.",
        who: "Organizations moving to Microsoft 365 from on-premises, hosted Exchange, or another cloud platform.",
        why: "Migrations rarely fail technically. They fail on scope discovered late and a cutover with no way back, which is why discovery and a rehearsed rollback come before anything moves.",
      },
      {
        name: "Tenant-to-Tenant Migration",
        searchLine: "tenant to tenant migration Microsoft 365 · M&A tenant consolidation",
        problem:
          "Two tenants, overlapping domains, duplicate identities, and a business expecting mail, Teams and files to keep working through the whole thing.",
        who: "Organizations merging, divesting, rebranding, or separating from a parent company.",
        why: "Tenant-to-tenant work touches identity, mail flow, sharing links and Teams membership at once. Identity collisions and broken links are the visible failure, and they are entirely avoidable with sequencing.",
      },
      {
        name: "SharePoint Migration",
        searchLine: "SharePoint migration services · file share to SharePoint migration",
        problem:
          "File shares or an old SharePoint estate need to move, complete with permissions nobody has audited, folder depth that breaks path limits, and fifteen years of content with no owner.",
        who: "Organizations retiring file servers, moving off SharePoint on-premises, or consolidating site collections.",
        why: "A lift-and-shift migration faithfully reproduces every permission mistake at cloud scale. Migration is the one natural moment to fix structure and access instead of carrying it forward.",
      },
      {
        name: "Exchange Online Hygiene & Modernization",
        searchLine: "Exchange Online modernization · mailbox hygiene cleanup",
        problem:
          "Shared mailboxes with sign-in enabled, forwarding rules to personal addresses, mail-enabled objects nobody claims, and distribution lists that have not been accurate in years.",
        who: "Tenants that migrated from on-premises Exchange and never revisited the mail estate afterwards.",
        why: "Mail hygiene is both a security problem and an operational one — shared mailboxes with sign-in are a favourite persistence route, and stale forwarding is a data exfiltration path in plain sight.",
      },
      {
        name: "Intune Deployment & Device Compliance Build-Out",
        searchLine: "Intune deployment services · device compliance policy build-out",
        problem:
          "Intune is licensed but barely configured. Devices are enrolled inconsistently, compliance policies do not gate access to anything, and personal devices reach company data unmanaged.",
        who: "Organizations with Microsoft 365 Business Premium or E3 and above who are paying for device management they are not using.",
        why: "Device compliance is what makes Conditional Access meaningful — without it, access decisions are made on identity alone, regardless of what the device is doing.",
      },
      {
        name: "Teams Phone License & Calling Policy Configuration",
        searchLine: "Teams Phone deployment · Teams calling policy configuration",
        problem:
          "Teams Phone licences are assigned but calling policies, emergency addresses, call queues and auto attendants were configured ad hoc or not at all.",
        who: "Organizations replacing a phone system with Teams Phone, or already paying for licences that are only partly in use.",
        why: "Calling configuration has real-world consequences: emergency calling that routes to the wrong address, or a call queue that drops customers, are not settings you discover gradually.",
      },
      {
        name: "Teams Rooms License & Policy Configuration",
        searchLine: "Microsoft Teams Rooms deployment · Teams Rooms licensing setup",
        problem:
          "Meeting room devices are licensed inconsistently, resource accounts are misconfigured, and room booking behaves differently in every room.",
        who: "Organizations with Teams Rooms hardware, hybrid meeting requirements, or rooms that staff have quietly stopped booking.",
        why: "Rooms are the most visible technology in the building. When booking or joining is unreliable, confidence in the whole platform drops with it.",
      },
    ],
  },
  {
    id: "governance",
    name: "Governance & Cleanup",
    icon: Brush,
    blurb:
      "Ownership, structure, sprawl and cost. The work that stops a tenant quietly becoming unmanageable, and turns licence waste back into budget.",
    services: [
      {
        name: "Governance Remediation & Architecture Hardening",
        searchLine: "Microsoft 365 governance remediation · M365 governance framework implementation",
        problem:
          "No lifecycle policy, no naming standard, no ownership requirement. Teams, groups and sites are created freely and never reviewed, and the tenant has no approved baseline to compare against.",
        who: "Organizations whose tenant has grown faster than the rules around it, or who cannot answer who owns a given Team.",
        why: "Governance debt is always paid eventually, usually as a cleanup project priced in consultant-weeks. Fixing the rules costs less than fixing the consequences repeatedly.",
      },
      {
        name: "External Sharing & Guest Access Governance",
        searchLine: "external sharing governance Microsoft 365 · guest access review",
        problem:
          "Anonymous links with no expiry, guests from finished projects still holding access, and sharing defaults that are more permissive than anyone realises.",
        who: "Any organization that collaborates with clients, vendors or contractors through Microsoft 365.",
        why: "This is the most common way company files end up outside the company without any breach occurring. Links keep working long after the relationship ends.",
      },
      {
        name: "Sharing Exposure Remediation",
        searchLine: "SharePoint oversharing remediation · fix anonymous sharing links",
        problem:
          "A scan or audit has already identified overshared sites, broken permission inheritance and open links — and now somebody has to safely close them without breaking live work.",
        who: "Organizations that know they have an oversharing problem, often discovered while preparing for Copilot or an audit.",
        why: "Remediation is riskier than detection. Closing access carelessly breaks legitimate collaboration, so exposure is retired in a sequence with the business, not overnight.",
      },
      {
        name: "Teams Sprawl & Lifecycle Automation",
        searchLine: "Teams sprawl cleanup · Teams lifecycle management automation",
        problem:
          "Hundreds of Teams, many dormant, several with no owner, some still holding guests and meeting recordings. Nothing archives automatically, so ended projects look live forever.",
        who: "Organizations past roughly fifty Teams, or anyone whose users can no longer find the right Team without asking.",
        why: "Sprawl makes both governance and everyday work harder. Automated lifecycle rules keep the estate honest without an annual manual purge.",
      },
      {
        name: "SharePoint & Teams IA Rebuild",
        searchLine: "SharePoint information architecture consulting · SharePoint IA rebuild",
        problem:
          "Sites were created on demand with no hub structure, permissions were customised per site, and search returns either nothing useful or far too much.",
        who: "Organizations where the intranet exists but staff route around it, or where content lives wherever the last project left it.",
        why: "Information architecture decides whether people find things or give up. It also decides what Copilot can surface, and to whom.",
      },
      {
        name: "Intranet / Hub Site Build-Out",
        searchLine: "SharePoint intranet build · hub site implementation",
        problem:
          "There is no single place staff go for news, policies and tools — or there is, and nobody opens it because it was never structured or maintained.",
        who: "Organizations that want internal communications and documents in one governed place rather than scattered across Teams chats.",
        why: "An intranet nobody uses still carries its licence and maintenance cost. Structure, ownership and a publishing rhythm are what separate the two outcomes.",
      },
      {
        name: "License Waste Optimization & Cost Recovery",
        searchLine: "Microsoft 365 license optimization · M365 cost recovery audit",
        problem:
          "Assigned seats that nobody has signed into for months, users holding two overlapping plans, and premium add-ons bought for a project that ended.",
        who: "Any organization over about fifty seats, particularly approaching a renewal date.",
        why: "This is the rare project that pays for itself immediately and keeps paying. Waste renews quietly unless somebody acts before the renewal.",
      },
      {
        name: "Licence Rationalisation",
        searchLine: "Microsoft 365 licence rationalisation · M365 SKU consolidation",
        problem:
          "A mix of SKUs accumulated through growth and acquisition, with people on plans that do not match what they do, and features paid for twice through overlapping products.",
        who: "Organizations with several Microsoft plans in play, or third-party tools duplicating something Microsoft 365 already includes.",
        why: "Rationalisation is not just cutting seats — it is matching plans to real usage, which usually reduces spend and improves capability at the same time.",
      },
      {
        name: "Drift Baseline & Handover",
        searchLine: "Microsoft 365 configuration baseline · tenant drift documentation",
        problem:
          "Nobody can say what the tenant is supposed to look like, so no change can be identified as unauthorised, and a handover between providers or staff loses everything unwritten.",
        who: "Organizations changing IT provider, onboarding a new administrator, or starting continuous monitoring.",
        why: "A documented baseline turns future changes into detectable events. Without it, drift is only ever discovered by accident or by incident.",
      },
    ],
  },
  {
    id: "copilot",
    name: "Copilot",
    icon: Brain,
    blurb:
      "Getting Copilot to a state where it returns something useful without surfacing content people should never have seen — and getting your staff past the first prompt.",
    services: [
      {
        name: "Copilot for Microsoft 365 Deployment Project",
        searchLine: "Copilot for Microsoft 365 deployment · Copilot rollout project",
        problem:
          "Licences have been bought and a pilot group is waiting, but the permission model, labelling and licensing plan behind a safe rollout have not been prepared.",
        who: "Organizations that have committed to Copilot seats and want the rollout to be defensible rather than fast.",
        why: "Copilot answers from whatever your permission model already exposes. Deployment order decides whether that is an advantage or the first bad headline inside your own company.",
      },
      {
        name: "Copilot Data Exposure Remediation",
        searchLine: "Copilot oversharing remediation · Copilot data exposure fix",
        problem:
          "A readiness scan found oversharing, unlabelled sensitive content, orphaned permissions and stale sites — all of it reachable by Copilot's index today.",
        who: "Organizations that have run a Copilot readiness scan, or paused a rollout over oversharing concerns.",
        why: "This is the work that turns a blocked rollout into an approved one. Remediating exposure before Copilot is enabled is far cheaper than explaining an answer it should never have given.",
      },
      {
        name: "Copilot Adoption & Governance Program",
        searchLine: "Copilot adoption program · Copilot governance framework",
        problem:
          "Copilot is live, usage spiked in week one and collapsed by week four, and there is no policy on acceptable use, prompt handling or where generated content may be stored.",
        who: "Organizations already paying for Copilot seats who need renewal to be justifiable.",
        why: "Adoption decides whether the licences survive the next budget review. Governance decides whether anyone regrets the rollout. Both are separate disciplines from switching it on.",
      },
      {
        name: "Adoption Enablement",
        searchLine: "Microsoft 365 adoption program · M365 user enablement",
        problem:
          "The platform is capable and correctly configured, and staff still work the way they did before it — email attachments instead of sharing, no channel discipline, features nobody knew existed.",
        who: "Organizations paying for capability their people are not using, regardless of which workload.",
        why: "Configuration without adoption is licence spend with no return. Enablement is what converts a well-built tenant into changed working habits.",
      },
    ],
  },
];

function askShane() {
  window.dispatchEvent(new Event("sm-ask-shane"));
}

export default function SolutionsIndex() {
  return (
    <MarketingLayout current="solutions">
      <style>{`.sm-sol-tile:hover{border-color:rgba(59,130,246,.4)}`}</style>

      {/* Hero */}
      <section style={{ padding: "48px 32px 26px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <span
            style={{
              display: "inline-flex",
              padding: "6px 12px",
              borderRadius: "999px",
              background: "rgba(59,130,246,.1)",
              border: "1px solid rgba(59,130,246,.25)",
              color: "#60a5fa",
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              marginBottom: "16px",
            }}
          >
            Reference · 33 remediation projects
          </span>
          <h1
            style={{
              fontSize: "34px",
              fontWeight: 800,
              letterSpacing: "-.025em",
              lineHeight: 1.14,
              color: "#f8fafc",
              margin: "0 0 14px",
            }}
          >
            Every Microsoft 365 remediation project, by name. You don&#8217;t pick one from this page.
          </h1>
          <p
            style={{
              fontSize: "14.5px",
              color: "#94a3b8",
              lineHeight: 1.7,
              margin: "0 0 14px",
              maxWidth: "740px",
            }}
          >
            This is the full catalogue of work Shane delivers — identity, data protection, migration,
            governance and Copilot. It exists so you can read exactly what each project involves and
            recognise your own problem in it. It is not a shop: nothing here is bought from a list.
          </p>
          <p
            style={{
              fontSize: "13px",
              color: "#64748b",
              lineHeight: 1.7,
              margin: "0 0 22px",
              maxWidth: "740px",
            }}
          >
            The free scan reads your actual tenant and tells you which of these apply to you, if any.
            Whatever it finds comes back as one scoped statement of work, priced phase by phase, with
            the phases you defer left out. No prices on this page on purpose — a fixed number before a
            scan is a guess.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <Link
              href="/scan"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "11px 20px",
                borderRadius: "10px",
                fontWeight: 700,
                fontSize: "13.5px",
                color: "#fff",
                background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              }}
            >
              Scan My Tenant · Free
              <ArrowRight size={15} />
            </Link>
            <a
              href="#how"
              style={{
                padding: "11px 20px",
                borderRadius: "10px",
                fontWeight: 600,
                fontSize: "13.5px",
                color: "#cbd5e1",
                border: "1px solid rgba(148,163,184,.2)",
              }}
            >
              How work gets scoped
            </a>
          </div>
        </div>
      </section>

      {/* Funnel */}
      <section id="how" style={{ padding: "0 32px 30px", scrollMarginTop: "20px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px" }}>
            {FUNNEL.map((fn) => (
              <div
                key={fn.n}
                style={{
                  borderRadius: "13px",
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "#0b1524",
                  padding: "15px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "7px",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: "23px",
                      height: "23px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.09)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#60a5fa",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {fn.n}
                  </span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f8fafc" }}>{fn.title}</span>
                </span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6 }}>{fn.body}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.7, margin: "14px 0 0", maxWidth: "740px" }}>
            Nothing below is proposed to you unless the scan found the specific problem it fixes. That
            is the whole point of doing it in this order.
          </p>
        </div>
      </section>

      {/* Jump-to strip */}
      <section style={{ padding: "0 32px 32px" }}>
        <div
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            padding: "16px 18px",
            borderRadius: "14px",
            border: "1px solid rgba(30,41,59,.9)",
            background: "#0b1524",
          }}
        >
          <div
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              color: "#64748b",
              marginBottom: "11px",
            }}
          >
            What the scan can surface · jump to
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                style={{
                  padding: "7px 13px",
                  borderRadius: "999px",
                  border: "1px solid rgba(30,41,59,.95)",
                  background: "#020617",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#cbd5e1",
                }}
              >
                {c.name} <span style={{ color: "#64748b" }}>{c.services.length}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        return (
          <section key={cat.id} id={cat.id} style={{ padding: "0 32px 40px", scrollMarginTop: "20px" }}>
            <div style={{ maxWidth: "900px", margin: "0 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: "34px",
                    height: "34px",
                    borderRadius: "10px",
                    background: "rgba(255,255,255,.05)",
                    border: "1px solid rgba(255,255,255,.09)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#60a5fa",
                  }}
                >
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>
                  {cat.name}
                </h2>
              </div>
              <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 20px", maxWidth: "700px" }}>
                {cat.blurb}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {cat.services.map((sv) => (
                  <div
                    key={sv.name}
                    id={slugify(sv.name)}
                    className="sm-sol-tile"
                    style={{
                      borderRadius: "14px",
                      border: "1px solid rgba(30,41,59,.9)",
                      background: "#0b1524",
                      padding: "20px",
                      scrollMarginTop: "20px",
                    }}
                  >
                    <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700, color: "#f8fafc", lineHeight: 1.35 }}>
                      {sv.name}
                    </h3>
                    <p style={{ margin: "0 0 12px", fontSize: "11.5px", color: "#60a5fa", fontWeight: 600 }}>
                      {sv.searchLine}
                    </p>
                    <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#cbd5e1", lineHeight: 1.7 }}>
                      <b style={{ color: "#f8fafc" }}>What the problem looks like:</b> {sv.problem}
                    </p>
                    <p style={{ margin: "0 0 10px", fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.7 }}>
                      <b style={{ color: "#cbd5e1" }}>Who needs this:</b> {sv.who}
                    </p>
                    <p style={{ margin: "0 0 16px", fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.7 }}>
                      <b style={{ color: "#cbd5e1" }}>Why it matters:</b> {sv.why}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "14px",
                        flexWrap: "wrap",
                        paddingTop: "14px",
                        borderTop: "1px solid rgba(255,255,255,.06)",
                      }}
                    >
                      <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6, maxWidth: "420px" }}>
                        Proposed only if the scan finds this in your tenant — then priced as one phase of
                        your statement of work.
                      </span>
                      <Link
                        href="/scan"
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "9px 16px",
                          borderRadius: "9px",
                          fontSize: "12.5px",
                          fontWeight: 700,
                          color: "#fff",
                          background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                        }}
                      >
                        Check my tenant · free
                        <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {/* Closing CTA */}
      <section id="talk" style={{ padding: "12px 32px 60px", scrollMarginTop: "20px" }}>
        <div
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            padding: "28px",
            borderRadius: "18px",
            background: "linear-gradient(165deg,rgba(59,130,246,.09),rgba(139,92,246,.05) 45%,#0b1524 100%)",
            border: "1px solid rgba(59,130,246,.18)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
            <div style={{ maxWidth: "520px" }}>
              <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", margin: "0 0 10px", letterSpacing: "-.02em" }}>
                Don&#8217;t choose from this page. Let the scan choose.
              </h2>
              <p style={{ fontSize: "13.5px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 14px" }}>
                Most people arrive here knowing something is wrong without knowing which project fixes
                it. The free scan answers that from your real tenant in about two minutes, and the
                answer is often two or three of these rather than ten. You get the findings whether you
                buy anything or not.
              </p>
              <p style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.65, margin: 0 }}>
                Whatever the scan surfaces is scoped into one fixed-price statement of work before any
                work starts, and you enable or defer each phase yourself. No hourly billing, no
                open-ended engagements, no cart.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "240px" }}>
              <Link
                href="/scan"
                style={{
                  display: "block",
                  textAlign: "center",
                  padding: "12px 20px",
                  borderRadius: "10px",
                  fontSize: "13.5px",
                  fontWeight: 700,
                  color: "#fff",
                  background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                }}
              >
                Scan My Tenant · Free
              </Link>
              <button
                type="button"
                onClick={askShane}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "center",
                  padding: "12px 20px",
                  borderRadius: "10px",
                  fontFamily: "inherit",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  color: "#cbd5e1",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,.2)",
                  cursor: "pointer",
                }}
              >
                Talk to Shane
              </button>
              <span style={{ fontSize: "11px", color: "#475569", textAlign: "center", lineHeight: 1.6 }}>
                Read-only scan. No card, no call scheduled.
              </span>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
