import {
  db,
  clientServicesTable,
  servicesTable,
  usersTable,
  mspCustomersTable,
  kanbanTasksTable,
  projectsTable,
  fulfillmentQueueTable,
  clientScoresTable,
  clientM365ProfilesTable
} from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";

interface CanvasWidget {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  properties?: any;
}

/**
 * Compiles a custom report canvas layout into a single, Outlook/Exchange Online-safe HTML body.
 * Avoids flexbox, CSS grid, and external stylesheets. Layout is managed entirely via tables with inline styles.
 */
export async function compileReportToHtml(
  canvasLayout: any,
  mspId: number,
  customerId: number,
  canvasName: string = "Custom Report"
): Promise<string> {
  let widgets: CanvasWidget[] = [];

  // Parse canvasLayout robustly to support different structures
  if (Array.isArray(canvasLayout)) {
    widgets = canvasLayout.map((item: any) => ({
      i: item.i || String(Math.random()),
      x: typeof item.x === 'number' ? item.x : 0,
      y: typeof item.y === 'number' ? item.y : 0,
      w: typeof item.w === 'number' ? item.w : 12,
      h: typeof item.h === 'number' ? item.h : 1,
      type: item.type || "rich_text",
      properties: item.properties || {},
    }));
  } else if (canvasLayout && typeof canvasLayout === "object") {
    const layout = (canvasLayout as any).layout;
    const widgetsMap = (canvasLayout as any).widgets;
    if (Array.isArray(layout)) {
      widgets = layout.map((item: any) => {
        const widgetInfo = widgetsMap && widgetsMap[item.i];
        return {
          i: item.i,
          x: typeof item.x === 'number' ? item.x : 0,
          y: typeof item.y === 'number' ? item.y : 0,
          w: typeof item.w === 'number' ? item.w : 12,
          h: typeof item.h === 'number' ? item.h : 1,
          type: widgetInfo?.type ?? item.type ?? "rich_text",
          properties: widgetInfo?.properties ?? item.properties ?? {},
        };
      });
    } else if (Array.isArray((canvasLayout as any).widgets)) {
      widgets = (canvasLayout as any).widgets.map((item: any) => ({
        i: item.i || String(Math.random()),
        x: typeof item.x === 'number' ? item.x : 0,
        y: typeof item.y === 'number' ? item.y : 0,
        w: typeof item.w === 'number' ? item.w : 12,
        h: typeof item.h === 'number' ? item.h : 1,
        type: item.type || "rich_text",
        properties: item.properties || {},
      }));
    }
  }

  // 1. Sort canvas items by y coordinate, then x coordinate
  const sorted = [...widgets].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  // 2. Group items with matching y values into single rows
  const rowsMap: Record<number, CanvasWidget[]> = {};
  for (const item of sorted) {
    if (!rowsMap[item.y]) {
      rowsMap[item.y] = [];
    }
    rowsMap[item.y].push(item);
  }

  const yCoords = Object.keys(rowsMap).map(Number).sort((a, b) => a - b);

  // Build the outer wrapper HTML
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${canvasName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0A2540; padding: 24px; color: #ffffff;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; line-height: 1.2;">${canvasName}</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">MSP Performance Report</p>
            </td>
          </tr>
          <!-- Content Area -->
          <tr>
            <td style="padding: 16px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
`;

  // Render rows
  for (const y of yCoords) {
    const rowWidgets = rowsMap[y]!;
    html += `                <tr style="vertical-align: top;">\n`;
    let currentX = 0;

    for (const widget of rowWidgets) {
      // Add spacer cell if there is a gap in x
      if (widget.x > currentX) {
        const gap = widget.x - currentX;
        const pct = (gap / 12) * 100;
        html += `                  <td width="${pct}%" style="width: ${pct}%; padding: 0; border: none;"></td>\n`;
      }

      // Convert grid widths (w out of 12) into cell percentages
      const pct = (widget.w / 12) * 100;
      const widgetContent = await renderWidget(widget, mspId, customerId);

      html += `                  <td width="${pct}%" style="width: ${pct}%; padding: 8px; vertical-align: top; box-sizing: border-box;">
                    ${widgetContent}
                  </td>\n`;

      currentX = widget.x + widget.w;
    }

    // Add trailing spacer if row doesn't fill up to 12 columns
    if (currentX < 12) {
      const gap = 12 - currentX;
      const pct = (gap / 12) * 100;
      html += `                  <td width="${pct}%" style="width: ${pct}%; padding: 0; border: none;"></td>\n`;
    }

    html += `                </tr>\n`;
  }

  html += `              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 11px;">
              This is a system generated report from your Managed Service Provider platform.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}

async function renderWidget(
  widget: CanvasWidget,
  mspId: number,
  customerId: number
): Promise<string> {
  const type = widget.type;
  switch (type) {
    case "billing":
      return await renderBillingWidget(customerId);
    case "open_items":
      return await renderOpenItemsWidget(customerId);
    case "telemetry":
      return await renderTelemetryWidget(customerId);
    case "rich_text":
      return renderRichTextWidget(widget.properties);
    default:
      return `<div style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; font-size: 13px; background-color: #ffffff;">Unknown Widget Type: ${type}</div>`;
  }
}

/**
 * Render clean HTML table of active subscriptions and monthly totals.
 */
async function renderBillingWidget(customerId: number): Promise<string> {
  let subRows: any[] = [];
  try {
    subRows = await db
      .select({
        name: servicesTable.name,
        billingType: servicesTable.billingType,
        priceCents: servicesTable.priceCents,
        price: servicesTable.price,
      })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .innerJoin(usersTable, eq(clientServicesTable.clientUserId, usersTable.id))
      .innerJoin(mspCustomersTable, eq(usersTable.company, mspCustomersTable.name))
      .where(
        and(
          eq(mspCustomersTable.id, customerId),
          eq(clientServicesTable.status, "active"),
          eq(servicesTable.billingType, "recurring_monthly")
        )
      );
  } catch (err) {
    // db fallback
  }

  let rowsHtml = '';
  let totalCents = 0;
  if (subRows && subRows.length > 0) {
    for (const sub of subRows) {
      const priceVal = sub.priceCents !== null && sub.priceCents !== undefined
        ? sub.priceCents
        : (sub.price ? Math.round(parseFloat(sub.price) * 100) : 0);
      
      totalCents += priceVal;
      const formattedPrice = `$${(priceVal / 100).toFixed(2)}`;
      
      rowsHtml += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 4px; font-size: 13px; color: #334155;">${sub.name}</td>
          <td style="padding: 8px 4px; font-size: 13px; color: #64748b;">Monthly</td>
          <td align="right" style="padding: 8px 4px; font-size: 13px; color: #334155; font-weight: 500;">${formattedPrice}</td>
        </tr>
      `;
    }
  } else {
    rowsHtml = `
      <tr>
        <td colspan="3" style="padding: 16px 4px; text-align: center; color: #64748b; font-size: 13px; font-style: italic;">No active recurring subscriptions.</td>
      </tr>
    `;
  }

  const formattedTotal = `$${(totalCents / 100).toFixed(2)}`;

  return `
    <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); font-family: 'Segoe UI', Arial, sans-serif;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; color: #0A2540; font-weight: 600; border-bottom: 2px solid #0078D4; padding-bottom: 4px;">Active Subscriptions</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <th align="left" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Subscription</th>
            <th align="left" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Billing Cycle</th>
            <th align="right" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${subRows && subRows.length > 0 ? `
          <tr style="border-top: 2px solid #e2e8f0; font-weight: bold;">
            <td colspan="2" style="padding: 10px 4px; font-size: 13px; color: #0A2540;">Monthly Total</td>
            <td align="right" style="padding: 10px 4px; font-size: 13px; color: #0078D4;">${formattedTotal}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render Kanban tasks / fulfillment items in an inline-styled HTML table.
 */
async function renderOpenItemsWidget(customerId: number): Promise<string> {
  let openTasks: any[] = [];
  let openFulfillments: any[] = [];

  try {
    openTasks = await db
      .select({
        title: kanbanTasksTable.title,
        column: kanbanTasksTable.column,
        priority: kanbanTasksTable.priority,
        dueDate: kanbanTasksTable.dueDate,
      })
      .from(kanbanTasksTable)
      .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
      .innerJoin(usersTable, eq(projectsTable.clientUserId, usersTable.id))
      .innerJoin(mspCustomersTable, eq(usersTable.company, mspCustomersTable.name))
      .where(
        and(
          eq(mspCustomersTable.id, customerId),
          ne(kanbanTasksTable.column, "completed")
        )
      );
  } catch (err) {
    // ignore
  }

  try {
    openFulfillments = await db
      .select({
        itemTitle: fulfillmentQueueTable.itemTitle,
        deliveryStatus: fulfillmentQueueTable.deliveryStatus,
        createdAt: fulfillmentQueueTable.createdAt,
        slaDueAt: fulfillmentQueueTable.slaDueAt,
      })
      .from(fulfillmentQueueTable)
      .where(
        and(
          eq(fulfillmentQueueTable.customerId, customerId),
          // "open" fulfillment items = anything not yet delivered
          ne(fulfillmentQueueTable.deliveryStatus, "delivered")
        )
      );
  } catch (err) {
    // ignore
  }

  interface UnifiedItem {
    type: "Task" | "Fulfillment";
    title: string;
    status: string;
    dueDate: Date | null;
  }

  const items: UnifiedItem[] = [];

  if (openTasks) {
    for (const t of openTasks) {
      items.push({
        type: "Task",
        title: t.title,
        status: t.column,
        dueDate: t.dueDate,
      });
    }
  }

  if (openFulfillments) {
    for (const f of openFulfillments) {
      items.push({
        type: "Fulfillment",
        title: f.itemTitle,
        status: f.deliveryStatus,
        dueDate: f.slaDueAt || f.createdAt,
      });
    }
  }

  // Sort by due date (ascending)
  items.sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  let rowsHtml = '';
  if (items.length > 0) {
    for (const item of items) {
      let statusColor = '#64748b';
      const rawStatus = String(item.status ?? '');
      // Emit Title Case directly rather than relying on CSS text-transform, which
      // Outlook/Exchange Online does not reliably honour.
      let statusText = rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const s = rawStatus.toLowerCase();
      if (s.includes('progress')) {
        statusColor = '#0284c7';
      } else if (s.includes('waiting')) {
        statusColor = '#ea580c';
      } else if (s.includes('review')) {
        statusColor = '#7c3aed';
      } else if (s.includes('not_started')) {
        statusColor = '#475569';
      } else if (s.includes('backlog')) {
        statusColor = '#64748b';
      }

      const dateStr = item.dueDate
        ? item.dueDate.toLocaleDateString()
        : 'No due date';

      rowsHtml += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 4px; font-size: 13px; color: #334155; line-height: 1.4;">
            <span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: #64748b; background-color: #f1f5f9; border: 1px solid #e2e8f0; padding: 2px 4px; border-radius: 4px; margin-right: 6px;">${item.type}</span>
            ${item.title}
          </td>
          <td style="padding: 8px 4px; font-size: 12px; white-space: nowrap;">
            <span style="color: ${statusColor}; font-weight: 600; text-transform: capitalize;">${statusText}</span>
          </td>
          <td align="right" style="padding: 8px 4px; font-size: 12px; color: #64748b; white-space: nowrap;">${dateStr}</td>
        </tr>
      `;
    }
  } else {
    rowsHtml = `
      <tr>
        <td colspan="3" style="padding: 16px 4px; text-align: center; color: #64748b; font-size: 13px; font-style: italic;">No open tasks or fulfillment items.</td>
      </tr>
    `;
  }

  return `
    <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); font-family: 'Segoe UI', Arial, sans-serif;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; color: #0A2540; font-weight: 600; border-bottom: 2px solid #0078D4; padding-bottom: 4px;">Open Tasks & Fulfillment</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <th align="left" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Description</th>
            <th align="left" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Status</th>
            <th align="right" style="padding: 6px 4px; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Due/Target</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render M365 tenant health scores and active signals.
 */
async function renderTelemetryWidget(customerId: number): Promise<string> {
  let score: any = null;
  let profileData: any = {};

  try {
    const scoreRows = await db
      .select({
        identity: clientScoresTable.identity,
        security: clientScoresTable.security,
        collaboration: clientScoresTable.collaboration,
        compliance: clientScoresTable.compliance,
        copilotReadiness: clientScoresTable.copilotReadiness,
      })
      .from(clientScoresTable)
      .innerJoin(usersTable, eq(clientScoresTable.clientId, usersTable.id))
      .innerJoin(mspCustomersTable, eq(usersTable.company, mspCustomersTable.name))
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);
    if (scoreRows && scoreRows.length > 0) {
      score = scoreRows[0];
    }
  } catch (err) {
    // ignore
  }

  try {
    const profileRows = await db
      .select({
        profile: clientM365ProfilesTable.profile,
      })
      .from(clientM365ProfilesTable)
      .innerJoin(usersTable, eq(clientM365ProfilesTable.clientId, usersTable.id))
      .innerJoin(mspCustomersTable, eq(usersTable.company, mspCustomersTable.name))
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);
    if (profileRows && profileRows.length > 0) {
      profileData = profileRows[0].profile || {};
    }
  } catch (err) {
    // ignore
  }

  const identity = score?.identity ?? 0;
  const security = score?.security ?? 0;
  const collaboration = score?.collaboration ?? 0;
  const compliance = score?.compliance ?? 0;
  const copilotReadiness = score?.copilotReadiness ?? 0;

  const categories = [
    { label: "Identity Protection", score: identity },
    { label: "Threat Security", score: security },
    { label: "Collaboration & Sharepoint", score: collaboration },
    { label: "Compliance & Governance", score: compliance },
    { label: "Copilot Readiness", score: copilotReadiness },
  ];

  let scoresHtml = '';
  for (const cat of categories) {
    let barColor = "#dc2626";
    if (cat.score >= 80) {
      barColor = "#16a34a";
    } else if (cat.score >= 50) {
      barColor = "#ca8a04";
    }

    scoresHtml += `
      <tr style="border-bottom: 1px solid #f8fafc;">
        <td style="padding: 6px 0; font-size: 13px; color: #334155; width: 45%;">${cat.label}</td>
        <td style="padding: 6px 0; width: 35%; vertical-align: middle;">
          <table width="100" cellpadding="0" cellspacing="0" border="0" style="width: 100px; background-color: #f1f5f9; height: 8px; border-radius: 4px; overflow: hidden; border-collapse: collapse;">
            <tr>
              <td width="${cat.score}%" style="background-color: ${barColor}; width: ${cat.score}%; height: 8px; padding: 0;"></td>
              <td width="${100 - cat.score}%" style="background-color: #f1f5f9; width: ${100 - cat.score}%; height: 8px; padding: 0;"></td>
            </tr>
          </table>
        </td>
        <td align="right" style="padding: 6px 0; font-size: 13px; font-weight: 600; color: ${barColor}; width: 20%;">${cat.score}%</td>
      </tr>
    `;
  }

  const activeSignals = [
    { label: "MFA Enforced", val: profileData.mfaEnforced },
    { label: "Conditional Access", val: profileData.conditionalAccessEnabled },
    { label: "Intune MDM Active", val: profileData.intuneEnabled },
    { label: "Defender Engaged", val: profileData.hasDefender },
    { label: "DLP Configured", val: profileData.hasDLP },
    { label: "Copilot Licensing", val: profileData.hasCopilotLicenses },
  ];

  let signalsHtml = '';
  for (const sig of activeSignals) {
    const isOk = sig.val === true || sig.val === 'true';
    const indicator = isOk
      ? `<span style="color: #16a34a; font-weight: bold; font-size: 14px;">✓</span>`
      : `<span style="color: #dc2626; font-weight: bold; font-size: 14px;">✗</span>`;
    
    signalsHtml += `
      <tr style="border-bottom: 1px solid #f8fafc;">
        <td style="padding: 6px 0; font-size: 13px; color: #334155;">${sig.label}</td>
        <td align="right" style="padding: 6px 0; font-size: 13px;">${indicator}</td>
      </tr>
    `;
  }

  return `
    <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); font-family: 'Segoe UI', Arial, sans-serif;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 14px; color: #0A2540; font-weight: 600; border-bottom: 2px solid #0078D4; padding-bottom: 4px;">M365 Tenant Telemetry</h3>
      
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <th align="left" colspan="3" style="padding: 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Health Scores</th>
          </tr>
        </thead>
        <tbody>
          ${scoresHtml}
        </tbody>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <th align="left" style="padding: 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Active Signal</th>
            <th align="right" style="padding: 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${signalsHtml}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Sanitize and render HTML content.
 */
function renderRichTextWidget(properties: any): string {
  const content = properties?.content || '<p style="margin: 0; color: #64748b; font-style: italic;">No content provided.</p>';
  const sanitized = sanitizeHtml(content);
  return `
    <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); color: #334155; font-size: 14px; line-height: 1.5; font-family: 'Segoe UI', Arial, sans-serif;">
      ${sanitized}
    </div>
  `;
}

function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/on\w+\s*=\s*(['"])(.*?)\1/gi, "")
    .replace(/javascript:/gi, "");
}
