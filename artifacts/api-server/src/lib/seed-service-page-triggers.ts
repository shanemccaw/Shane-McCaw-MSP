import { db, servicePageTriggerKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS: Array<{ pageSlug: string; triggerKeys: string[] }> = [
  { pageSlug: "microsoft-365",  triggerKeys: ["M365 Tenant Health Audit"] },
  { pageSlug: "copilot-ai",     triggerKeys: ["Copilot Readiness Assessment"] },
  { pageSlug: "sharepoint",     triggerKeys: ["Governance Foundations Package", "Migration Readiness Assessment"] },
  { pageSlug: "power-platform", triggerKeys: ["Power Platform Quick\u2011Start"] },
  { pageSlug: "governance",     triggerKeys: ["Governance Foundations Package"] },
  { pageSlug: "cloud-migration",triggerKeys: ["Migration Readiness Assessment"] },
];

export async function seedServicePageTriggerKeys(): Promise<void> {
  for (const entry of DEFAULTS) {
    const [existing] = await db
      .select()
      .from(servicePageTriggerKeysTable)
      .where(eq(servicePageTriggerKeysTable.pageSlug, entry.pageSlug))
      .limit(1);
    if (!existing) {
      await db.insert(servicePageTriggerKeysTable).values(entry);
    }
  }
}
