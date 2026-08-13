import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "Helvetica",
  fonts: [],
});

const NAVY = "#0A2540";
const BLUE = "#0078D4";
const TEAL = "#00B4D8";
const OFF_WHITE = "#F7F9FC";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#E8EEF4";
const MID_GRAY = "#6B7A8D";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: WHITE,
    paddingBottom: 40,
  },

  titlePage: {
    backgroundColor: NAVY,
    padding: 0,
    display: "flex",
    flexDirection: "column",
  },

  titleAccentBar: {
    backgroundColor: BLUE,
    height: 6,
    width: "100%",
  },

  titleContent: {
    flex: 1,
    padding: 60,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },

  titleBadge: {
    backgroundColor: BLUE,
    color: WHITE,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 3,
    alignSelf: "flex-start",
    marginBottom: 28,
    textTransform: "uppercase",
  },

  titleHeadline: {
    color: WHITE,
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.25,
    marginBottom: 12,
    maxWidth: 440,
  },

  titleTagline: {
    color: TEAL,
    fontSize: 14,
    fontFamily: "Helvetica-Oblique",
    marginBottom: 48,
    maxWidth: 380,
  },

  titleDivider: {
    backgroundColor: BLUE,
    height: 2,
    width: 60,
    marginBottom: 32,
  },

  titleAuthorBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  titleAuthorName: {
    color: WHITE,
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },

  titleAuthorTitle: {
    color: LIGHT_GRAY,
    fontSize: 11,
    marginBottom: 2,
  },

  titleAuthorCompany: {
    color: TEAL,
    fontSize: 11,
  },

  titleFooter: {
    backgroundColor: "#071c30",
    paddingHorizontal: 60,
    paddingVertical: 18,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  titleFooterText: {
    color: MID_GRAY,
    fontSize: 9,
  },

  titleFooterYear: {
    color: MID_GRAY,
    fontSize: 9,
  },

  pageHeader: {
    backgroundColor: NAVY,
    paddingHorizontal: 48,
    paddingVertical: 20,
    marginBottom: 0,
  },

  pageHeaderTitle: {
    color: WHITE,
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },

  pageHeaderSubtitle: {
    color: TEAL,
    fontSize: 10,
  },

  pageBody: {
    paddingHorizontal: 48,
    paddingTop: 28,
    paddingBottom: 20,
  },

  sectionLabel: {
    color: BLUE,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },

  sectionTitle: {
    color: NAVY,
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
    lineHeight: 1.3,
  },

  paragraph: {
    color: "#2D3748",
    fontSize: 10,
    lineHeight: 1.7,
    marginBottom: 10,
  },

  summaryBox: {
    backgroundColor: OFF_WHITE,
    borderLeftWidth: 4,
    borderLeftColor: BLUE,
    borderRadius: 4,
    padding: 16,
    marginBottom: 16,
  },

  summaryBoxTitle: {
    color: NAVY,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },

  summaryBoxText: {
    color: "#2D3748",
    fontSize: 10,
    lineHeight: 1.6,
  },

  statRow: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },

  statCard: {
    flex: 1,
    backgroundColor: NAVY,
    borderRadius: 6,
    padding: 14,
  },

  statNumber: {
    color: TEAL,
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },

  statLabel: {
    color: LIGHT_GRAY,
    fontSize: 9,
    lineHeight: 1.4,
  },

  checklistSectionHeader: {
    backgroundColor: NAVY,
    paddingHorizontal: 48,
    paddingVertical: 18,
  },

  checklistSectionNumber: {
    color: BLUE,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },

  checklistSectionTitle: {
    color: WHITE,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.3,
  },

  checklistBody: {
    paddingHorizontal: 48,
    paddingTop: 20,
    paddingBottom: 10,
  },

  checklistIntro: {
    color: MID_GRAY,
    fontSize: 10,
    lineHeight: 1.6,
    marginBottom: 18,
    fontFamily: "Helvetica-Oblique",
  },

  checklistItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
    gap: 10,
  },

  checkbox: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 2,
    marginTop: 1,
    flexShrink: 0,
  },

  checklistItemContent: {
    flex: 1,
  },

  checklistItemTitle: {
    color: NAVY,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },

  checklistItemDesc: {
    color: MID_GRAY,
    fontSize: 9,
    lineHeight: 1.55,
  },

  noteBox: {
    backgroundColor: "#EBF5FF",
    borderRadius: 4,
    padding: 12,
    marginTop: 12,
    display: "flex",
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },

  noteBoxAccent: {
    backgroundColor: BLUE,
    width: 3,
    borderRadius: 2,
    flexShrink: 0,
    alignSelf: "stretch",
  },

  noteBoxText: {
    color: "#1A4B7A",
    fontSize: 9,
    lineHeight: 1.55,
    flex: 1,
  },

  quickPage: {
    paddingHorizontal: 48,
    paddingTop: 28,
    paddingBottom: 20,
  },

  quickTitle: {
    color: NAVY,
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },

  quickSubtitle: {
    color: MID_GRAY,
    fontSize: 10,
    marginBottom: 20,
    lineHeight: 1.5,
  },

  quickGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  quickSection: {
    width: "47%",
    backgroundColor: OFF_WHITE,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
  },

  quickSectionTitle: {
    color: BLUE,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
    paddingBottom: 4,
  },

  quickItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 5,
    gap: 6,
  },

  quickCheckbox: {
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 2,
    marginTop: 1,
    flexShrink: 0,
  },

  quickItemText: {
    color: NAVY,
    fontSize: 8.5,
    lineHeight: 1.4,
    flex: 1,
  },

  ctaPage: {
    backgroundColor: NAVY,
  },

  ctaAccentTop: {
    backgroundColor: BLUE,
    height: 6,
  },

  ctaContent: {
    padding: 60,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  ctaLabel: {
    color: TEAL,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 20,
    textAlign: "center",
  },

  ctaTitle: {
    color: WHITE,
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    lineHeight: 1.3,
    marginBottom: 16,
    maxWidth: 440,
  },

  ctaBody: {
    color: LIGHT_GRAY,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 1.7,
    maxWidth: 400,
    marginBottom: 40,
  },

  ctaCardRow: {
    display: "flex",
    flexDirection: "row",
    gap: 16,
    marginBottom: 40,
    width: "100%",
  },

  ctaCard: {
    flex: 1,
    backgroundColor: "#0d2f4f",
    borderRadius: 8,
    padding: 20,
    borderTopWidth: 3,
    borderTopColor: BLUE,
  },

  ctaCardTitle: {
    color: WHITE,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },

  ctaCardText: {
    color: LIGHT_GRAY,
    fontSize: 9,
    lineHeight: 1.6,
    marginBottom: 10,
  },

  ctaCardLink: {
    color: TEAL,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  ctaDivider: {
    backgroundColor: BLUE,
    height: 1,
    width: "100%",
    opacity: 0.3,
    marginBottom: 28,
  },

  ctaAuthor: {
    color: WHITE,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 4,
  },

  ctaAuthorSub: {
    color: MID_GRAY,
    fontSize: 10,
    textAlign: "center",
  },

  pageFooter: {
    position: "absolute",
    bottom: 20,
    left: 48,
    right: 48,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
    paddingTop: 8,
  },

  footerLeft: {
    color: MID_GRAY,
    fontSize: 8,
  },

  footerRight: {
    color: BLUE,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
  },
});

const PageFooter = ({ pageNum, total }: { pageNum: number; total: number }) => (
  <View style={styles.pageFooter} fixed>
    <Text style={styles.footerLeft}>Shane McCaw Consulting · shanemccaw.com</Text>
    <Text style={styles.footerRight}>
      {pageNum} / {total}
    </Text>
  </View>
);

const sections = [
  {
    number: "Section 1",
    title: "Identity & Access Management (IAM)",
    intro:
      "Strong identity hygiene is the foundation of any Copilot deployment. Without it, AI surfaces data to the wrong people.",
    items: [
      {
        title: "Azure AD / Entra ID is fully deployed",
        desc: "All users authenticate via Microsoft Entra ID (formerly Azure Active Directory). Hybrid or on-prem-only environments require additional configuration.",
      },
      {
        title: "Multi-Factor Authentication (MFA) enforced tenant-wide",
        desc: "MFA must be enabled for every user account — not just admins. Conditional Access policies should enforce this without exception.",
      },
      {
        title: "Privileged Identity Management (PIM) configured",
        desc: "Admin roles are assigned just-in-time rather than permanently. This prevents standing privilege from becoming a Copilot-accessible surface.",
      },
      {
        title: "Guest & external user access policies defined",
        desc: "External collaboration settings are documented and enforced. Copilot will summarize conversations that include guests — know what they can see.",
      },
      {
        title: "Conditional Access policies cover all Copilot scenarios",
        desc: "Device compliance, location, and sign-in risk policies are active and tested for Microsoft 365 apps and Graph API access.",
      },
    ],
    note: "Pro tip: Run the Microsoft Secure Score and aim for 70%+ before enabling Copilot. A score below 60% signals foundational IAM gaps that Copilot will amplify.",
  },
  {
    number: "Section 2",
    title: "Data Governance & Sensitivity Labels",
    intro:
      "Copilot reads whatever the user can access — which means ungoverned data becomes an AI liability. Labels are your first line of defence.",
    items: [
      {
        title: "Microsoft Purview Information Protection is enabled",
        desc: "Sensitivity labels are configured and published to users. At minimum: Public, Internal, Confidential, and Highly Confidential.",
      },
      {
        title: "Auto-labeling policies are deployed",
        desc: "Content is labeled automatically based on pattern matching and trainable classifiers — not just manual user labeling.",
      },
      {
        title: "Label inheritance is configured for email and documents",
        desc: "When a user replies to a Confidential email or edits a labeled document, the label is inherited by default.",
      },
      {
        title: "DLP policies block oversharing of sensitive content",
        desc: "Data Loss Prevention policies cover Teams, SharePoint, Exchange, and OneDrive. Test with Copilot scenarios before go-live.",
      },
      {
        title: "Sensitive content has restricted sharing links",
        desc: "Default sharing in SharePoint/OneDrive is set to 'Specific people' or 'People in your org' for sites holding sensitive data.",
      },
      {
        title: "Content audit log is enabled and retained",
        desc: "Unified Audit Logging is on and audit data is retained for at least 90 days (1 year for E5). This is mandatory for compliance.",
      },
    ],
    note: "Key risk: If your SharePoint has overly permissive sharing and no sensitivity labels, Copilot will freely surface confidential documents to anyone who asks.",
  },
  {
    number: "Section 3",
    title: "SharePoint & Teams Hygiene",
    intro:
      "Copilot draws heavily from SharePoint and Teams. Stale, misconfigured, or overly-shared sites create direct exposure risk.",
    items: [
      {
        title: "Site ownership is defined for all SharePoint sites",
        desc: "Every site has an active, named owner. Orphaned sites (no active owner) should be reviewed or archived before Copilot deployment.",
      },
      {
        title: "External sharing is disabled or restricted at the tenant level",
        desc: "External sharing settings are intentional. 'Anyone with the link' sharing should be disabled tenant-wide unless there is a documented business need.",
      },
      {
        title: "Teams channels are structured and not over-proliferated",
        desc: "Teams sprawl (hundreds of duplicate or inactive teams) confuses Copilot responses. Archive or delete teams unused for 90+ days.",
      },
      {
        title: "Stale content is archived or deleted",
        desc: "Files older than 3 years that are no longer relevant should be moved to archive libraries or deleted. Copilot will surface old, incorrect content otherwise.",
      },
      {
        title: "Microsoft 365 Groups have clear membership",
        desc: "Group membership is reviewed at least annually. Dynamic groups based on HR attributes are preferable for large orgs.",
      },
    ],
    note: "Consider running the SharePoint Assessment tool to identify sites with 'Everyone' or 'Everyone except external users' permissions — these are high-risk for Copilot.",
  },
  {
    number: "Section 4",
    title: "Licensing & Entitlements",
    intro:
      "Copilot for Microsoft 365 requires specific prerequisites beyond the base M365 license. Confirm entitlements before purchasing seats.",
    items: [
      {
        title: "Users have Microsoft 365 E3, E5, Business Standard, or Business Premium",
        desc: "Copilot for M365 is not available on F1, F3, or standalone app licenses. Confirm your base license tier covers all target users.",
      },
      {
        title: "Copilot for Microsoft 365 add-on licenses are procured",
        desc: "Each Copilot user requires a separate $30/user/month add-on. Confirm volume, procurement channel, and start date.",
      },
      {
        title: "Eligible apps are identified (Teams, Word, Excel, Outlook, etc.)",
        desc: "Define the specific apps where Copilot will be enabled. A phased rollout by app is recommended over a full-tenant go-live.",
      },
      {
        title: "License assignment process is defined",
        desc: "Know how licenses will be assigned — manually, via group-based licensing, or through the admin center. This affects rollout speed.",
      },
      {
        title: "Pilot group of 25–50 users is identified",
        desc: "Select power users across departments for the initial pilot. Include IT champions, not just executives.",
      },
    ],
    note: "Important: Copilot for Microsoft 365 is different from GitHub Copilot, Copilot Studio, and Azure OpenAI. Make sure you're purchasing the right SKU for your use case.",
  },
  {
    number: "Section 5",
    title: "Compliance & Regulatory Readiness",
    intro:
      "If your organization operates under HIPAA, FedRAMP, ITAR, or other frameworks, Copilot must be evaluated against those requirements before deployment.",
    items: [
      {
        title: "Microsoft's data processing agreement (DPA) is reviewed",
        desc: "Copilot for M365 includes Microsoft's standard DPA. Regulated industries should verify it meets their specific requirements.",
      },
      {
        title: "Tenant is on a qualifying sovereign cloud (if required)",
        desc: "U.S. Government organizations should confirm Copilot is available in GCC, GCC-High, or DoD tenants as applicable.",
      },
      {
        title: "Data residency requirements are documented",
        desc: "Confirm that Copilot's processing of prompts and responses complies with your data residency obligations (EU Data Boundary, etc.).",
      },
      {
        title: "eDiscovery and legal hold processes are updated",
        desc: "Copilot interactions stored in Exchange Online are discoverable. Ensure your legal hold procedures cover Copilot chat history.",
      },
      {
        title: "Acceptable Use Policy (AUP) covers AI tools",
        desc: "Your AUP should explicitly address AI-generated content, prompt guidelines, and prohibited use cases. Communicate this before go-live.",
      },
      {
        title: "Privacy impact assessment is completed",
        desc: "Document the data flows introduced by Copilot and assess privacy risks, especially for HR, legal, and finance use cases.",
      },
    ],
    note: "For NASA and federal agencies: Copilot for Microsoft 365 is authorized for use in GCC-High. Verify your specific Authorization to Operate (ATO) covers AI workloads.",
  },
  {
    number: "Section 6",
    title: "User Readiness & Training",
    intro:
      "Technology alone doesn't deliver ROI. User adoption is the single biggest factor in whether your Copilot investment pays off.",
    items: [
      {
        title: "Executive sponsorship is confirmed",
        desc: "A named executive sponsor is championing the Copilot rollout. Without visible leadership support, adoption stalls at the pilot phase.",
      },
      {
        title: "Copilot champions network is established",
        desc: "Power users across departments are trained to evangelize Copilot and surface use cases. Target 1 champion per 10–15 users.",
      },
      {
        title: "Prompt engineering training is planned",
        desc: "Users need to know how to write effective prompts. Generic outputs from poor prompts will create a negative first impression.",
      },
      {
        title: "Role-specific use cases are documented",
        desc: "IT leaders, project managers, HR, and finance all have different Copilot use cases. Generic training doesn't drive sustained adoption.",
      },
      {
        title: "Feedback mechanism is established",
        desc: "A channel (Teams channel, survey, or Viva Engage community) exists for users to share what works, what doesn't, and request help.",
      },
      {
        title: "Success metrics are defined pre-launch",
        desc: "Define what 'success' looks like: time saved per user per week, adoption rate at 30/60/90 days, use case breadth, etc.",
      },
    ],
    note: "Microsoft research shows that organizations with structured adoption programs see 3–4x higher Copilot usage rates than those that simply provision licenses and step back.",
  },
  {
    number: "Section 7",
    title: "Technical Infrastructure & Graph Readiness",
    intro:
      "Copilot's intelligence comes from the Microsoft Graph. If your data isn't properly indexed and connected, Copilot can't leverage it.",
    items: [
      {
        title: "Microsoft Search is configured and indexed",
        desc: "Confirm that Microsoft Search has indexed your SharePoint, OneDrive, and connected content sources. Test search relevance before Copilot go-live.",
      },
      {
        title: "Graph connectors are set up for critical data sources",
        desc: "If key information lives in ServiceNow, Salesforce, or internal databases, Graph connectors bring that data into Copilot's context window.",
      },
      {
        title: "Exchange Online is the primary mail platform",
        desc: "Copilot's email capabilities require Exchange Online. Organizations still on on-prem Exchange will have limited Copilot functionality.",
      },
      {
        title: "OneDrive is enabled and syncing for all users",
        desc: "Files stored locally (not in OneDrive) are not accessible to Copilot. Ensure OneDrive sync is deployed and monitored.",
      },
      {
        title: "Copilot usage reporting is configured",
        desc: "Enable Copilot usage analytics in the Microsoft 365 admin center and Viva Insights. You can't improve what you can't measure.",
      },
      {
        title: "Network connectivity meets Teams/M365 requirements",
        desc: "Copilot adds AI inference to every M365 interaction. Confirm bandwidth and latency meet Microsoft's published network requirements.",
      },
      {
        title: "Tenant-level Copilot settings are reviewed",
        desc: "Review admin controls for data retention of Copilot interactions, who can use Copilot, and plugin/extension policies.",
      },
    ],
    note: "Run the Microsoft 365 network connectivity test tool to validate your infrastructure before enabling Copilot for large user groups.",
  },
];

const quickSections = [
  {
    title: "1 · Identity & Access",
    items: ["Azure AD / Entra ID deployed", "MFA enforced tenant-wide", "PIM configured", "Guest access policies set", "Conditional Access covers M365"],
  },
  {
    title: "2 · Data Governance",
    items: ["Purview labels published", "Auto-labeling enabled", "DLP policies active", "Default sharing restricted", "Audit log retained 90+ days"],
  },
  {
    title: "3 · SharePoint & Teams",
    items: ["All sites have active owners", "External sharing restricted", "Stale content archived", "Teams sprawl addressed", "M365 Groups reviewed"],
  },
  {
    title: "4 · Licensing",
    items: ["E3/E5/Business license confirmed", "Copilot add-on procured", "Target apps identified", "License assignment process set", "Pilot group of 25–50 selected"],
  },
  {
    title: "5 · Compliance",
    items: ["DPA reviewed", "Sovereign cloud confirmed (if req.)", "Data residency documented", "eDiscovery updated", "AUP covers AI tools"],
  },
  {
    title: "6 · User Readiness",
    items: ["Executive sponsor named", "Champions network built", "Prompt training planned", "Role-specific use cases ready", "Success metrics defined"],
  },
  {
    title: "7 · Technical Infrastructure",
    items: ["Microsoft Search indexed", "Graph connectors configured", "Exchange Online primary", "OneDrive syncing for all", "Copilot reporting enabled"],
  },
];

const TOTAL_PAGES = 2 + sections.length + 2;

export const CopilotReadinessPDF = () => (
  <Document
    title="M365 Copilot Readiness Checklist"
    author="Shane McCaw — Shane McCaw Consulting"
    subject="Is Your Tenant Ready for Copilot? The Definitive M365 Readiness Checklist"
    creator="Shane McCaw Consulting"
    producer="Shane McCaw Consulting"
  >
    {/* ── Page 1: Title ── */}
    <Page size="A4" style={[styles.page, styles.titlePage]}>
      <View style={styles.titleAccentBar} />
      <View style={styles.titleContent}>
        <Text style={styles.titleBadge}>Free Resource · Shane McCaw Consulting</Text>
        <Text style={styles.titleHeadline}>
          Is Your Tenant Ready for Copilot?{"\n"}The Definitive M365 Readiness Checklist
        </Text>
        <Text style={styles.titleTagline}>
          20+ points across 7 critical domains to validate before you deploy Microsoft Copilot for M365
        </Text>
        <View style={styles.titleDivider} />
        <View style={styles.titleAuthorBlock}>
          <Text style={styles.titleAuthorName}>Shane McCaw</Text>
          <Text style={styles.titleAuthorTitle}>Microsoft 365 Architect · 30-Year Microsoft Ecosystem Veteran</Text>
          <Text style={styles.titleAuthorCompany}>Shane McCaw Consulting</Text>
        </View>
      </View>
      <View style={styles.titleFooter}>
        <Text style={styles.titleFooterText}>shanemccaw.com · Microsoft 365 & Copilot AI Advisory</Text>
        <Text style={styles.titleFooterYear}>© 2025 Shane McCaw Consulting</Text>
      </View>
    </Page>

    {/* ── Page 2: Executive Summary ── */}
    <Page size="A4" style={styles.page}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageHeaderTitle}>Executive Summary</Text>
        <Text style={styles.pageHeaderSubtitle}>Why Readiness Matters Before You Buy</Text>
      </View>
      <View style={styles.pageBody}>
        <Text style={styles.paragraph}>
          Microsoft Copilot for M365 is a productivity force multiplier — when deployed into a well-governed, 
          well-structured tenant. When deployed prematurely, it becomes an amplifier of your existing problems: 
          oversharing, stale data, weak identity controls, and under-trained users.
        </Text>
        <Text style={styles.paragraph}>
          This checklist distills 30 years of Microsoft ecosystem experience into 7 domains and 40+ actionable 
          checkpoints. Work through each section before committing to Copilot licenses. For most organizations, 
          closing the gaps uncovered here delivers more ROI than the AI features themselves.
        </Text>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>40%</Text>
            <Text style={styles.statLabel}>of Copilot deployments stall within 60 days due to poor data governance</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>3–4×</Text>
            <Text style={styles.statLabel}>higher usage in orgs with structured adoption vs. license-and-leave</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>70%+</Text>
            <Text style={styles.statLabel}>Microsoft Secure Score target before enabling Copilot tenant-wide</Text>
          </View>
        </View>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryBoxTitle}>The 7 Readiness Domains</Text>
          <Text style={styles.summaryBoxText}>
            1. Identity &amp; Access Management (IAM){"\n"}
            2. Data Governance &amp; Sensitivity Labels{"\n"}
            3. SharePoint &amp; Teams Hygiene{"\n"}
            4. Licensing &amp; Entitlements{"\n"}
            5. Compliance &amp; Regulatory Readiness{"\n"}
            6. User Readiness &amp; Training{"\n"}
            7. Technical Infrastructure &amp; Graph Readiness
          </Text>
        </View>

        <Text style={styles.paragraph}>
          Each domain contains 5–7 specific checkpoints. Work through them in order — identity first, 
          infrastructure last. Domains 1 and 2 are prerequisites; do not skip them regardless of timeline pressure.
        </Text>

        <View style={styles.noteBox}>
          <View style={styles.noteBoxAccent} />
          <Text style={styles.noteBoxText}>
            If you need a guided assessment of your tenant's Copilot readiness, Shane McCaw Consulting 
            offers a structured M365 Readiness Review that covers all 7 domains in a single 2-day engagement. 
            Visit shanemccaw.com or book a free 30-minute consultation to learn more.
          </Text>
        </View>
      </View>
      <PageFooter pageNum={2} total={TOTAL_PAGES} />
    </Page>

    {/* ── Pages 3–9: Checklist Sections ── */}
    {sections.map((section, idx) => (
      <Page key={idx} size="A4" style={styles.page}>
        <View style={styles.checklistSectionHeader}>
          <Text style={styles.checklistSectionNumber}>{section.number} of 7</Text>
          <Text style={styles.checklistSectionTitle}>{section.title}</Text>
        </View>
        <View style={styles.checklistBody}>
          <Text style={styles.checklistIntro}>{section.intro}</Text>
          {section.items.map((item, i) => (
            <View key={i} style={styles.checklistItem}>
              <View style={styles.checkbox} />
              <View style={styles.checklistItemContent}>
                <Text style={styles.checklistItemTitle}>{item.title}</Text>
                <Text style={styles.checklistItemDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
          <View style={styles.noteBox}>
            <View style={styles.noteBoxAccent} />
            <Text style={styles.noteBoxText}>{section.note}</Text>
          </View>
        </View>
        <PageFooter pageNum={3 + idx} total={TOTAL_PAGES} />
      </Page>
    ))}

    {/* ── Page 10: Quick Reference Checklist ── */}
    <Page size="A4" style={styles.page}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageHeaderTitle}>Quick Reference Checklist</Text>
        <Text style={styles.pageHeaderSubtitle}>Print this page · One view across all 7 domains</Text>
      </View>
      <View style={styles.quickPage}>
        <Text style={styles.quickSubtitle}>
          Use this summary for status meetings, leadership updates, or as a wall reference during your readiness sprint.
        </Text>
        <View style={styles.quickGrid}>
          {quickSections.map((qs, idx) => (
            <View key={idx} style={styles.quickSection}>
              <Text style={styles.quickSectionTitle}>{qs.title}</Text>
              {qs.items.map((item, i) => (
                <View key={i} style={styles.quickItem}>
                  <View style={styles.quickCheckbox} />
                  <Text style={styles.quickItemText}>{item}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>
      <PageFooter pageNum={TOTAL_PAGES - 1} total={TOTAL_PAGES} />
    </Page>

    {/* ── Page 11: CTA ── */}
    <Page size="A4" style={[styles.page, styles.ctaPage]}>
      <View style={styles.ctaAccentTop} />
      <View style={styles.ctaContent}>
        <Text style={styles.ctaLabel}>Ready for the Next Step?</Text>
        <Text style={styles.ctaTitle}>
          Know your gaps.{"\n"}Close them faster with an expert.
        </Text>
        <Text style={styles.ctaBody}>
          This checklist tells you what to look for. A structured M365 Readiness Review 
          tells you exactly where you stand, what to fix first, and how to get there — 
          in 2 days, not 2 months.
        </Text>

        <View style={styles.ctaCardRow}>
          <View style={styles.ctaCard}>
            <Text style={styles.ctaCardTitle}>M365 Copilot Readiness Review</Text>
            <Text style={styles.ctaCardText}>
              A 2-day structured engagement covering all 7 domains. Deliverable: a prioritized 
              remediation roadmap with effort estimates and risk ratings.
            </Text>
            <Text style={styles.ctaCardLink}>shanemccaw.com/quick-wins</Text>
          </View>
          <View style={styles.ctaCard}>
            <Text style={styles.ctaCardTitle}>Have Questions? Ask Our Assistant</Text>
            <Text style={styles.ctaCardText}>
              Chat with the assistant on our site for an honest read on your biggest
              Copilot concerns — where you are, what matters most, and how to get started.
            </Text>
            <Text style={styles.ctaCardLink}>shanemccaw.com</Text>
          </View>
        </View>

        <View style={styles.ctaDivider} />
        <Text style={styles.ctaAuthor}>Shane McCaw</Text>
        <Text style={styles.ctaAuthorSub}>
          Microsoft 365 Architect · Shane McCaw Consulting · shanemccaw.com
        </Text>
      </View>
    </Page>
  </Document>
);
