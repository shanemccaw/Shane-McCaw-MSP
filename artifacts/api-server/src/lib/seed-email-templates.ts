import { db, emailTemplatesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "comms.email" });

interface TemplateDefinition {
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  variables: Array<{ name: string; description: string }>;
  recipientType: "client" | "admin";
}

const BLUE = "#0078D4";

const TEMPLATES: TemplateDefinition[] = [
  {
    slug: "purchase-confirmation",
    recipientType: "client",
    name: "Purchase Confirmation",
    subject: "Payment confirmed — {{serviceName}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the purchased service" },
      { name: "amountDollars", description: "Amount paid in USD (digits only, e.g. 1497)" },
      { name: "portalLink", description: "Full URL to the client portal" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Thank you for your purchase — payment has been confirmed. Here's a summary:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Service</td><td style="padding:4px 0;font-weight:600;">{{serviceName}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount paid</td><td style="padding:4px 0;font-weight:600;">\${{amountDollars}} USD</td></tr>
    </table>
    <p>Shane will be in touch within <strong>1–2 business days</strong> to kick things off. In the meantime, you can check your project status in your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your portal →</a></p>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:24px;">Questions? Just reply to this email or message Shane directly in the portal.</p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "onboarding-confirmation",
    recipientType: "client",
    name: "Onboarding Confirmation",
    subject: "Your project workspace is ready — {{serviceName}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the service" },
      { name: "amountDollars", description: "Amount paid in USD" },
      { name: "projectUrl", description: "Full URL to the new project workspace" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Your payment is confirmed and your <strong>{{serviceName}}</strong> project workspace has been created. Here's what happens next:</p>
    <ol style="padding-left:20px;line-height:2;">
      <li>Shane will reach out within <strong>1 business day</strong> to schedule your kickoff call.</li>
      <li>You'll receive access details and any prep materials before the call.</li>
      <li>Track every step of your project in real time in your portal.</li>
    </ol>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Service</td><td style="padding:4px 0;font-weight:600;">{{serviceName}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount paid</td><td style="padding:4px 0;font-weight:600;">\${{amountDollars}} USD</td></tr>
    </table>
    <p style="margin:24px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your project workspace →</a></p>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "account-setup",
    recipientType: "client",
    name: "Account Setup (Welcome)",
    subject: "Set up your Shane McCaw Consulting portal",
    variables: [
      { name: "setupLink", description: "One-time password setup URL (expires in 72 hours)" },
      { name: "clientName", description: "Client's full name or email" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Your project workspace has been created and is ready for you. The last step is setting your portal password so you can log in and track your project in real time.</p>
    <p style="margin:24px 0 0;"><a href="{{setupLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Set up my portal →</a></p>
    <p style="margin-top:16px;color:#64748b;font-size:13px;">This link expires in <strong>72 hours</strong>. If you didn't expect this email, you can safely ignore it.</p>
    <p style="margin-top:24px;">Looking forward to working with you.</p>
    <p>— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
  `,
  },
  {
    slug: "password-reset",
    recipientType: "client",
    name: "Password Reset",
    subject: "Reset your Shane McCaw Consulting portal password",
    variables: [
      { name: "resetLink", description: "One-time password reset URL (expires in 1 hour)" },
    ],
    bodyHtml: `
    <p>Hi there,</p>
    <p>We received a request to reset your password for your <strong>Shane McCaw Consulting</strong> portal account.</p>
    <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
    <p style="margin:24px 0 0;"><a href="{{resetLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Reset my password →</a></p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `,
  },
  {
    slug: "contact-inquiry-notification",
    recipientType: "admin",
    name: "Contact Inquiry Notification (Admin)",
    subject: "New contact inquiry from {{name}} — {{company}}",
    variables: [
      { name: "name", description: "Sender's full name" },
      { name: "email", description: "Sender's email address" },
      { name: "company", description: "Sender's company name" },
      { name: "companySize", description: "Company size (optional)" },
      { name: "serviceArea", description: "Service area they're interested in" },
      { name: "message", description: "Their inquiry message" },
      { name: "howFound", description: "How they found Shane (optional)" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new contact form inquiry just came in from <strong>{{name}}</strong>. Here are the details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">{{name}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:{{email}}" style="color:${BLUE};">{{email}}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">{{company}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company size</td><td style="padding:4px 0;">{{companySize}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Service needed</td><td style="padding:4px 0;font-weight:600;">{{serviceArea}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">How they found you</td><td style="padding:4px 0;">{{howFound}}</td></tr>
    </table>
    <p style="font-weight:600;margin-bottom:4px;">Message:</p>
    <blockquote style="margin:0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{message}}</blockquote>
    <p style="margin:24px 0 0;"><a href="mailto:{{email}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Reply to {{name}} →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "closure-request",
    recipientType: "client",
    name: "Project Closure Request",
    subject: "Please sign off on your {{projectTitle}} project",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "projectTitle", description: "Title of the project" },
      { name: "projectUrl", description: "Full URL to the project sign-off page" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Congratulations — your project <strong>{{projectTitle}}</strong> has reached completion!</p>
    <p>Shane would like to officially close out this engagement. As part of the closure process, we'd love to hear your feedback and, if you're willing, capture a brief testimonial to share with other clients.</p>
    <p>Please visit your portal to review the project, provide your feedback, and sign off on the closure. It only takes a moment.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Project</td><td style="padding:4px 0;font-weight:600;">{{projectTitle}}</td></tr>
    </table>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:8px;font-size:13px;color:#64748b;">Your feedback is entirely optional, but it's genuinely valued — it helps us serve the next client better.</p>
    <p style="margin-top:8px;font-size:13px;color:#64748b;">By signing off you confirm that the deliverables were received and you grant permission to publish your feedback as a testimonial (you can opt out at any time).</p>
    <p style="margin:20px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Review &amp; Sign Off →</a></p>
    <p style="margin-top:24px;">Thank you for working with Shane — it's been a pleasure.</p>
    <p>— Shane McCaw Consulting</p>
  `,
  },
  {
    slug: "status-report-reply",
    recipientType: "client",
    name: "Status Report Reply (to Client)",
    subject: "Shane replied to your question on {{reportTitle}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "reportTitle", description: "Title of the status report" },
      { name: "adminReply", description: "Shane's reply text" },
      { name: "projectUrl", description: "URL to the project portal page" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Shane has replied to your question on the status report: <strong>{{reportTitle}}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{adminReply}}</blockquote>
    <p>You can view the full report and mark the question as resolved in your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your project →</a></p>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "client-thread-reply",
    recipientType: "admin",
    name: "Client Thread Reply (to Admin)",
    subject: "{{clientName}} replied on {{reportTitle}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "reportTitle", description: "Title of the status report" },
      { name: "replyContent", description: "The client's reply message" },
      { name: "adminPanelUrl", description: "URL to the admin panel project page" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p><strong>{{clientName}}</strong> has sent a follow-up message on the status report: <strong>{{reportTitle}}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{replyContent}}</blockquote>
    <p>You can view the full conversation and reply in the admin panel.</p>
    <p style="margin:24px 0 0;"><a href="{{adminPanelUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View in admin panel →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "admin-thread-reply",
    recipientType: "client",
    name: "Admin Thread Reply (to Client)",
    subject: "Shane replied on {{reportTitle}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "reportTitle", description: "Title of the status report" },
      { name: "replyContent", description: "Shane's reply message" },
      { name: "projectUrl", description: "URL to the client portal project page" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Shane has replied to your follow-up on the status report: <strong>{{reportTitle}}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{replyContent}}</blockquote>
    <p>You can continue the conversation or mark it as resolved in your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your project →</a></p>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "retainer-resumed",
    recipientType: "client",
    name: "Retainer Resumed",
    subject: "Your {{serviceName}} retainer has been resumed",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the retainer service" },
      { name: "nextBillingDate", description: "Next billing date" },
      { name: "portalLink", description: "Full URL to the client portal" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Great news — your <strong>{{serviceName}}</strong> retainer has been successfully resumed. The scheduled cancellation has been reversed and your service will continue uninterrupted.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Service</td><td style="padding:4px 0;font-weight:600;">{{serviceName}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Next charge</td><td style="padding:4px 0;font-weight:600;">{{nextBillingDate}}</td></tr>
    </table>
    <p>If you didn't intend to resume this retainer, or if you have any questions, please reach out via your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your portal →</a></p>
    {{tenantHealthBlockHtml}}
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "service-overview-lead-notification",
    recipientType: "admin",
    name: "Service Overview Lead Notification (Admin)",
    subject: "New service overview request from {{name}} — {{company}}",
    variables: [
      { name: "name", description: "Lead's full name" },
      { name: "email", description: "Lead's email address" },
      { name: "company", description: "Lead's company name" },
      { name: "serviceName", description: "Service they requested an overview for" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new lead just requested the <strong>{{serviceName}}</strong> service overview. Here are their details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">{{name}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:{{email}}" style="color:${BLUE};">{{email}}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">{{company}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Service requested</td><td style="padding:4px 0;font-weight:600;">{{serviceName}}</td></tr>
    </table>
    <p style="margin:24px 0 0;"><a href="mailto:{{email}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Reply to {{name}} →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "quiz-lead-notification",
    recipientType: "admin",
    name: "Quiz Lead Notification (Admin)",
    subject: "New quiz lead — {{name}} scored {{totalScore}}/50",
    variables: [
      { name: "name", description: "Lead's full name" },
      { name: "email", description: "Lead's email address" },
      { name: "company", description: "Lead's company name" },
      { name: "totalScore", description: "Total quiz score out of 50" },
      { name: "tier", description: "Maturity tier (e.g. Beginner, Intermediate, Advanced)" },
      { name: "recommendedService", description: "AI-recommended service for this lead" },
      { name: "whatThisMeans", description: "AI-generated summary of what the score means for this organisation" },
      { name: "whyThisFits", description: "AI-generated explanation of why the recommended service fits" },
      { name: "roiProjection", description: "AI-generated ROI projection for this lead" },
      { name: "categoryScoresRows", description: "Pre-rendered HTML table rows — one row per assessment category with label and score" },
      { name: "resultsUrl", description: "URL to the lead's online results page (valid for 7 days)" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new quiz lead just came in — <strong>{{name}}</strong> completed the Microsoft Copilot Readiness Assessment. Their full results are below.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">{{name}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:{{email}}" style="color:${BLUE};">{{email}}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">{{company}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Total Score</td><td style="padding:4px 0;font-weight:600;">{{totalScore}} / 50</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">{{tier}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">{{recommendedService}}</td></tr>
      {{categoryScoresRows}}
    </table>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">What This Means</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{whatThisMeans}}</p>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Why This Fits</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{whyThisFits}}</p>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">ROI Projection</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{roiProjection}}</p>
    <p>The lead has been saved to the admin panel. Follow up while they're warm — their personalised report was emailed to them moments ago.</p>
    <p style="margin:12px 0;"><a href="{{resultsUrl}}" style="color:${BLUE};font-size:13px;">View their full results online →</a></p>
    <p style="margin:24px 0 0;"><a href="mailto:{{email}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Reply to {{name}} →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "admin-purchase-alert",
    recipientType: "admin",
    name: "Purchase Alert (Admin)",
    subject: "New purchase: {{serviceName}} — {{clientName}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "clientEmail", description: "Client's email address" },
      { name: "serviceName", description: "Name of the purchased service" },
      { name: "amountDollars", description: "Amount paid in USD" },
      { name: "purchaseType", description: "Type of purchase (Service purchase or Onboarding purchase)" },
      { name: "portalLink", description: "URL to view the purchase in the portal" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new <strong>{{purchaseType}}</strong> just came in:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Client</td><td style="padding:4px 0;font-weight:600;">{{clientName}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;">{{clientEmail}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Service</td><td style="padding:4px 0;font-weight:600;">{{serviceName}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Amount</td><td style="padding:4px 0;font-weight:600;">\${{amountDollars}} USD</td></tr>
    </table>
    <p>Please activate the service in the client's portal when you're ready to begin.</p>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View in dashboard →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "service-overview-email",
    recipientType: "client",
    name: "Service Overview Email (to Lead)",
    subject: "Your {{serviceName}} overview — Shane McCaw Consulting",
    variables: [
      { name: "firstName", description: "Lead's first name" },
      { name: "serviceName", description: "Name of the service they requested" },
      { name: "bookingLink", description: "URL for booking a free discovery call" },
    ],
    bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thank you for your interest in Shane's <strong>{{serviceName}}</strong> services. Shane personally reviews every request and will be in touch within <strong>one business day</strong> with your overview document and to answer any questions.</p>
    <p>In the meantime, if you'd like to jump ahead, feel free to book a free 30-minute discovery call to discuss your specific situation directly with Shane.</p>
    <p style="margin:24px 0 0;"><a href="{{bookingLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Free Discovery Call →</a></p>
    <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
  `,
  },
  {
    slug: "client-message-notification",
    recipientType: "client",
    name: "Client Message Notification (to Client)",
    subject: "New message from Shane McCaw Consulting",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "messageBody", description: "The message text sent by Shane" },
      { name: "portalLink", description: "URL to the client's message inbox in the portal" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available" },
    ],
    bodyHtml: `
    <p>Hello {{clientName}},</p>
    <p>You have a new message from Shane McCaw Consulting:</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{messageBody}}</blockquote>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View in your portal →</a></p>
    {{tenantHealthBlockHtml}}
  `,
  },
  {
    slug: "admin-message-notification",
    recipientType: "admin",
    name: "Admin Message Notification (to Shane)",
    subject: "New client message from {{clientName}}",
    variables: [
      { name: "clientName", description: "Client's full name or email" },
      { name: "messageBody", description: "The message text sent by the client" },
    ],
    bodyHtml: `
    <p>Hello Shane,</p>
    <p><strong>{{clientName}}</strong> sent a new message:</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{messageBody}}</blockquote>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "quiz-report-email",
    recipientType: "client",
    name: "Quiz Report Email (to Lead)",
    subject: "Your {{reportName}} Report",
    variables: [
      { name: "firstName", description: "Lead's first name" },
      { name: "reportName", description: "Name of the assessment (e.g. Microsoft Copilot Readiness Assessment)" },
      { name: "totalScore", description: "Total quiz score (e.g. 38)" },
      { name: "tier", description: "Maturity tier (e.g. Beginner, Intermediate, Advanced)" },
      { name: "recommendedService", description: "AI-recommended service for this lead" },
      { name: "whatThisMeans", description: "AI-generated summary of what the score means for this organisation" },
      { name: "whyThisFits", description: "AI-generated explanation of why the recommended service fits" },
      { name: "roiProjection", description: "AI-generated ROI projection for this lead" },
      { name: "categoryScoresRows", description: "Pre-rendered HTML table rows — one row per assessment category with label and score" },
      { name: "resultsUrl", description: "URL to the lead's online results page (valid for 7 days)" },
    ],
    bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thank you for completing the <strong>{{reportName}}</strong>. Your personalised report is attached to this email — here is a summary of your results.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">{{totalScore}} / 50</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">{{tier}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">{{recommendedService}}</td></tr>
      {{categoryScoresRows}}
    </table>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">What This Means For You</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{whatThisMeans}}</p>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Recommended Next Step — Why This Fits</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{whyThisFits}}</p>
    <p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">ROI Projection</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">{{roiProjection}}</p>
    <p style="margin:12px 0;"><a href="{{resultsUrl}}" style="color:${BLUE};font-size:13px;">View your full results online →</a></p>
    <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
    <p style="margin:24px 0 0;"><a href="https://shanemccaw.com/contact" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a></p>
    <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
  `,
  },
  {
    slug: "welcome-email",
    recipientType: "client",
    name: "Welcome Email (New Client)",
    subject: "Welcome to Shane McCaw Consulting — your portal is ready",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "portalLink", description: "Full URL to the client portal" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Welcome! Your Shane McCaw Consulting client portal has been set up and is ready for you.</p>
    <p>Inside your portal you can:</p>
    <ul style="padding-left:20px;line-height:2;">
      <li>Track the progress of your project in real time</li>
      <li>View status reports and milestones</li>
      <li>Send messages directly to Shane</li>
      <li>Access all deliverables and shared files</li>
    </ul>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Go to your portal →</a></p>
    <p style="margin-top:24px;">Looking forward to working with you.</p>
    <p>— Shane McCaw</p>
  `,
  },
  {
    slug: "mfa-reset",
    name: "MFA Reset Notification",
    recipientType: "client" as const,
    subject: "Your two-factor authentication has been reset",
    variables: [
      { name: "clientName", description: "Client's full name or email" },
      { name: "methodsList", description: "Comma-separated list of cleared MFA methods" },
      { name: "loginLink", description: "Full URL to the client portal login page" },
      { name: "securityLink", description: "Full URL to the portal security settings page" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Your two-factor authentication (2FA) has been reset by your administrator. The following method(s) were removed:</p>
    <p style="margin:16px 0;padding:12px 16px;background:#F7F9FC;border-left:3px solid #0078D4;border-radius:4px;font-weight:600;">{{methodsList}}</p>
    <p>You can sign in to your portal and set up a new authentication method at any time.</p>
    <p style="margin:24px 0 8px;"><a href="{{loginLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Sign in to your portal →</a></p>
    <p style="margin-top:16px;"><a href="{{securityLink}}" style="color:#0078D4;font-size:13px;">Manage security settings</a></p>
    <p style="margin-top:24px;color:#666;font-size:12px;">If you did not expect this change or believe it was made in error, please contact us immediately by replying to this email.</p>
    <p>— Shane McCaw</p>
  `,
  },
  {
    slug: "branded-layout",
    recipientType: "admin",
    name: "Branded Email Layout (Wrapper)",
    subject: "",
    variables: [
      { name: "body", description: "Raw inner HTML body content to render inside the branded header/footer wrapper. Do not remove this placeholder." },
    ],
    bodyHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Shane McCaw Consulting</title>
</head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0A2540;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Shane McCaw Consulting</p>
            <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Lead Microsoft 365 Architect</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#1e293b;font-size:15px;line-height:1.6;">
            {{body}}
          </td>
        </tr>
        <tr>
          <td style="background:#f1f5f9;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
              Shane McCaw Consulting LLC &nbsp;|&nbsp; <a href="https://shanemccaw.com" style="color:${BLUE};text-decoration:none;">shanemccaw.com</a><br/>
              You're receiving this because you have an account or made a purchase with us.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  },
  {
    slug: "discovery-call-confirmation",
    recipientType: "client",
    name: "Discovery Call Confirmation (to Client)",
    subject: "Discovery Call Confirmed — {{slotLabel}}",
    variables: [
      { name: "name", description: "Customer's first name" },
      { name: "slotLabel", description: "Human-readable date/time label for the booked slot" },
      { name: "companyRowHtml", description: "Pre-rendered table row HTML for the company field, or empty string if none was provided" },
      { name: "joinButtonHtml", description: "Pre-rendered HTML for the Join Microsoft Teams Meeting button, or empty string if no calendar event was created" },
      { name: "calendarNoticeHtml", description: "Pre-rendered HTML notice about receiving a calendar invite, or empty string if Graph calendar integration is not configured" },
      { name: "tenantHealthBlockHtml", description: "Pre-rendered tenant-health-block HTML, or empty string when no health data is available (e.g. a new lead with no client record yet)" },
    ],
    bodyHtml: `
    <p>Hi {{name}},</p>
    <p>Your discovery call with Shane McCaw is confirmed. Here are the details:</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Date &amp; time</td><td style="padding:4px 0;font-weight:600;">{{slotLabel}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Duration</td><td style="padding:4px 0;">30 minutes</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Format</td><td style="padding:4px 0;">Microsoft Teams</td></tr>
      {{companyRowHtml}}
    </table>
    {{joinButtonHtml}}
    {{calendarNoticeHtml}}
    {{tenantHealthBlockHtml}}
    <p>Please come prepared with your most pressing Microsoft 365 questions. Shane will be ready to dig in.</p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "admin-discovery-call-notification",
    recipientType: "admin",
    name: "New Discovery Call Booking (Admin)",
    subject: "New Booking: {{name}} — {{slotLabel}}",
    variables: [
      { name: "name", description: "Customer's full name" },
      { name: "email", description: "Customer's email address" },
      { name: "slotLabel", description: "Human-readable date/time label for the booked slot" },
      { name: "companyRowHtml", description: "Pre-rendered table row HTML for the company field, or empty string if none was provided" },
      { name: "topicHtml", description: "Pre-rendered HTML blockquote containing the customer's topic/agenda (line breaks converted to <br/>)" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new discovery call has been booked.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Name</td><td style="padding:4px 0;font-weight:600;">{{name}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:{{email}}" style="color:${BLUE};">{{email}}</a></td></tr>
      {{companyRowHtml}}
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Date &amp; time</td><td style="padding:4px 0;font-weight:600;">{{slotLabel}}</td></tr>
    </table>
    <p style="font-weight:600;margin-bottom:4px;">Topic / Agenda:</p>
    {{topicHtml}}
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "kanban-script-exhausted",
    recipientType: "admin",
    name: "Kanban Script Auto-Fire Exhausted (Admin)",
    subject: "⚠️ Kanban auto-fire exhausted — \"{{scriptTitle}}\" ({{failureCount}} failures)",
    variables: [
      { name: "scriptTitle", description: "Title of the script that failed" },
      { name: "cardIds", description: "Comma-separated Kanban card IDs affected" },
      { name: "lastStatus", description: "Last Azure Automation job status" },
      { name: "jobId", description: "Azure Automation job ID" },
      { name: "failureCount", description: "Number of consecutive failures" },
      { name: "maxFailures", description: "Configured maximum retry budget" },
      { name: "projectUrl", description: "URL to the project in the Admin Panel" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>The Kanban auto-fire workflow has exhausted its retry budget (<strong>{{failureCount}} consecutive failures</strong>) for the following script card and can no longer automatically recover.</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;width:100%;">
      <tbody>
        <tr style="background:#fef2f2;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;">Script</td>
          <td style="padding:10px 16px;font-size:14px;">{{scriptTitle}}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Card IDs</td>
          <td style="padding:10px 16px;font-size:14px;">{{cardIds}}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Last Azure status</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">{{lastStatus}}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Job ID</td>
          <td style="padding:10px 16px;font-size:14px;font-family:monospace;">{{jobId}}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Failures</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">{{failureCount}} / {{maxFailures}}</td>
        </tr>
      </tbody>
    </table>
    <p>The cards have been left in backlog with status <strong>auto_fire_exhausted</strong>. Please review the Azure Automation account and then manually trigger the script from the Admin Panel.</p>
    <p style="margin-top:24px;">
      <a href="{{projectUrl}}" style="background:#0078D4;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View project in Admin Panel →</a>
    </p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `,
  },
  {
    slug: "kanban-document-exhausted",
    recipientType: "admin",
    name: "Kanban Document Auto-Fire Exhausted (Admin)",
    subject: "⚠️ Document auto-fire exhausted — \"{{docTitle}}\" ({{failureCount}} failures)",
    variables: [
      { name: "docTitle", description: "Title of the document that failed to generate" },
      { name: "docType", description: "Document type key" },
      { name: "cardId", description: "Kanban card ID affected" },
      { name: "lastError", description: "Last error message" },
      { name: "failureCount", description: "Number of consecutive failures" },
      { name: "maxFailures", description: "Configured maximum retry budget" },
      { name: "projectUrl", description: "URL to the project in the Admin Panel" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>The Kanban document-generation auto-fire has exhausted its retry budget (<strong>{{failureCount}} consecutive failures</strong>) for the following card and can no longer automatically recover.</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;width:100%;">
      <tbody>
        <tr style="background:#fef2f2;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;">Document</td>
          <td style="padding:10px 16px;font-size:14px;">{{docTitle}}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Doc type</td>
          <td style="padding:10px 16px;font-size:14px;font-family:monospace;">{{docType}}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Card ID</td>
          <td style="padding:10px 16px;font-size:14px;">{{cardId}}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Last error</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">{{lastError}}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;">Failures</td>
          <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#dc2626;">{{failureCount}} / {{maxFailures}}</td>
        </tr>
      </tbody>
    </table>
    <p>The card has been left in backlog with status <strong>auto_fire_exhausted</strong>. Please review the AI / document-generation configuration and then manually trigger the document from the Admin Panel.</p>
    <p style="margin-top:24px;">
      <a href="{{projectUrl}}" style="background:#0078D4;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View project in Admin Panel →</a>
    </p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `,
  },
  {
    slug: "manual-script-escalation",
    recipientType: "admin",
    name: "Manual Script Escalation Alert (Admin)",
    subject: "⚠️ {{cardCount}} manual script card(s) have been waiting >{{thresholdDays}} business days",
    variables: [
      { name: "cardCount", description: "Number of overdue cards" },
      { name: "thresholdDays", description: "Escalation threshold in business days" },
      { name: "rowsHtml", description: "Pre-rendered HTML table rows — one row per overdue card (client, task, wait time, link)" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>The following manual script card(s) have been waiting on the client for more than {{thresholdDays}} business days without action. You may want to follow up.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Client</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Task</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Waiting</th>
          <th style="padding:10px 8px;text-align:left;font-size:13px;color:#64748b;font-weight:600;">Link</th>
        </tr>
      </thead>
      <tbody>
        {{rowsHtml}}
      </tbody>
    </table>
    <p style="font-size:13px;color:#64748b;margin-top:16px;">Each card will only appear in this alert once per 24 hours.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated alert)</p>
  `,
  },
  {
    slug: "tenant-health-block",
    recipientType: "client",
    name: "Tenant Health Block (reusable snippet)",
    subject: "",
    variables: [
      { name: "tenantScore", description: "Overall tenant health score (0-100), averaged across available sub-scores" },
      { name: "tenantScoreBand", description: "Overall band: \"zero\", \"low\", \"medium\", or \"high\"" },
      { name: "complianceScore", description: "Compliance coverage sub-score (0-100), or empty string if not yet computed" },
      { name: "securityScore", description: "Security posture sub-score (0-100), or empty string if not yet computed" },
      { name: "governanceScore", description: "Governance maturity sub-score (0-100), or empty string if not yet computed" },
      { name: "adoptionScore", description: "Adoption sub-score (0-100), or empty string if not yet computed" },
      { name: "copilotScore", description: "Copilot readiness sub-score (0-100), or empty string if not yet computed" },
      { name: "tenantHealthIsZero", description: "\"true\" when the overall score is exactly 0, else empty string" },
      { name: "tenantHealthIsLow", description: "\"true\" when the overall score is below 60, else empty string" },
      { name: "tenantHealthIsHigh", description: "\"true\" when the overall score is 80 or above, else empty string" },
    ],
    // Intentionally left minimal — this is a reusable snippet embedded via
    // {{tenantHealthBlockHtml}} into other client-facing templates, not a
    // standalone email. Final visual design is out of scope for this change;
    // edit this row from the Admin Panel to build out the real layout.
    bodyHtml: `
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Tenant Health Score</td><td style="padding:4px 0;font-weight:600;">{{tenantScore}} / 100</td></tr>
    </table>
  `,
  },
  {
    slug: "script-run-failed",
    recipientType: "admin",
    name: "Script Run Failed (Admin)",
    subject: "Script run failed — {{clientLabel}}",
    variables: [
      { name: "clientLabel", description: "Client name/label the script run was for" },
      { name: "moduleFilename", description: "Filename of the script module that failed" },
      { name: "packageTitle", description: "Title of the script package" },
      { name: "lastStatus", description: "Last Azure Automation job status" },
      { name: "runId", description: "Internal run ID for the client script sequence" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>An automated script run for <strong>{{clientLabel}}</strong> failed at module <strong>{{moduleFilename}}</strong> (package: <em>{{packageTitle}}</em>).</p>
    <p>Job status: <strong>{{lastStatus}}</strong></p>
    <p>Run ID: {{runId}} — check the CRM portal for details.</p>
  `,
  },
];

function variablesEqual(
  a: Array<{ name: string; description: string }>,
  b: Array<{ name: string; description: string }>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function seedEmailTemplates(): Promise<void> {
  // Ensure the `is_customized` column exists before we rely on it below.
  // This is redundant with the startup migration in index.ts but makes this
  // function safe to call standalone/first, regardless of boot ordering.
  await db.execute(sql`
    ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS is_customized BOOLEAN NOT NULL DEFAULT false
  `);

  for (const tpl of TEMPLATES) {
    const [existing] = await db
      .select({
        slug: emailTemplatesTable.slug,
        subject: emailTemplatesTable.subject,
        bodyHtml: emailTemplatesTable.bodyHtml,
        variables: emailTemplatesTable.variables,
        recipientType: emailTemplatesTable.recipientType,
        isCustomized: emailTemplatesTable.isCustomized,
      })
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, tpl.slug))
      .limit(1);

    if (existing) {
      if (existing.isCustomized) {
        log.debug({ slug: tpl.slug }, "Email template skipped by seeder — customized via Admin Panel");
        continue;
      }

      // Backfill: rows created before the `is_customized` flag existed have
      // no reliable marker for prior Admin Panel edits. If the stored content
      // no longer matches the code-level baseline, treat it as customized
      // (preserve it, don't overwrite) rather than risk clobbering an edit
      // that predates this fix. Rows that still match the baseline are kept
      // in sync as before.
      const matchesBaseline =
        existing.subject === tpl.subject &&
        existing.bodyHtml === tpl.bodyHtml &&
        existing.recipientType === tpl.recipientType &&
        variablesEqual(existing.variables, tpl.variables);

      if (!matchesBaseline) {
        await db
          .update(emailTemplatesTable)
          .set({ isCustomized: true })
          .where(eq(emailTemplatesTable.slug, tpl.slug));
        log.info(
          { slug: tpl.slug },
          "Email template differs from code baseline — marking as customized and preserving existing content",
        );
        continue;
      }

      await db
        .update(emailTemplatesTable)
        .set({ subject: tpl.subject, bodyHtml: tpl.bodyHtml, variables: tpl.variables, recipientType: tpl.recipientType })
        .where(eq(emailTemplatesTable.slug, tpl.slug));
      log.debug({ slug: tpl.slug }, "Email template upserted (updated)");
      continue;
    }

    await db.insert(emailTemplatesTable).values({
      slug: tpl.slug,
      name: tpl.name,
      subject: tpl.subject,
      bodyHtml: tpl.bodyHtml,
      variables: tpl.variables,
      recipientType: tpl.recipientType,
      isCustomized: false,
    });
    log.info({ slug: tpl.slug }, "Email template seeded");
  }
}
