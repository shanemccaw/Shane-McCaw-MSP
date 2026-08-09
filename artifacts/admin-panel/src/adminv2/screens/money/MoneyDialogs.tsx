/**
 * Money screen's own overlays — "Set your goals" and "Log a sale".
 *
 * `SHELL.md`'s "Known gaps" notes the generic modal from the design
 * (`Admin Shell.dc.html`) isn't a shell primitive yet: "are in Admin Shell.dc.html
 * if and when a screen needs one." This screen needs two, so they're built
 * here, screen-owned, rather than waiting on a shell-level modal that
 * doesn't exist. Small and single-purpose on purpose — neither pretends to
 * be a general dialog system.
 */

import { useEffect, useState } from "react";
import { LINE, SCRIM, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import type { MoneyStoreState } from "./moneyStore";
import { closeGoalsDialog, closeLogSaleDialog, logSale, saveGoals } from "./moneyStore";
import { usd } from "./moneyTypes";

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: SCRIM,
        zIndex: Z.peekBackdrop,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: "calc(100vw - 40px)",
          borderRadius: 10,
          border: `1px solid ${LINE.strong}`,
          background: SURFACE.overlay,
          boxShadow: SHADOW.overlay,
          zIndex: Z.peek,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 18,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 30,
    padding: "0 10px",
    borderRadius: 5,
    border: `1px solid ${LINE.control}`,
    background: SURFACE.well,
    color: TEXT.primary,
    fontFamily: "inherit",
    fontSize: 13,
  };
}

// ── Set your goals ───────────────────────────────────────────────────────────

export function GoalsDialog({ state }: { state: MoneyStoreState }) {
  const s = state.summary;
  const [goalSales, setGoalSalesInput] = useState(String(s?.sales.goal ?? 3));
  const [mrrGoal, setMrrGoalInput] = useState(String(Math.round((s?.mrr.goalCents ?? 600000) / 100)));

  useEffect(() => {
    if (s) {
      setGoalSalesInput(String(s.sales.goal));
      setMrrGoalInput(String(Math.round(s.mrr.goalCents / 100)));
    }
    // Only re-sync from a fresh fetch, not on every keystroke — see the debounce below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.sales.goal, s?.mrr.goalCents]);

  useEffect(() => {
    const n = Math.max(1, parseInt(goalSales.replace(/[^0-9]/g, ""), 10) || 1);
    const t = setTimeout(() => void saveGoals({ goalSales: n }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalSales]);

  useEffect(() => {
    const n = Math.max(0, parseInt(mrrGoal.replace(/[^0-9]/g, ""), 10) || 0);
    const t = setTimeout(() => void saveGoals({ mrrGoalCents: n * 100 }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrrGoal]);

  const upcoming = (state.ramp?.rows ?? []).slice(1, 4);

  return (
    <Backdrop onClose={closeGoalsDialog}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.bright }}>What you're chasing</div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: TEXT.meta, lineHeight: 1.5 }}>
          Sales target for {s?.month ?? "this month"}, and the recurring revenue you want underneath it. The ramp steps up from here.
        </div>
      </div>

      {upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11.5, color: TEXT.caption }}>
          {upcoming.map((r) => (
            <span key={r.month}>− {r.label} · {r.target} sales</span>
          ))}
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Sales this month</span>
        <input value={goalSales} onChange={(e) => setGoalSalesInput(e.target.value)} inputMode="numeric" style={fieldStyle()} />
        <span style={{ fontSize: 11, color: TEXT.faint }}>Hit it and the streak grows to {(s?.streak ?? 0) + 1}.</span>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Recurring revenue target</span>
        <input value={mrrGoal} onChange={(e) => setMrrGoalInput(e.target.value)} inputMode="numeric" style={fieldStyle()} />
        <span style={{ fontSize: 11, color: TEXT.faint }}>
          Currently {usd(s?.mrr.cents ?? 0)} from {s?.retainers.length ?? 0} retainers.
        </span>
      </label>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: TEXT.faint }}>{state.goalsSaving ? "Saving…" : "Applies as you type"}</span>
        <button
          onClick={closeGoalsDialog}
          style={{
            padding: "6px 14px",
            borderRadius: 5,
            border: 0,
            background: "#0f6cbd",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>
    </Backdrop>
  );
}

// ── Log a sale ───────────────────────────────────────────────────────────────

export function LogSaleDialog({ state }: { state: MoneyStoreState }) {
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");

  const amountCents = Math.round((parseFloat(amount.replace(/[^0-9.]/g, "")) || 0) * 100);
  const canSubmit = who.trim().length > 0 && what.trim().length > 0 && amountCents > 0 && !state.logSaleSubmitting;

  function submit() {
    if (!canSubmit) return;
    void logSale(who.trim(), what.trim(), amountCents);
  }

  return (
    <Backdrop onClose={closeLogSaleDialog}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.bright }}>Log a sale</div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: TEXT.meta, lineHeight: 1.5 }}>
          For a real sale that did not go through Stripe/SOW — a cash deal, a referral fee, anything off-platform. It merges
          straight into this month's revenue, the sales log and the streak, same as a real charge.
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Who</span>
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Client or company name" style={fieldStyle()} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>What</span>
        <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What it was for" style={fieldStyle()} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Amount</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0" inputMode="decimal" style={fieldStyle()} />
      </label>

      {state.logSaleError && <span style={{ fontSize: 11.5, color: "#eda3a3" }}>{state.logSaleError}</span>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <button
          onClick={closeLogSaleDialog}
          style={{
            padding: "6px 14px",
            borderRadius: 5,
            border: `1px solid ${LINE.strong}`,
            background: "transparent",
            color: TEXT.soft,
            fontFamily: "inherit",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            padding: "6px 14px",
            borderRadius: 5,
            border: 0,
            background: canSubmit ? "#6ccb96" : SURFACE.well,
            color: canSubmit ? "#10250f" : TEXT.faint,
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          {state.logSaleSubmitting ? "Logging…" : "Log the sale"}
        </button>
      </div>
    </Backdrop>
  );
}

// ── Celebration ───────────────────────────────────────────────────────────────

export function SaleCelebration({ state }: { state: MoneyStoreState }) {
  if (!state.celebrateSale) return null;
  const { who, what, amountCents } = state.celebrateSale;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Z.peek,
        padding: "12px 20px",
        borderRadius: 10,
        border: "1px solid rgba(108,203,150,.4)",
        background: "#1c2b21",
        boxShadow: SHADOW.overlay,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <span style={{ fontSize: 22, fontWeight: 800, color: "#92d8ae" }}>{usd(amountCents)}</span>
      <span style={{ fontSize: 12, color: "#c6e6d3" }}>
        Logged from {who} — {what}
      </span>
    </div>
  );
}
