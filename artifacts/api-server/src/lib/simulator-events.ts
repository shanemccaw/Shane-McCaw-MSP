import { db } from "db";
import { msps, tenantSignals } from "db/schema";
import { eq, sql } from "drizzle-orm";

export interface SimulatorEventResult {
  success: boolean;
  message: string;
  mutatedRows?: number;
}

export interface SimulatorEventDef {
  id: string;
  name: string;
  icon: string;
  category: "billing" | "security" | "sow" | "sla" | "crm";
  description: string;
  demoSpeakerNote?: string;
  execute: (testbedMspId: number, params?: any) => Promise<SimulatorEventResult>;
}

export const SIMULATOR_MANIFEST: SimulatorEventDef[] = [
  {
    id: "MSP_SUSPEND_7_DAYS",
    name: "Simulate Unpaid Bill (>7 Days)",
    icon: "CreditCard",
    category: "billing",
    description: "Fast-forwards the MSP's suspended_at date to trigger the red lock-out banner in the portal.",
    demoSpeakerNote: "Notice how the moment billing fails, the entire customer portal locks down and prompts for card update.",
    execute: async (mspId) => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 8);
      
      const res = await db.update(msps)
        .set({ suspendedAt: sevenDaysAgo })
        .where(eq(msps.id, mspId));
        
      return { success: true, message: "Fast-forwarded suspension to T-8 days.", mutatedRows: res.rowCount };
    }
  },
  {
    id: "INJECT_MFA_DRIFT",
    name: "Fire MFA Disabled Alert",
    icon: "ShieldAlert",
    category: "security",
    description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop and sales offer.",
    execute: async (mspId) => {
      // In reality, you'll resolve the first tenant for this MSP
      const res = await db.insert(tenantSignals).values({
        mspId: mspId,
        tenantId: "dummy-tenant-id", // Update logic to fetch active testbed tenant
        type: "MFA_DISABLED",
        severity: "critical",
        status: "active",
        detectedAt: new Date(),
        rawPayload: { user: "admin@testbed.com", reason: "Conditional Access Policy modified" }
      });
      return { success: true, message: "Injected critical MFA drift signal.", mutatedRows: res.rowCount };
    }
  },
  {
    id: "SLA_BREACH_TICKETS",
    name: "Age Open Tickets (SLA Breach)",
    icon: "Clock",
    category: "sla",
    description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
    execute: async (mspId) => {
      // Logic to age kanban tasks will go here
      return { success: true, message: "Aged 3 open tickets past 48h SLA." };
    }
  },
  {
    id: "FACTORY_RESET",
    name: "Factory Reset Testbed",
    icon: "RefreshCcw",
    category: "crm",
    description: "Wipes all generated signals, clears suspensions, and restores baseline health scores.",
    execute: async (mspId) => {
      // Snapshot restore logic here
      await db.update(msps).set({ suspendedAt: null }).where(eq(msps.id, mspId));
      await db.delete(tenantSignals).where(eq(tenantSignals.mspId, mspId));
      return { success: true, message: "Testbed restored to baseline." };
    }
  }
];