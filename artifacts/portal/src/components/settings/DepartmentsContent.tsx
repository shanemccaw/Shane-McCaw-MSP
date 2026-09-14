import { useState } from "react";
import { AlertTriangle, Building2, Info } from "lucide-react";

import { useDepartmentsLive } from "@/components/settingsDepartmentsLive";
import type { DeptRow } from "@/components/settingsDepartmentsWire";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const ACCENT = "#0078D4";
const RED = "#f87171";

type EditState = { row: DeptRow; groupId: string; groupName: string } | null;

/**
 * Settings → Departments (Git #1592/#4051, wired by #1736). Every department
 * your directory reports, plus any mapped to a security group instead —
 * headcount always comes from the directory attribute (route header,
 * settingsDepartmentsWire.ts) because there is no live Microsoft Graph
 * group-membership read yet (#4053, real and open). The "map to a group"
 * form below is a manual group id/name entry for exactly that reason — no
 * portal-facing group-browse endpoint exists to pick one from.
 */
export function DepartmentsContent() {
  const { departments, unmapped, loading, error, saving, mapToGroup, clearMapping } = useDepartmentsLive();
  const [edit, setEdit] = useState<EditState>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openEdit = (row: DeptRow) => {
    setFormError(null);
    setEdit({ row, groupId: row.src === "group" ? row.group : "", groupName: row.src === "group" ? row.group : "" });
  };

  const submitMapping = async () => {
    if (!edit) return;
    const groupId = edit.groupId.trim();
    const groupName = edit.groupName.trim();
    if (!groupId) {
      setFormError("A security group id is required.");
      return;
    }
    const err = await mapToGroup(edit.row.name, groupId, groupName || groupId);
    if (err) {
      setFormError(err);
      return;
    }
    setEdit(null);
  };

  const submitClear = async () => {
    if (!edit) return;
    const err = await clearMapping(edit.row.name);
    if (err) {
      setFormError(err);
      return;
    }
    setEdit(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-xl" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex gap-2.5 rounded-xl border border-dashed p-3.5" style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="departments-error">
        <AlertTriangle className="mt-0.5 size-[15px] flex-none" color={RED} strokeWidth={1.75} />
        <span className="text-[12px] text-muted-foreground">Could not read your departments. This is a failed read, not an empty list.</span>
      </div>
    );
  }

  return (
    <div className="flex max-w-[820px] flex-col gap-4" data-testid="departments-content">
      <div className="flex flex-col gap-1">
        <span className="text-xl font-bold tracking-tight text-foreground">Departments</span>
        <span className="text-[12.5px] text-[#64748b]">
          Every department your directory reports, plus any you've mapped to a security group instead.
          {unmapped !== "0" ? ` ${unmapped} users have no department set on their directory profile.` : ""}
        </span>
      </div>

      {departments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-9 text-center" style={{ borderColor: "rgba(148,163,184,.25)" }}>
          <Building2 className="size-5" color="#64748b" strokeWidth={1.5} />
          <span className="text-[13.5px] font-semibold text-foreground">No departments found</span>
          <span className="max-w-[460px] text-xs leading-relaxed text-muted-foreground">
            No user in your directory currently carries a department attribute.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {departments.map((d) => (
            <div key={d.name} className="flex items-center gap-[14px] rounded-xl px-4 py-[14px]" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}>
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-[13.5px] font-semibold text-[#f8fafc]">{d.name}</span>
                <span className="text-[11px] text-[#64748b]">
                  {d.src === "group" ? `Mapped to "${d.group}"` : "From the directory attribute"}
                </span>
              </div>
              <span className="ml-auto flex-none font-mono text-[12px] font-bold text-[#cbd5e1] tabular-nums">{d.n}</span>
              <span
                className="flex-none whitespace-nowrap rounded-full px-[10px] py-1 text-[10.5px] font-bold"
                style={{
                  letterSpacing: ".05em",
                  color: d.src === "group" ? "#00B4D8" : "#94a3b8",
                  border: `1px solid ${d.src === "group" ? "rgba(0,180,216,.35)" : "rgba(255,255,255,.14)"}`,
                  background: d.src === "group" ? "rgba(0,180,216,.08)" : "transparent",
                }}
              >
                {d.src === "group" ? "GROUP" : "ATTRIBUTE"}
              </span>
              <button
                type="button"
                onClick={() => openEdit(d)}
                className="flex-none rounded-md px-3 py-[6px] text-[11.5px] font-semibold"
                style={{ border: "1px solid rgba(255,255,255,.12)", color: "#94a3b8" }}
                data-testid={`department-edit-${d.name}`}
              >
                Edit mapping
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 border-t pt-[14px]" style={{ borderColor: "rgba(255,255,255,.06)" }}>
        <Info className="mt-[1px] size-[13px] flex-none" color="#64748b" strokeWidth={1.75} />
        <span className="text-[11.5px] leading-[1.5] text-[#64748b]">
          A group-mapped department's count still comes from the directory attribute — this platform has no live
          Microsoft Graph group-membership read yet, so a group mapping changes which source you're telling us to
          trust, not what's actually counted.
        </span>
      </div>

      {edit ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ background: "rgba(2,6,23,.72)" }} data-testid="department-mapping-modal">
          <div className="flex w-[460px] max-w-full flex-col gap-3" style={{ background: "#0b1120", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: 22, boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}>
            <span className="text-[14.5px] font-bold text-foreground">{edit.row.name}</span>
            <span className="text-[12px] leading-relaxed text-[#94a3b8]">
              {edit.row.src === "group" ? "Mapped to a security group" : "Reading from the directory attribute"}
            </span>

            {edit.row.src === "group" ? (
              <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <span className="text-[11.5px] text-[#cbd5e1]">Group: {edit.row.group}</span>
                <span className="text-[11px] leading-[1.5] text-[#64748b]">If unmapped, this falls back to the directory attribute.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#94a3b8]">Security group id</span>
                  <input
                    value={edit.groupId}
                    onChange={(e) => setEdit((s) => (s ? { ...s, groupId: e.target.value } : s))}
                    placeholder="e.g. the Entra ID group's object id"
                    className="rounded-md bg-transparent px-[10px] py-[7px] font-mono text-[12px] outline-none"
                    style={{ border: `1px solid ${HAIRLINE}`, color: "#e2e8f0" }}
                    data-testid="department-mapping-group-id"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#94a3b8]">Group name (optional)</span>
                  <input
                    value={edit.groupName}
                    onChange={(e) => setEdit((s) => (s ? { ...s, groupName: e.target.value } : s))}
                    placeholder="Finance-SG"
                    className="rounded-md bg-transparent px-[10px] py-[7px] text-[12px] outline-none"
                    style={{ border: `1px solid ${HAIRLINE}`, color: "#e2e8f0" }}
                  />
                </label>
                <span className="text-[10.5px] leading-relaxed text-[#475569]">
                  There is no live directory browse for security groups yet — enter the group's id (and, optionally,
                  a friendly name) directly.
                </span>
              </div>
            )}

            {formError ? <span className="text-[11.5px] text-[#f87171]">{formError}</span> : null}

            <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
              <button type="button" onClick={() => setEdit(null)} disabled={saving} className="rounded-md border px-3.5 py-2 text-xs font-semibold" style={{ borderColor: "rgba(255,255,255,.12)", color: "#94a3b8" }}>
                Cancel
              </button>
              {edit.row.src === "group" ? (
                <button type="button" onClick={() => void submitClear()} disabled={saving} className="ml-auto rounded-md px-3.5 py-2 text-xs font-semibold" style={{ color: RED, border: "1px solid rgba(248,113,113,.4)" }}>
                  {saving ? "Working…" : "Remove mapping"}
                </button>
              ) : (
                <button type="button" onClick={() => void submitMapping()} disabled={saving} className="ml-auto rounded-md px-3.5 py-2 text-xs font-semibold text-white" style={{ background: ACCENT }} data-testid="department-mapping-submit">
                  {saving ? "Working…" : "Map to this group"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
