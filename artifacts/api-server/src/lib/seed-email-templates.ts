import { db, emailTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

interface TemplateDefinition {
  slug: string;
  name: string;
  subject: string;
  bodyHtml: string;
  variables: Array<{ name: string; description: string }>;
}

const BLUE = "#0078D4";

const TEMPLATES: TemplateDefinition[] = [
  {
    slug: "purchase-confirmation",
    name: "Purchase Confirmation",
    subject: "Payment confirmed — {{serviceName}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the purchased service" },
      { name: "amountDollars", description: "Amount paid in USD (digits only, e.g. 1497)" },
      { name: "portalLink", description: "Full URL to the client portal" },
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
    <p style="margin-top:24px;">Questions? Just reply to this email or message Shane directly in the portal.</p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "onboarding-confirmation",
    name: "Onboarding Confirmation",
    subject: "Your project workspace is ready — {{serviceName}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the service" },
      { name: "amountDollars", description: "Amount paid in USD" },
      { name: "projectUrl", description: "Full URL to the new project workspace" },
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
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "password-reset",
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
    name: "Project Closure Request",
    subject: "Please sign off on your {{projectTitle}} project",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "projectTitle", description: "Title of the project" },
      { name: "projectUrl", description: "Full URL to the project sign-off page" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Congratulations — your project <strong>{{projectTitle}}</strong> has reached completion!</p>
    <p>Shane would like to officially close out this engagement. As part of the closure process, we'd love to hear your feedback and, if you're willing, capture a brief testimonial to share with other clients.</p>
    <p>Please visit your portal to review the project, provide your feedback, and sign off on the closure. It only takes a moment.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:140px;">Project</td><td style="padding:4px 0;font-weight:600;">{{projectTitle}}</td></tr>
    </table>
    <p style="margin-top:8px;font-size:13px;color:#64748b;">Your feedback is entirely optional, but it's genuinely valued — it helps us serve the next client better.</p>
    <p style="margin-top:8px;font-size:13px;color:#64748b;">By signing off you confirm that the deliverables were received and you grant permission to publish your feedback as a testimonial (you can opt out at any time).</p>
    <p style="margin:20px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Review &amp; Sign Off →</a></p>
    <p style="margin-top:24px;">Thank you for working with Shane — it's been a pleasure.</p>
    <p>— Shane McCaw Consulting</p>
  `,
  },
  {
    slug: "status-report-reply",
    name: "Status Report Reply (to Client)",
    subject: "Shane replied to your question on {{reportTitle}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "reportTitle", description: "Title of the status report" },
      { name: "adminReply", description: "Shane's reply text" },
      { name: "projectUrl", description: "URL to the project portal page" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Shane has replied to your question on the status report: <strong>{{reportTitle}}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{adminReply}}</blockquote>
    <p>You can view the full report and mark the question as resolved in your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your project →</a></p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "client-thread-reply",
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
    name: "Admin Thread Reply (to Client)",
    subject: "Shane replied on {{reportTitle}}",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "reportTitle", description: "Title of the status report" },
      { name: "replyContent", description: "Shane's reply message" },
      { name: "projectUrl", description: "URL to the client portal project page" },
    ],
    bodyHtml: `
    <p>Hi {{clientName}},</p>
    <p>Shane has replied to your follow-up on the status report: <strong>{{reportTitle}}</strong>.</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{replyContent}}</blockquote>
    <p>You can continue the conversation or mark it as resolved in your client portal.</p>
    <p style="margin:24px 0 0;"><a href="{{projectUrl}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View your project →</a></p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "retainer-resumed",
    name: "Retainer Resumed",
    subject: "Your {{serviceName}} retainer has been resumed",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "serviceName", description: "Name of the retainer service" },
      { name: "nextBillingDate", description: "Next billing date" },
      { name: "portalLink", description: "Full URL to the client portal" },
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
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "service-overview-confirmation",
    name: "Service Overview Confirmation (to Lead)",
    subject: "Your {{serviceName}} overview is on its way",
    variables: [
      { name: "firstName", description: "Lead's first name" },
      { name: "serviceName", description: "Name of the requested service" },
      { name: "bookingLink", description: "URL for booking a free discovery call" },
    ],
    bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thanks for your interest in Shane's <strong>{{serviceName}}</strong> services. Shane personally reviews every request and will send you the overview document and follow up within <strong>one business day</strong>.</p>
    <p>In the meantime, if you have any urgent questions you can reach Shane directly at <a href="mailto:info@shanemccaw.com" style="color:${BLUE};">info@shanemccaw.com</a> or book a free discovery call below.</p>
    <p style="margin:24px 0 0;"><a href="{{bookingLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Free Discovery Call →</a></p>
    <p style="margin-top:24px;">— Shane McCaw</p>
  `,
  },
  {
    slug: "service-overview-lead-notification",
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
    name: "Quiz Lead Notification (Admin)",
    subject: "New quiz lead — {{name}} scored {{totalScore}}/50",
    variables: [
      { name: "name", description: "Lead's full name" },
      { name: "email", description: "Lead's email address" },
      { name: "company", description: "Lead's company name" },
      { name: "totalScore", description: "Total quiz score out of 50" },
      { name: "tier", description: "Maturity tier (e.g. Beginner, Intermediate, Advanced)" },
      { name: "recommendedService", description: "AI-recommended service for this lead" },
    ],
    bodyHtml: `
    <p>Hi Shane,</p>
    <p>A new quiz lead just came in — <strong>{{name}}</strong> completed the Microsoft Copilot Readiness Assessment. Their results are below.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Name</td><td style="padding:4px 0;font-weight:600;">{{name}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;"><a href="mailto:{{email}}" style="color:${BLUE};">{{email}}</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Company</td><td style="padding:4px 0;">{{company}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Total Score</td><td style="padding:4px 0;font-weight:600;">{{totalScore}} / 50</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">{{tier}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">{{recommendedService}}</td></tr>
    </table>
    <p>The lead has been saved to the admin panel. Follow up while they're warm — their personalised report was emailed to them moments ago.</p>
    <p style="margin:24px 0 0;"><a href="mailto:{{email}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Reply to {{name}} →</a></p>
    <p style="margin-top:24px;">— Shane McCaw Consulting (automated notification)</p>
  `,
  },
  {
    slug: "admin-purchase-alert",
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
    name: "Service Overview Email (with PDF, to Lead)",
    subject: "Your {{serviceName}} overview from Shane McCaw Consulting",
    variables: [
      { name: "firstName", description: "Lead's first name" },
      { name: "serviceName", description: "Name of the service they requested" },
      { name: "bookingLink", description: "URL for booking a free discovery call" },
    ],
    bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thank you for your interest in Shane's <strong>{{serviceName}}</strong> services. Please find your personalised overview document attached to this email.</p>
    <p>The overview covers what's included, typical timelines, and expected outcomes so you can make an informed decision.</p>
    <p>Shane personally reviews every request and will follow up within <strong>one business day</strong>. In the meantime, feel free to book a free 30-minute discovery call to discuss your specific situation.</p>
    <p style="margin:24px 0 0;"><a href="{{bookingLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Free Discovery Call →</a></p>
    <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
  `,
  },
  {
    slug: "client-message-notification",
    name: "Client Message Notification (to Client)",
    subject: "New message from Shane McCaw Consulting",
    variables: [
      { name: "clientName", description: "Client's full name" },
      { name: "messageBody", description: "The message text sent by Shane" },
      { name: "portalLink", description: "URL to the client's message inbox in the portal" },
    ],
    bodyHtml: `
    <p>Hello {{clientName}},</p>
    <p>You have a new message from Shane McCaw Consulting:</p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;color:#1e293b;font-size:15px;line-height:1.6;">{{messageBody}}</blockquote>
    <p style="margin:24px 0 0;"><a href="{{portalLink}}" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">View in your portal →</a></p>
  `,
  },
  {
    slug: "admin-message-notification",
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
    name: "Quiz Report Email (to Lead)",
    subject: "Your {{reportName}} Report",
    variables: [
      { name: "firstName", description: "Lead's first name" },
      { name: "reportName", description: "Name of the assessment (e.g. Microsoft Copilot Readiness Assessment)" },
      { name: "totalScore", description: "Total quiz score (e.g. 38)" },
      { name: "tier", description: "Maturity tier (e.g. Beginner, Intermediate, Advanced)" },
      { name: "recommendedService", description: "AI-recommended service for this lead" },
    ],
    bodyHtml: `
    <p>Hi {{firstName}},</p>
    <p>Thank you for completing the <strong>{{reportName}}</strong>. Your personalised report is attached to this email.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">{{totalScore}} / 50</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">{{tier}}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">{{recommendedService}}</td></tr>
    </table>
    <p>Your PDF report includes a full breakdown across all five assessment categories, plus a tailored recommendation and ROI projection.</p>
    <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
    <p style="margin:24px 0 0;"><a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a></p>
    <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
  `,
  },
  {
    slug: "welcome-email",
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
];

export async function seedEmailTemplates(): Promise<void> {
  for (const tpl of TEMPLATES) {
    const [existing] = await db
      .select({ slug: emailTemplatesTable.slug })
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, tpl.slug))
      .limit(1);

    if (existing) {
      logger.debug({ slug: tpl.slug }, "Email template already seeded — skipping");
      continue;
    }

    await db.insert(emailTemplatesTable).values({
      slug: tpl.slug,
      name: tpl.name,
      subject: tpl.subject,
      bodyHtml: tpl.bodyHtml,
      variables: tpl.variables,
    });
    logger.info({ slug: tpl.slug }, "Email template seeded");
  }
}
