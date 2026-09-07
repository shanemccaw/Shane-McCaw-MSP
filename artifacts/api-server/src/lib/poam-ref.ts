import { randomUUID } from "node:crypto";
import { db, mspPoamsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * poam-ref.ts — the human-facing `msp_poams.poam_id` code, server-generated
 * rather than client-supplied (Git #3080).
 *
 * `msp_risk_decisions.rbdId` is client-supplied text — a real, historical gap
 * `#2529` had to fix later for that table's `registerRef` (nothing ever wrote
 * it, because the id it is derived from isn't known until the insert
 * returns). POA&Ms start from that fix rather than repeating the gap: no
 * caller — MSP-console or Portal — invents this code itself.
 *
 * The row's own sequential `id` isn't known until the insert returns, so this
 * can't be set inline in `.values(...)`. `randomPlaceholder()` reserves a
 * globally-unique value for that single insert (never a fixed placeholder
 * like `""`, which would collide against `msp_poams_msp_id_poam_id_uidx` the
 * instant two POA&Ms are created for the same MSP concurrently), and
 * `assignPoamId` swaps it for the real code immediately after, guarded on
 * still matching that exact placeholder — safe to call unconditionally, and
 * a no-op if somehow called twice.
 */
export function randomPlaceholder(): string {
  return `__pending_${randomUUID()}`;
}

export function formatPoamId(id: number): string {
  return `POAM-2026-${String(id).padStart(3, "0")}`;
}

export async function assignPoamId(id: number, placeholder: string): Promise<string> {
  const poamId = formatPoamId(id);
  await db
    .update(mspPoamsTable)
    .set({ poamId })
    .where(and(eq(mspPoamsTable.id, id), eq(mspPoamsTable.poamId, placeholder)));
  return poamId;
}
