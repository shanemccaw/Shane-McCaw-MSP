import { db, mspsTable, tenantSignalHistoryTable, tenantEngineOverridesTable, monitorChecksTable, mspCustomersTable, projectsTable, mspUsersTable, kanbanTasksTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { executeMonitorCheck } from "./monitor-executor";

export interface SimulatorContext {
  isTestbed: boolean;
  testbedMspId: number;
  testbedCustomerId?: number;
}

export const simulatorStorage = new AsyncLocalStorage<SimulatorContext>();


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
  execute: (testbedCustomerId: number, params?: any) => Promise<SimulatorEventResult>;
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
    execute: async (testbedCustomerId) => {
      const [customer] = await db
        .select({ mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, testbedCustomerId))
        .limit(1);

      if (!customer) {
        return { success: false, message: `Customer ID ${testbedCustomerId} not found.` };
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 8);
      
      const res = await db.update(mspsTable)
        .set({ suspendedAt: sevenDaysAgo })
        .where(eq(mspsTable.id, customer.mspId));
        
      return { success: true, message: "Fast-forwarded suspension to T-8 days.", mutatedRows: res.rowCount ?? 0 };
    }
  },
  {
    id: "INJECT_MFA_DRIFT",
    name: "Fire MFA Disabled Alert",
    icon: "ShieldAlert",
    category: "security",
    description: "Injects an active MFA_DISABLED signal directly into the tenant to trigger a score drop and sales offer.",
    execute: async (testbedCustomerId) => {
      const [customer] = await db
        .select({ tenantId: mspCustomersTable.tenantId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, testbedCustomerId))
        .limit(1);

      if (!customer) {
        return { success: false, message: `Customer ID ${testbedCustomerId} not found.` };
      }
      if (!customer.tenantId) {
        return { success: false, message: `Customer ID ${testbedCustomerId} has no tenant ID.` };
      }

      // Query active checks for MFA/credential/registration
      const mfaChecks = await db
        .select()
        .from(monitorChecksTable)
        .where(
          and(
            eq(monitorChecksTable.status, "active"),
            sql`${monitorChecksTable.key} ILIKE '%mfa%' OR ${monitorChecksTable.label} ILIKE '%mfa%' OR ${monitorChecksTable.key} ILIKE '%credential%' OR ${monitorChecksTable.label} ILIKE '%credential%'`
          )
        )
        .limit(1);

      let check = mfaChecks[0];
      let note = "";
      if (!check) {
        // Fallback to closest security-related check
        const fallbackChecks = await db
          .select()
          .from(monitorChecksTable)
          .where(
            and(
              eq(monitorChecksTable.status, "active"),
              sql`${monitorChecksTable.key} ILIKE '%security%' OR ${monitorChecksTable.label} ILIKE '%security%' OR ${monitorChecksTable.engines}::text ILIKE '%security%'`
            )
          )
          .limit(1);
        check = fallbackChecks[0];
        note = " (Note: dedicated MFA check not found, fell back to closest security-related check)";
      }

      if (!check) {
        return { success: false, message: "No active monitor check found to inject drift onto." };
      }

      const mapping = check.mapping as Array<{ sourceField: string; targetField: string; transform?: string }>;
      const properties = check.properties as string[];
      const sourceField = mapping[0]?.sourceField || properties[0] || "mfaRegistered";
      const fieldPath = `value[0].${sourceField}`;
      const injectedValue = false; // MFA disabled/non-compliant is boolean false

      // Delete existing overrides for this customer and endpoint
      await db.delete(tenantEngineOverridesTable)
        .where(
          and(
            eq(tenantEngineOverridesTable.testbedCustomerId, testbedCustomerId),
            eq(tenantEngineOverridesTable.graphEndpoint, check.endpoint)
          )
        );

      // Insert tenant_engine_overrides row
      await db.insert(tenantEngineOverridesTable).values({
        testbedCustomerId,
        graphEndpoint: check.endpoint,
        fieldPath,
        injectedValue,
        expiresAt: null
      });

      // Run monitor check
      const checkResult = await executeMonitorCheck({
        check,
        tenantId: customer.tenantId,
        triggerId: randomUUID(),
        skipIdempotency: true
      });

      return {
        success: true,
        message: `Injected override for check '${check.label}' (${check.key}) on endpoint '${check.endpoint}' and ran check. Status: ${checkResult.status}.${note}`,
        mutatedRows: 1
      };
    }
  },
  {
    id: "SLA_BREACH_TICKETS",
    name: "Age Open Tickets (SLA Breach)",
    icon: "Clock",
    category: "sla",
    description: "Ages all open Kanban tasks for this MSP past 48 hours to trigger escalation rules.",
    execute: async (testbedCustomerId) => {
      const [customer] = await db
        .select({ mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, testbedCustomerId))
        .limit(1);

      if (!customer) {
        return { success: false, message: `Customer ID ${testbedCustomerId} not found.` };
      }

      // Fetch active policies for this MSP
      const policies = await db.execute(sql`
        SELECT response_time_minutes, resolution_time_minutes FROM sla_policies
        WHERE is_active = true AND (msp_id = ${customer.mspId} OR msp_id IS NULL)
      `);

      let maxThresholdMinutes = 48 * 60; // default 48 hours if no policies
      if (policies.rows.length > 0) {
        const thresholdVals = policies.rows.map((p: any) =>
          Math.max(Number(p.response_time_minutes || 0), Number(p.resolution_time_minutes || 0))
        );
        maxThresholdMinutes = Math.max(...thresholdVals, 48 * 60);
      }

      // Compute aged date (threshold + 5 mins buffer)
      const ageDate = new Date();
      ageDate.setMinutes(ageDate.getMinutes() - (maxThresholdMinutes + 5));

      // Get project IDs belonging to the customer
      const projects = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .innerJoin(mspUsersTable, eq(projectsTable.clientUserId, mspUsersTable.userId))
        .where(eq(mspUsersTable.customerId, testbedCustomerId));

      const projectIds = projects.map(p => p.id);

      let mutatedRows = 0;
      if (projectIds.length > 0) {
        const updateRes = await db.update(kanbanTasksTable)
          .set({ createdAt: ageDate, updatedAt: new Date() })
          .where(
            and(
              inArray(kanbanTasksTable.projectId, projectIds),
              sql`${kanbanTasksTable.column} != 'completed'`
            )
          );
        mutatedRows = updateRes.rowCount ?? 0;

        // Age running SLA timers to trigger breach
        await db.execute(sql`
          UPDATE sla_timers
          SET started_at = ${ageDate.toISOString()}
          WHERE customer_id = ${testbedCustomerId} AND status = 'running'
        `);
      }

      return {
        success: true,
        message: `Aged open tasks and running SLA timers past ${Math.round(maxThresholdMinutes / 60)}h SLA threshold.`,
        mutatedRows
      };
    }
  },
  {
    id: "FACTORY_RESET",
    name: "Factory Reset Testbed",
    icon: "RefreshCcw",
    category: "crm",
    description: "Wipes all generated signals, clears suspensions, and restores baseline health scores.",
    execute: async (testbedCustomerId) => {
      const [customer] = await db
        .select({ mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, testbedCustomerId))
        .limit(1);

      let mspMutated = 0;
      if (customer) {
        const resMsp = await db.update(mspsTable).set({ suspendedAt: null }).where(eq(mspsTable.id, customer.mspId));
        const resSig = await db.delete(tenantSignalHistoryTable).where(eq(tenantSignalHistoryTable.mspId, customer.mspId));
        mspMutated = (resMsp.rowCount ?? 0) + (resSig.rowCount ?? 0);
      }

      const resOverrides = await db.delete(tenantEngineOverridesTable)
        .where(eq(tenantEngineOverridesTable.testbedCustomerId, testbedCustomerId));

      return {
        success: true,
        message: "Testbed restored to baseline (signals deleted, billing suspension cleared, and engine overrides removed).",
        mutatedRows: mspMutated + (resOverrides.rowCount ?? 0)
      };
    }
  }
];