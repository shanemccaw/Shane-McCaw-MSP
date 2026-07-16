import { db, mspsTable, tenantSignalHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

export interface SimulatorScenarioPreset {
  id: string;
  name: string;
  description: string;
  eventIds: string[];
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
      
      const res = await db.update(mspsTable)
        .set({ suspendedAt: sevenDaysAgo })
        .where(eq(mspsTable.id, mspId));
        
      return { success: true, message: "Fast-forwarded suspension to T-8 days.", mutatedRows: res.rowCount ?? 0 };
    }
  },
  {
    id: "INJECT_MFA_DRIFT",
    name: "Fire MFA Disabled Alert",
    icon: "ShieldAlert",
    category: "security",
    description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop and sales offer.",
    execute: async (mspId) => {
      const res = await db.insert(tenantSignalHistoryTable).values({
        mspId: mspId,
        customerId: null,
        signalKey: "MFA_DISABLED",
        category: "security",
        firedAt: new Date(),
        ruleVersion: 1
      });
      return { success: true, message: "Injected critical MFA drift signal.", mutatedRows: res.rowCount ?? 0 };
    }
  },
  {
    id: "SLA_BREACH_TICKETS",
    name: "Age Open Tickets (SLA Breach)",
    icon: "Clock",
    category: "sla",
    description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
    execute: async (mspId) => {
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
      await db.update(mspsTable).set({ suspendedAt: null }).where(eq(mspsTable.id, mspId));
      await db.delete(tenantSignalHistoryTable).where(eq(tenantSignalHistoryTable.mspId, mspId));
      return { success: true, message: "Testbed restored to baseline." };
    }
  }
];