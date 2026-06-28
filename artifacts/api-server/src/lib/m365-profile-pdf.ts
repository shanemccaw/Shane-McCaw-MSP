import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const AUTH_LABEL_MAP: Record<string, string> = {
  password:           "Password only",
  mfa:                "MFA (per-user)",
  sso_saml:           "SSO / SAML",
  entra_id:           "Entra ID (Azure AD)",
  conditional_access: "Conditional Access policies",
};

const navy  = rgb(0.039, 0.145, 0.251);
const blue  = rgb(0,     0.471, 0.831);
const teal  = rgb(0,     0.706, 0.847);
const white = rgb(1, 1, 1);
const grey  = rgb(0.45,  0.45,  0.45);
const lightGrey = rgb(0.92, 0.94, 0.97);

export interface M365ProfilePdfData {
  clientName: string | null;
  clientEmail: string;
  clientCompany: string | null;
  generatedAt: Date;
  profile: Record<string, unknown>;
}

function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
  return String(v);
}

function yn(v: unknown): string {
  return v ? "Yes" : "No";
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export async function generateM365ProfilePdf(data: M365ProfilePdfData): Promise<Buffer> {
  const p = data.profile;

  const pdfDoc  = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageW  = 595;
  const margin = 48;

  const sections: Array<{ title: string; rows: [string, string][] }> = [
    {
      title: "Organization Overview",
      rows: [
        ["Organization",        val(p.orgName)],
        ["Industry",            val(p.industry)],
        ["Employees",           val(p.employeeCount)],
        ["M365 Licensed Users", val(p.licensedUserCount)],
        ["IT Contact",          p.itContactName ? `${p.itContactName}${p.itContactEmail ? ` (${p.itContactEmail})` : ""}` : "—"],
        ["Tenant Domain",       val(p.tenantDomain)],
        ["Microsoft Partner",   yn(p.isMicrosoftPartner)],
      ],
    },
    {
      title: "M365 Licensing & Usage",
      rows: [
        ["License SKUs",      Array.isArray(p.licenseSKUs) && p.licenseSKUs.length > 0 ? (p.licenseSKUs as string[]).join(", ") : "—"],
        ["Active User %",     p.activeUserPercent ? `${p.activeUserPercent}%` : "—"],
        ["All Users Licensed", yn(p.allUsersLicensed)],
        ["Active Workloads",   [p.usesExchange && "Exchange", p.usesTeams && "Teams", p.usesSharePoint && "SharePoint", p.usesOneDrive && "OneDrive", p.usesYammer && "Yammer"].filter(Boolean).join(", ") || "None"],
      ],
    },
    {
      title: "Environment Structure",
      rows: [
        ["SharePoint Sites",  val(p.sharepointSiteCount)],
        ["Teams",             val(p.teamCount)],
        ["Security Groups",   val(p.securityGroupCount)],
        ["Auth Method(s)",    Array.isArray(p.authMethods) && (p.authMethods as string[]).length > 0 ? (p.authMethods as string[]).map(m => AUTH_LABEL_MAP[String(m)] ?? String(m)).join(", ") : val(p.authMethod)],
        ["External Sharing",  yn(p.externalSharingEnabled)],
        ["Guest Users",       yn(p.guestUsersPresent)],
        ["Hybrid",            yn(p.isHybrid)],
        ["On-Prem Exchange",  yn(p.hasOnPremExchange)],
        ["Entra Connect",     yn(p.usesAADConnect)],
      ],
    },
    {
      title: "Security & Compliance",
      rows: [
        ["MFA Enforced",         yn(p.mfaEnforced)],
        ["Conditional Access",   yn(p.conditionalAccessEnabled)],
        ["Entra ID P1/P2",       yn(p.hasAADP1orP2)],
        ["Intune",               yn(p.intuneEnabled)],
        ["Defender for M365",    yn(p.hasDefender)],
        ["DLP Policies",         yn(p.hasDLP)],
        ["Sensitivity Labels",   yn(p.sensitivityLabelsConfigured)],
        ["Retention Policies",   yn(p.hasRetentionPolicies)],
        ["Compliance Center",    yn(p.usesComplianceCenter)],
        ["Insider Risk Mgmt",    yn(p.hasInsiderRisk)],
      ],
    },
    {
      title: "Copilot Readiness",
      rows: [
        ["Has Copilot Licenses", yn(p.hasCopilotLicenses)],
        ...(p.hasCopilotLicenses ? [["License Count", val(p.copilotLicenseCount)] as [string, string]] : []),
        ["Primary Use Case",     val(p.copilotUseCase)],
        ["Current AI Tools",     val(p.currentAITools)],
        ["Data Governance",      val(p.dataGovernanceConcerns)],
        ["Readiness Score",      p.copilotReadinessScore ? `${p.copilotReadinessScore}/5` : "—"],
        ["Primary Blocker",      val(p.copilotBlockedBy)],
      ],
    },
    {
      title: "Engagement Metadata",
      rows: [
        ["Start Date",      val(p.engagementStartDate)],
        ["Duration",        val(p.estimatedDuration)],
        ["Type",            val(p.engagementType)],
        ["Budget Range",    val(p.budgetRange)],
        ["Decision Maker",  p.decisionMakerName ? `${p.decisionMakerName}${p.decisionMakerEmail ? ` (${p.decisionMakerEmail})` : ""}` : "—"],
        ["Business Goals",  val(p.businessGoals)],
        ["Known Blockers",  val(p.knownBlockers)],
        ["Referral Source", val(p.referralSource)],
      ],
    },
  ];

  const HEADER_H    = 58;
  const FOOTER_H    = 38;
  const ROW_H       = 16;
  const SECTION_GAP = 18;
  const SECTION_TITLE_H = 22;
  const PAGE_CONTENT_H  = 842 - HEADER_H - FOOTER_H - margin * 2;

  function estimateSectionH(rows: [string, string][]): number {
    return SECTION_TITLE_H + rows.length * ROW_H + SECTION_GAP;
  }

  function addPage(): ReturnType<typeof pdfDoc.addPage> & { cursorY: number } {
    const page = pdfDoc.addPage([pageW, 842]) as ReturnType<typeof pdfDoc.addPage> & { cursorY: number };
    const pageH = 842;

    const drawT = (str: string, x: number, y: number, opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
      page.drawText(str, { x, y, font: opts.font ?? regular, size: opts.size ?? 9, color: opts.color ?? navy });
    };

    page.drawRectangle({ x: 0, y: pageH - HEADER_H, width: pageW, height: HEADER_H, color: navy });
    drawT("Shane McCaw Consulting", margin, pageH - 24, { font: bold, size: 14, color: white });
    drawT("Lead Microsoft 365 Architect  |  NASA", margin, pageH - 40, { size: 9, color: rgb(0.7, 0.8, 0.9) });

    page.drawRectangle({ x: pageW - 180, y: pageH - HEADER_H + 2, width: 170, height: HEADER_H - 4, color: blue });
    drawT("M365 ASSESSMENT REPORT", pageW - 174, pageH - 24, { font: bold, size: 9, color: white });
    drawT(formatDate(data.generatedAt), pageW - 174, pageH - 38, { size: 8, color: rgb(0.8, 0.9, 1) });

    page.drawRectangle({ x: 0, y: 0, width: pageW, height: FOOTER_H, color: navy });
    drawT("Confidential — prepared for client use only", margin, 14, { size: 8, color: rgb(0.7, 0.8, 0.9) });
    drawT(`Generated ${formatDate(data.generatedAt)}`, pageW - 170, 14, { size: 8, color: rgb(0.5, 0.6, 0.7) });

    page.cursorY = pageH - HEADER_H - margin;
    return page;
  }

  let page = addPage();
  const pageH = 842;

  const drawPageText = (
    pg: ReturnType<typeof pdfDoc.addPage>,
    str: string,
    x: number,
    y: number,
    opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    pg.drawText(str, { x, y, font: opts.font ?? regular, size: opts.size ?? 9, color: opts.color ?? navy });
  };

  const clientDisplayName = data.clientCompany ?? data.clientName ?? data.clientEmail;
  drawPageText(page, "Prepared for:", margin, page.cursorY, { size: 8, color: grey });
  drawPageText(page, clientDisplayName, margin + 70, page.cursorY, { font: bold, size: 9 });
  if (data.clientEmail) {
    page.cursorY -= 14;
    drawPageText(page, data.clientEmail, margin + 70, page.cursorY, { size: 8, color: grey });
  }

  page.cursorY -= 18;
  page.drawLine({ start: { x: margin, y: page.cursorY }, end: { x: pageW - margin, y: page.cursorY }, thickness: 1, color: blue });
  page.cursorY -= SECTION_GAP;

  for (const section of sections) {
    const needed = estimateSectionH(section.rows);
    const availableOnPage = page.cursorY - FOOTER_H - margin;

    if (availableOnPage < needed && availableOnPage < PAGE_CONTENT_H * 0.25) {
      page = addPage();
    }

    const sectionTop = page.cursorY;
    page.drawRectangle({ x: margin, y: sectionTop - SECTION_TITLE_H + 6, width: pageW - margin * 2, height: SECTION_TITLE_H, color: navy });
    drawPageText(page, section.title.toUpperCase(), margin + 8, sectionTop - 6, { font: bold, size: 8, color: white });
    page.cursorY = sectionTop - SECTION_TITLE_H;

    section.rows.forEach((row, i) => {
      const rowY = page.cursorY - ROW_H;
      if (i % 2 === 0) {
        page.drawRectangle({ x: margin, y: rowY - 3, width: pageW - margin * 2, height: ROW_H, color: lightGrey });
      }
      const [label, value] = row;
      drawPageText(page, label, margin + 8, rowY + 2, { size: 8, color: grey });
      drawPageText(page, value.length > 65 ? value.slice(0, 62) + "…" : value, margin + 150, rowY + 2, { size: 8, font: bold });
      page.cursorY = rowY;
    });

    page.cursorY -= SECTION_GAP;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
