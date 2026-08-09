/**
 * The CRM screen's right (Properties) panel — the selected Pipeline deal's
 * Stage/Amount editor. Mirrors the old admin panel's `ZohoDeals.tsx` inline
 * form (the same two queued endpoints), just reachable from the board
 * instead of a table row.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { LINE, SURFACE, TEXT } from "../../theme";
import { getSnapshot, selectDeal, subscribe, updateDealAmount, updateDealStage } from "./crmStore";
import { dealName, formatShortDate, zohoOwnerName } from "./zohoTypes";

const fieldStyle = {
  width: "100%",
  height: 30,
  marginTop: 4,
  padding: "0 9px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.root,
  color: TEXT.strong,
  fontFamily: "inherit",
  fontSize: 12.5,
  outline: "none",
} as const;

export function DealPropertiesPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const deal = state.deals.find((d) => String(d.id) === state.selectedDealId) ?? null;

  const [stage, setStage] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    setStage(typeof deal?.Stage === "string" ? deal.Stage : "");
    setAmount(deal?.Amount === null || deal?.Amount === undefined ? "" : String(deal.Amount));
    // Reset the drafts whenever the selected deal changes, not on every store tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedDealId]);

  if (!deal) {
    return (
      <div style={{ padding: 12, fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>
        Nothing selected. Click a deal card in Pipeline and its Stage/Amount editor lands here.
      </div>
    );
  }

  const id = String(deal.id ?? "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.bright }}>{dealName(deal)}</div>
        <div style={{ fontSize: 11.5, color: TEXT.meta, marginTop: 2 }}>
          {typeof deal.Account_Name === "object" && deal.Account_Name
            ? String((deal.Account_Name as { name?: unknown }).name ?? "")
            : String(deal.Account_Name ?? "No account")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11.5, color: TEXT.meta }}>
        <span>Owner: {zohoOwnerName(deal)}</span>
        <span>Closing: {formatShortDate(deal.Closing_Date)}</span>
      </div>

      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Stage</span>
        <input value={stage} onChange={(e) => setStage(e.target.value)} style={fieldStyle} placeholder="e.g. Qualification" />
      </label>
      <button
        disabled={!stage.trim() || !id}
        onClick={() => void updateDealStage(id, stage.trim())}
        style={{
          padding: "7px 12px",
          borderRadius: 5,
          border: `1px solid ${LINE.control}`,
          background: "transparent",
          color: TEXT.strong,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Queue stage change
      </button>

      <label>
        <span style={{ fontSize: 11, color: TEXT.groupLabel }}>Amount</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={fieldStyle}
        />
      </label>
      <button
        disabled={amount.trim() === "" || !Number.isFinite(Number(amount)) || !id}
        onClick={() => void updateDealAmount(id, Number(amount))}
        style={{
          padding: "7px 12px",
          borderRadius: 5,
          border: `1px solid ${LINE.control}`,
          background: "transparent",
          color: TEXT.strong,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Queue amount change
      </button>

      <div style={{ fontSize: 10.5, color: TEXT.faint, lineHeight: 1.5, borderTop: `1px solid ${LINE.quiet}`, paddingTop: 10 }}>
        Both apply on the next Zoho sync (~5 min), not instantly.
      </div>

      <button
        onClick={() => selectDeal(null)}
        style={{ alignSelf: "flex-start", background: "transparent", border: 0, color: TEXT.meta, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}
      >
        Deselect
      </button>
    </div>
  );
}
