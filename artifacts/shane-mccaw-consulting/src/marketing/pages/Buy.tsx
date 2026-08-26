import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  money,
  MON_TIERS,
  RET_TIERS,
  PACKS,
  PACKS_BY_KEY,
  DRY_ACTIONS,
  PRE_SCAN,
  READ_SCOPES,
  WRITE_SCOPES,
  SOP_WRITE_SCOPES,
  monthly,
  bracketFor,
  type BracketKey,
  type DryAction,
  type Impact,
} from "../data/buyCheckout";
import { useQuickStartPackAvailability } from "../../hooks/useQuickStartPackAvailability";
import { useServices, type PublicService } from "../../hooks/useServices";
import { useBuyPackLive, liveStepOutcome } from "../../hooks/useBuyPackLive";
import { StripePaymentElement } from "../../components/StripePaymentElement";
import { logger } from "../../lib/logger";

const log = logger.child({ channel: "billing" });

// ── Real-catalog slug resolution (Git #1308) ────────────────────────────────
// Buy.tsx prices from its own local fixture (buyCheckout.ts), keyed by short
// `key`s (e.g. "growth", "advisory", "entra") that mirror but do not equal the
// real `services.slug` the payment endpoints (#1307) require. These resolve a
// selection to its real catalog row via the same live `services` read
// useQuickStartPackAvailability already trusts for pack availability.
const BRACKET_TENANT_TIER_LABEL: Record<BracketKey, string> = {
  micro: "Micro",
  smb: "SMB",
  mid: "Mid-Market",
  ent: "Enterprise",
};

function resolveMonitoringSlug(
  services: PublicService[],
  tierKey: string,
  seatCount: number,
): string | null {
  const tenantTierLabel = BRACKET_TENANT_TIER_LABEL[bracketFor(seatCount).key];
  const packageKey = `core:${tierKey}`;
  const match = services.find((s) => {
    const ta = s.typeAttributes as { packageKey?: string; tenantTierLabel?: string } | null;
    return s.serviceType === "monitoring_tier" && ta?.packageKey === packageKey && ta?.tenantTierLabel === tenantTierLabel;
  });
  return match?.slug ?? null;
}

function resolveRetainerSlug(services: PublicService[], tierName: string): string | null {
  const match = services.find((s) => s.category === "retainer" && s.name === `Architect ${tierName} Retainer`);
  return match?.slug ?? null;
}

function resolvePackSlug(services: PublicService[], packName: string): string | null {
  const match = services.find((s) => s.name === packName);
  return match?.slug ?? null;
}

// Route /buy — recreated from Design/design_handoff_marketing/Marketing Buy.dc.html.
//
// The one checkout for all three products. Product comes from ?product=monitoring|retainer|pack;
// ?tier= preselects, ?seats= carries a seat estimate, ?packs=k1,k2 a multi-pack basket, ?scanned=1
// means the visitor already granted read-only access during a free scan. Every price/tier/pack
// figure lives in the data layer (marketing/data/buyCheckout.ts), never inline here.
//
// This page owns its own chrome (a minimal logo + step-rail header, no site Nav/Footer) — the same
// approach FreeScan.tsx takes — because it is a focused conversion funnel, not a browsable page.
//
// SIMULATED, per the README "Out of scope": Stripe payment, the scans, the Graph write-back
// (dry-run before/after values and the execution engine are authored data), account creation/MFA.
// The realistic-looking flow is built truthfully; the real write path is separate, later work.

type Product = "monitoring" | "retainer" | "pack";
type Stage =
  | "buy"
  | "connecting"
  | "paying"
  | "code"
  | "verifying"
  | "password"
  | "mfa"
  | "logging"
  | "write"
  | "granting"
  | "prescan"
  | "dryrun"
  | "executing"
  | "executed"
  | "done";
type DryScan = "idle" | "scanning" | "done";
type DryWindow = "now" | "tonight" | "window";
type MfaMethod = "app" | "rsa";

interface State {
  product: Product;
  choice: string | null;
  packSel: Record<string, boolean>;
  seatsFromCatalog: number | null;
  connected: boolean;
  scannedParam: boolean; // arrived from a free scan (?scanned=1)
  scanSkipped: boolean;
  agreed: boolean;
  dryOff: Record<string, boolean>;
  dryScan: DryScan;
  dryScanAt: string;
  dryWindow: DryWindow;
  execStep: number;
  preScanStep: number;
  seatInput: string;
  seatEdited: boolean;
  stage: Stage;
  email: string;
  fullName: string;
  company: string;
  sessionId: string | null;
  intent: { clientSecret: string; publishableKey: string } | null;
  creatingIntent: boolean;
  payingError: string | null;
  codeInput: string;
  pw1: string;
  pw2: string;
  mfaMethod: MfaMethod;
  mfaCode: string;
  phone: string;
  writeGranted: boolean;
  writeDeclined: boolean;
}

const REAL_SEATS = 1240; // what the tenant reports once connected
const CR_ID = "CR-QS-2026-0184";
const ROLLBACK_LONG = "20 September 2026";
const ROLLBACK_SHORT = "20 Sep 2026";

function qs(k: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(k);
  } catch {
    return null;
  }
}

function initialState(): State {
  const rawProduct = qs("product");
  const product: Product =
    rawProduct === "retainer" || rawProduct === "pack" ? rawProduct : "monitoring";
  const packList = (qs("packs") || qs("tier") || "").split(",").filter(Boolean);
  const packSel: Record<string, boolean> = {};
  packList.forEach((k) => {
    packSel[k] = true;
  });
  const seatNum = parseInt(qs("seats") || "", 10);
  const seatsFromCatalog = isNaN(seatNum) ? null : Math.max(1, seatNum);
  const scannedParam = qs("scanned") === "1";
  return {
    product,
    choice: qs("tier"),
    packSel,
    seatsFromCatalog,
    connected: scannedParam,
    scannedParam,
    scanSkipped: false,
    agreed: false,
    dryOff: {},
    dryScan: "idle",
    dryScanAt: "4 minutes ago",
    dryWindow: "now",
    execStep: 0,
    preScanStep: 0,
    seatInput: qs("seats") || "",
    seatEdited: false,
    stage: "buy",
    email: "",
    fullName: "",
    company: "",
    sessionId: null,
    intent: null,
    creatingIntent: false,
    payingError: null,
    codeInput: "",
    pw1: "",
    pw2: "",
    mfaMethod: "app",
    mfaCode: "",
    phone: "",
    writeGranted: false,
    writeDeclined: false,
  };
}

// A small icon shell mirroring the design's ic() (24×24, currentColor, stroke 2).
function Icon({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
const IconLock = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <rect x={4} y={11} width={16} height={10} rx={2} />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Icon>
);
const IconKey = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx={7.5} cy={15.5} r={4.5} />
    <path d="M10.9 12.1L20 3" />
    <path d="M17 6l3 3" />
  </Icon>
);
const IconCheck = ({ size = 13 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 13l4 4L19 7" />
  </Icon>
);
const IconArrow = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}>
    <line x1={4} y1={12} x2={20} y2={12} />
    <polyline points="14 6 20 12 14 18" />
  </Icon>
);

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(2,6,23,.7)",
  border: "1px solid rgba(51,65,85,.9)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "13px",
  color: "#f1f5f9",
  outline: "none",
  fontFamily: "inherit",
};

// An input that lights its border on focus (the design's style-focus border-color:#3b82f6).
function FocusInput({
  style,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [f, setF] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => {
        setF(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setF(false);
        rest.onBlur?.(e);
      }}
      style={{ ...style, ...(f ? { borderColor: "#3b82f6" } : {}) }}
    />
  );
}

const IMPACT_TONE: Record<Impact, [string, string]> = {
  safe: ["#34d399", "No user impact"],
  notice: ["#fbbf24", "Users will notice"],
  disruptive: ["#f87171", "Blocks something today"],
};

type LiveAction = DryAction & { pack: string; packName: string; satisfied: boolean };

export default function Buy() {
  const [st, setSt] = useState<State>(initialState);
  const { availableKeys: availablePackKeys, loading: catalogLoading } = useQuickStartPackAvailability();
  const { services: catalogServices } = useServices();
  const timers = useRef<number[]>([]);
  const push = (id: number) => {
    timers.current.push(id);
  };
  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const set = (
    patch: Partial<State> | ((s: State) => Partial<State>),
  ) =>
    setSt((s) => ({
      ...s,
      ...(typeof patch === "function" ? patch(s) : patch),
    }));

  const isMon = st.product === "monitoring";
  const isRet = st.product === "retainer";
  const isPack = st.product === "pack";

  // Git #1316: a REAL checkout session id (the stage machine's own st.sessionId
  // minted by #1308's real payment wiring, else ?session= or the flow's storage
  // slot) switches the pack dry-run/execute stages from the authored demo
  // fixture to live tenant data + real engine execution. Without one the page
  // keeps its simulated demo behavior unchanged.
  const live = useBuyPackLive(isPack, st.sessionId);
  const liveMode = isPack && !!live.sessionId;

  // The real run drives the executing → executed transition; an execution that
  // refused to start falls back to the dry-run screen with its error shown.
  useEffect(() => {
    if (!liveMode || st.stage !== "executing") return;
    if (
      live.run.phase === "completed" ||
      live.run.phase === "awaiting_verification" ||
      live.run.phase === "failed"
    ) {
      set({ stage: "executed", execStep: live.run.completed });
    } else if (live.run.phase === "error") {
      set({ stage: "dryrun" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, st.stage, live.run.phase, live.run.completed]);

  // A pack pre-selected via the URL (?tier=/?packs=) may not have a real services-table
  // backing yet (Git #1304) -- drop it from the selection once the live catalogue read
  // resolves, same gate the option rows below enforce on click.
  useEffect(() => {
    if (!isPack || catalogLoading) return;
    set((s) => {
      const filtered = Object.fromEntries(
        Object.entries(s.packSel).filter(([k]) => availablePackKeys.has(k)),
      );
      return Object.keys(filtered).length === Object.keys(s.packSel).length
        ? {}
        : { packSel: filtered };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPack, catalogLoading]);

  // ── Derived model (ported from the design's helpers) ──────────────────────────
  const monSel = MON_TIERS.find((t) => t.key === st.choice) || MON_TIERS[1];
  const retSel = RET_TIERS.find((t) => t.key === st.choice) || RET_TIERS[0];

  const seatsTyped = parseInt(String(st.seatInput).replace(/\D/g, ""), 10);
  const seatsFn =
    !isNaN(seatsTyped) && seatsTyped > 0
      ? seatsTyped
      : st.seatsFromCatalog || 250;
  const seats = st.connected ? REAL_SEATS : seatsFn;

  const connectRequired = isMon;
  const connectOffered = isRet && !st.connected && !st.scanSkipped;

  const packKeys = (() => {
    const ks = Object.keys(st.packSel).filter((k) =>
      PACKS.some((p) => p.key === k),
    );
    return ks.length ? ks : [PACKS[0].key];
  })();
  const packTotal = packKeys.reduce(
    (a, k) => a + (PACKS_BY_KEY[k]?.price ?? 0),
    0,
  );

  const price = isMon
    ? monthly(monSel, seats)
    : isPack
      ? packTotal
      : retSel.price;
  const selName = isMon ? monSel.name : isRet ? retSel.name : "";

  const connectBlocked = connectRequired && !st.connected;
  const hasUnavailablePack =
    isPack && !catalogLoading && packKeys.some((k) => !availablePackKeys.has(k));
  // catalogLoading is included here (not just hasUnavailablePack's pack-only
  // check) because submit() resolves a real services-table slug for ALL three
  // product types (#1308) -- clicking Pay before that live catalog read lands
  // would otherwise resolve no slug and surface a confusing error.
  const blocked = connectBlocked || !st.agreed || hasUnavailablePack || catalogLoading;

  const pwOk =
    st.pw1.length >= 12 &&
    /[A-Z]/.test(st.pw1) &&
    /[0-9]/.test(st.pw1) &&
    st.pw1 === st.pw2;
  const mfaOk =
    st.mfaMethod === "app"
      ? st.mfaCode.length === 6
      : st.phone.replace(/\s/g, "").length >= 6;

  const liveActions = (): LiveAction[] => {
    if (liveMode) return live.actions;
    const scanned = st.dryScan === "done";
    return packKeys.reduce<LiveAction[]>(
      (acc, k) =>
        acc.concat(
          (DRY_ACTIONS[k] || []).map((a) => ({
            ...a,
            pack: k,
            packName: PACKS_BY_KEY[k]?.name ?? "",
            satisfied: scanned && !!a.mayBeSatisfied,
          })),
        ),
      [],
    );
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const pick = (key: string) => {
    if (!isPack) {
      set({ choice: key });
      return;
    }
    set((s) => {
      const sel = { ...s.packSel };
      if (sel[key]) {
        if (Object.keys(sel).length === 1) return {};
        delete sel[key];
      } else {
        sel[key] = true;
      }
      return { packSel: sel };
    });
  };
  const toggleAgree = () => set((s) => ({ agreed: !s.agreed }));
  const onSeats = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ seatInput: e.target.value, seatEdited: true });
  const doConnect = () => {
    set({ stage: "connecting" });
    push(
      window.setTimeout(
        () => set({ connected: true, scanSkipped: false, stage: "buy" }),
        1400,
      ),
    );
  };
  const skipConnect = () => set({ scanSkipped: true });
  const reconnect = () => set({ connected: false, scanSkipped: false });

  // Real Stripe confirm callback (#1307's payment-confirmed), shared by the
  // StripePaymentElement's onSuccess and the alreadyPaid recovery path below.
  // Throws on failure -- the element's own contract shows a thrown message in
  // its panel error slot exactly like AssessmentFlow's PaymentStep does.
  const confirmPayment = async (paymentIntentId: string, sessionIdOverride?: string) => {
    const sessionId = sessionIdOverride ?? st.sessionId;
    if (!sessionId) throw new Error("Missing checkout session. Please start again.");
    const res = await fetch("/api/public/purchase/payment-confirmed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, paymentIntentId }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      log.error({ err, sessionId, paymentIntentId }, "purchase payment-confirmed failed");
      throw new Error(
        err.error === "payment_not_succeeded"
          ? "Your bank has not confirmed the payment yet. Please wait a moment and try again."
          : "We took the payment but could not record it. Please contact us before paying again.",
      );
    }
    log.info({ sessionId, paymentIntentId }, "purchase payment confirmed");
    set({ stage: "code" });
  };

  // Real checkout: mint a server-side session (#1307's payment-intent needs
  // one to exist), then a real Stripe PaymentIntent priced from it. Buy.tsx's
  // own selection state (product/tier/seats/packKeys) resolves to the real
  // catalog slug the session is created against -- see resolve*Slug above.
  const submit = async () => {
    if (st.stage !== "buy") return;
    if (connectRequired && !st.connected) return;
    if (!st.agreed) return;
    if (hasUnavailablePack) return;
    if (catalogLoading) return;

    const productSlug = isMon
      ? resolveMonitoringSlug(catalogServices, monSel.key, seats)
      : isRet
        ? resolveRetainerSlug(catalogServices, retSel.name)
        : resolvePackSlug(catalogServices, PACKS_BY_KEY[packKeys[0]]?.name ?? "");

    if (!productSlug) {
      set({ payingError: "This option isn't available to purchase right now. Please choose another." });
      return;
    }

    set({ stage: "paying", creatingIntent: true, payingError: null, intent: null });

    try {
      const sessionRes = await fetch("/api/public/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug,
          fullName: st.fullName.trim(),
          email: st.email.trim(),
          company: st.company.trim(),
          industry: "Not specified",
          seats,
        }),
      });
      const sessionData = (await sessionRes.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
        portalUrl?: string;
      };
      if (!sessionRes.ok || !sessionData.sessionId) {
        log.warn({ status: sessionRes.status, error: sessionData.error }, "purchase checkout session creation failed");
        throw new Error(
          sessionData.error === "already_has_account"
            ? "An account already exists for this email. Sign in to the Portal to buy from there."
            : "Could not start checkout. Please check your details and try again.",
        );
      }
      const sessionId = sessionData.sessionId;

      // Retainer read consent is the one product this flow may lawfully skip
      // without a tenant connection (#1311). Monitoring and Packs require it,
      // and the connect step above stays exactly as simulated as it is today
      // (out of scope here per #1308), so those two are refused server-side
      // (consent_required) below until a later phase wires that step for real.
      if (isRet) {
        await fetch("/api/public/flow/read-consent-skip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }).catch((err) => log.warn({ err, sessionId }, "read-consent-skip call failed"));
      }

      const packSlugs = isPack
        ? packKeys
            .slice(1)
            .map((k) => resolvePackSlug(catalogServices, PACKS_BY_KEY[k]?.name ?? ""))
            .filter((s): s is string => !!s)
        : undefined;

      const intentRes = await fetch("/api/public/purchase/payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...(packSlugs?.length ? { packSlugs } : {}) }),
      });
      const intentData = (await intentRes.json().catch(() => ({}))) as {
        clientSecret?: string;
        publishableKey?: string;
        paymentIntentId?: string;
        alreadyPaid?: boolean;
        error?: string;
        message?: string;
      };
      if (!intentRes.ok || !intentData.clientSecret || !intentData.publishableKey) {
        log.warn({ status: intentRes.status, error: intentData.error, sessionId }, "purchase payment-intent failed");
        throw new Error(
          intentData.error === "consent_required"
            ? "This purchase needs your tenant connected first. Grant read-only access above, then try again."
            : intentData.error === "seat_band_mismatch"
              ? intentData.message || "Your seat count doesn't match this tier."
              : "Could not start payment. Please try again.",
        );
      }

      set({ sessionId, creatingIntent: false, intent: { clientSecret: intentData.clientSecret, publishableKey: intentData.publishableKey } });

      // A recovered, already-succeeded intent (rare here -- a fresh session
      // every submit -- but the same idempotent-recovery contract #1307 gives
      // every caller) finishes the flow rather than showing a second card form.
      if (intentData.alreadyPaid && intentData.paymentIntentId) {
        await confirmPayment(intentData.paymentIntentId, sessionId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong starting payment.";
      log.error({ err: message }, "purchase paying stage failed");
      set({ stage: "buy", creatingIntent: false, intent: null, payingError: message });
    }
  };
  const onEmail = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ email: e.target.value });
  const onFullName = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ fullName: e.target.value });
  const onCompany = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ company: e.target.value });
  const onCode = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ codeInput: e.target.value.replace(/\D/g, "").slice(0, 6) });
  const resend = () => set({ codeInput: "" });
  const verifyCode = () => {
    if (st.codeInput.length !== 6) return;
    set({ stage: "verifying" });
    push(window.setTimeout(() => set({ stage: "password" }), 1100));
  };
  const onPw1 = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ pw1: e.target.value });
  const onPw2 = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ pw2: e.target.value });
  const savePw = () => {
    if (pwOk) set({ stage: "mfa" });
  };
  const onMfaCode = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ mfaCode: e.target.value.replace(/\D/g, "").slice(0, 6) });
  const onPhone = (e: React.ChangeEvent<HTMLInputElement>) =>
    set({ phone: e.target.value.toUpperCase() });
  const pickMfa = (m: MfaMethod) => set({ mfaMethod: m });
  const finishAccount = () => {
    if (!mfaOk) return;
    set({ stage: "logging" });
    push(window.setTimeout(() => set({ stage: "write" }), 1500));
  };
  const declineWrite = () => set({ writeDeclined: true, stage: "done" });
  const runPreScan = () => {
    if (liveMode) {
      // Real mode: the pre-scan IS the live dry-run read. The step captions
      // animate while the actual tenant read runs; landing on the dry-run
      // screen with dryScan "idle" (plus the error banner there) is the
      // fail-closed outcome — zero actions, execute disabled.
      set({ preScanStep: 0, dryScan: "scanning" });
      let m = 0;
      const advance = () => {
        push(
          window.setTimeout(() => {
            m = Math.min(m + 1, PRE_SCAN.length - 1);
            set({ preScanStep: m });
            if (m < PRE_SCAN.length - 1) advance();
          }, 480),
        );
      };
      advance();
      void live.fetchDryRun().then((ok) => {
        set({
          stage: "dryrun",
          dryScan: ok ? "done" : "idle",
          dryScanAt: "just now",
          preScanStep: PRE_SCAN.length,
        });
      });
      return;
    }
    set({ preScanStep: 0 });
    let n = 0;
    const step = () => {
      push(
        window.setTimeout(() => {
          n += 1;
          if (n >= PRE_SCAN.length)
            set({
              stage: "dryrun",
              dryScan: "done",
              dryScanAt: "just now",
              preScanStep: PRE_SCAN.length,
            });
          else {
            set({ preScanStep: n });
            step();
          }
        }, 480),
      );
    };
    step();
  };
  const grantWrite = () => {
    set({ stage: "granting" });
    push(
      window.setTimeout(
        () =>
          set({
            writeGranted: true,
            stage: st.product === "pack" ? "prescan" : "done",
          }),
        1400,
      ),
    );
    if (st.product === "pack") push(window.setTimeout(runPreScan, 1500));
  };
  const toggleAction = (id: string) => {
    // A REAL pack executes as one dependency-ordered unit — per-action opt-out
    // only exists in the demo fixture (Git #1316).
    if (liveMode) return;
    set((s) => {
      const off = { ...s.dryOff };
      if (off[id]) delete off[id];
      else off[id] = true;
      return { dryOff: off };
    });
  };
  const rescan = () => {
    if (liveMode) {
      set({ dryScan: "scanning" });
      void live
        .fetchDryRun()
        .then((ok) => set({ dryScan: ok ? "done" : "idle", dryScanAt: "just now" }));
      return;
    }
    set({ dryScan: "scanning" });
    push(
      window.setTimeout(
        () => set({ dryScan: "done", dryScanAt: "just now" }),
        1800,
      ),
    );
  };
  const setWindow = (w: DryWindow) => set({ dryWindow: w });
  const execute = () => {
    if (liveMode) {
      // REAL execution: fires the purchased packs through the actual workflow
      // engine; the run-status poll (useBuyPackLive) drives progress and the
      // executed transition (see the stage effect above).
      set({ stage: "executing", execStep: 0 });
      void live.startExecution();
      return;
    }
    const chosenNow = liveActions().filter(
      (a) => !st.dryOff[a.id] && !a.satisfied,
    ).length;
    set({ stage: "executing", execStep: 0 });
    let n = 0;
    const tick = () => {
      push(
        window.setTimeout(() => {
          n += 1;
          if (n >= chosenNow) set({ stage: "executed", execStep: chosenNow });
          else {
            set({ execStep: n });
            tick();
          }
        }, 420),
      );
    };
    tick();
  };

  // ── Step rail ─────────────────────────────────────────────────────────────────
  const stepLabels = isMon
    ? ["Connect", "Tier", "Pay", "Create account", "Portal"]
    : isPack
      ? ["Pack", "Pay", "Create account", "Write access", "Scan", "Approve", "Record"]
      : ["Tier", "Pay", "Create account", "Portal"];
  const acctIdx = isMon ? 3 : 2;
  const packStageIdx: Record<string, number> = {
    buy: 0,
    connecting: 0,
    paying: 1,
    code: 2,
    verifying: 2,
    password: 2,
    mfa: 2,
    logging: 2,
    write: 3,
    granting: 3,
    prescan: 4,
    dryrun: 5,
    executing: 5,
    executed: 6,
    done: 6,
  };
  const accountStages: Stage[] = ["code", "verifying", "password", "mfa", "logging"];
  const at = isPack
    ? packStageIdx[st.stage] ?? 0
    : st.stage === "done"
      ? stepLabels.length - 1
      : st.stage === "write" || st.stage === "granting"
        ? acctIdx + 1
        : accountStages.includes(st.stage)
          ? acctIdx
          : isMon
            ? st.connected
              ? 2
              : 0
            : 1;

  // ── show flags ──────────────────────────────────────────────────────────────
  const show = {
    buying: st.stage === "buy" || st.stage === "connecting" || st.stage === "paying",
    account: accountStages.includes(st.stage),
    writeConsent: st.stage === "write" || st.stage === "granting",
    done: st.stage === "done",
    // "paying" is deliberately excluded: the buyer interacts with the real
    // Stripe Payment Element during that stage (#1308), so it must never be
    // covered by this full-screen overlay the way the other async waits are.
    processing: (["connecting", "granting", "verifying", "logging"] as Stage[]).includes(
      st.stage,
    ),
    connect: (connectRequired && !st.connected) || connectOffered,
    connected: st.connected,
    preScan: st.stage === "prescan",
    dryRun: st.stage === "dryrun",
    executing: st.stage === "executing",
    executed: st.stage === "executed",
    estimate: isMon && !st.connected,
    pay: !connectBlocked,
  };

  const reduceMotion =
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const spinAnim = reduceMotion ? "none" : "buySpin 900ms linear infinite";
  const processingLabel =
    st.stage === "connecting"
      ? "Waiting for Microsoft consent"
      : st.stage === "granting"
        ? "Registering write access"
        : st.stage === "verifying"
          ? "Checking your code"
          : st.stage === "logging"
            ? "Signing you in"
            : "Confirming with Stripe";

  const head = isMon
    ? {
        eyebrow: "Tenant monitoring",
        title: "Connect first, then buy the tier that fits.",
        body: "Monitoring is priced per seat from your real tenant, so the connection comes before the card. Nothing is charged until you see the actual number.",
      }
    : isRet
      ? {
          eyebrow: "Architect retainer",
          title: "Pick your hours. Start this month.",
          body: "A retainer needs no access to your tenant to begin — pay and your architect is booked. You can connect a read-only scan as well, so the first conversation starts from what is actually in there.",
        }
      : {
          eyebrow: "Quick-Start Pack",
          title: "Buy the pack. Approve the changes before any of them run.",
          body: "One fixed-price set of configuration changes, applied through the Graph write-back engine. After payment you grant write access, preview every change, and deselect anything you don’t want.",
        };

  const optionRows = isMon
    ? MON_TIERS.map((o) => ({
        key: o.key,
        name: o.name,
        desc: o.desc,
        priceLabel: money(monthly(o, seats)),
        unit: "/mo",
        on: o.key === monSel.key,
        available: true,
      }))
    : isRet
      ? RET_TIERS.map((o) => ({
          key: o.key,
          name: o.name,
          desc: o.desc,
          priceLabel: money(o.price),
          unit: "/mo",
          on: o.key === retSel.key,
          available: true,
        }))
      : PACKS.map((o) => ({
          key: o.key,
          name: o.name,
          desc: o.desc,
          priceLabel: money(o.price),
          unit: "one-time",
          on: !!st.packSel[o.key],
          available: catalogLoading || availablePackKeys.has(o.key),
        }));

  const cameFromScan = st.scannedParam && !st.scanSkipped;
  const connectCard = connectOffered
    ? {
        title: "Connect your tenant for a scan (optional)",
        optional: true,
        body: "Your architect can start from real findings instead of a discovery call. It changes nothing about the price, and you can skip it and connect later from the Portal.",
        foot: "Skipping is fine — the retainer runs either way.",
      }
    : {
        title: st.seatsFromCatalog
          ? "One thing left: confirm the seat count from your tenant"
          : "Connect your tenant, read-only",
        optional: false,
        body:
          (st.seatsFromCatalog
            ? "You have already picked " +
              monSel.name +
              " at " +
              st.seatsFromCatalog.toLocaleString("en-US") +
              " seats. Billing runs on the seat count your tenant reports, not the one you typed, so the connection is what turns your estimate into the real figure. "
            : "Monitoring is priced per seat, so the real number comes from your tenant rather than a form. ") +
          "You approve a scoped, read-only connection in Microsoft’s own consent screen — nothing is charged at this step.",
        foot: "Revocable from your tenant at any time.",
      };

  const connectedCard = cameFromScan
    ? {
        title: "Reusing the connection from your free scan",
        body:
          "You granted read-only access on 12 August. " +
          (isMon
            ? "Your tenant reports " +
              REAL_SEATS.toLocaleString("en-US") +
              " licensed seats, and that is what you will be billed on."
            : "Your architect will have your findings on day one."),
      }
    : {
        title: "Tenant connected, read-only",
        body: isMon
          ? "Your tenant reports " +
            REAL_SEATS.toLocaleString("en-US") +
            " licensed seats, and that is what you will be billed on."
          : "A read-only scan will run before your first session.",
      };

  const est = (() => {
    if (!isMon) return null;
    const n = seatsFn;
    const carried = !!st.seatsFromCatalog && !st.seatEdited;
    return {
      price: money(monthly(monSel, n)) + "/mo",
      basis:
        (carried ? "your " : "estimate for ") +
        n.toLocaleString("en-US") +
        " seats on " +
        monSel.name,
      eyebrow: carried
        ? "Carried over from the pricing catalogue"
        : "Indicative price, while you decide",
      eyebrowFg: carried ? "#60a5fa" : "#64748b",
      label: carried
        ? "Licensed users, as you set them"
        : "Roughly how many licensed users?",
      foot: carried
        ? "This is the seat count and tier you picked on the pricing page. Change it here if it was a guess — either way you are billed on what your tenant reports, and you see that figure before you pay."
        : "An estimate from the number you typed. You are billed on whatever your tenant actually reports, and you see that figure before you pay.",
    };
  })();

  const summary = {
    label: isPack
      ? packKeys.length > 1
        ? "Charged once · " + packKeys.length + " packs"
        : "Charged once"
      : "Charged monthly",
    total: money(price) + (isPack ? "" : "/mo"),
    sub: isMon
      ? monSel.name +
        " · " +
        seats.toLocaleString("en-US") +
        (st.connected ? " seats, read from your tenant" : " seats, your estimate")
      : isPack
        ? packKeys.length > 1
          ? packKeys.length + " packs, one dry run"
          : PACKS_BY_KEY[packKeys[0]]?.name ?? ""
        : selName,
    lines: isMon
      ? [
          { label: "Tier", value: monSel.name, fg: "#f8fafc" },
          {
            label: "Seats",
            value: seats.toLocaleString("en-US"),
            fg: st.connected ? "#34d399" : "#fbbf24",
          },
          { label: "Billing", value: "Monthly, cancel with 30 days", fg: "#94a3b8" },
        ]
      : isRet
        ? [
            { label: "Tier", value: retSel.name, fg: "#f8fafc" },
            {
              label: "Tenant scan",
              value: st.connected ? "Included" : "Skipped",
              fg: st.connected ? "#34d399" : "#94a3b8",
            },
            { label: "Billing", value: "Monthly, no minimum term", fg: "#94a3b8" },
          ]
        : packKeys
            .map((k) => ({
              label: PACKS_BY_KEY[k]?.name ?? "",
              value: money(PACKS_BY_KEY[k]?.price ?? 0),
              fg: "#f8fafc",
            }))
            .concat([
              { label: "Write access", value: "Granted after payment", fg: "#fbbf24" },
              { label: "Billing", value: "One-time", fg: "#94a3b8" },
            ]),
    cta: connectBlocked
      ? "Connect your tenant to continue"
      : hasUnavailablePack
        ? "This pack isn't available yet"
        : !st.agreed
          ? "Accept the terms to continue"
          : "Pay " + money(price) + (isPack ? " and continue" : " and start"),
    foot: connectBlocked
      ? "Monitoring cannot be priced before the tenant reports its seat count."
      : hasUnavailablePack
        ? "Choose a pack marked available to continue."
        : isPack
          ? "Nothing changes in your tenant until you approve the preview."
          : "Cancel any month.",
  };

  const nextUp = isMon
    ? [
        "The engines start their first full pass within the hour",
        "Findings land in your Portal as they are confirmed",
        "Runbooks and SOPs unlock at Growth and above",
      ]
    : isRet
      ? [
          "Your architect is booked from this month",
          "Hours consumed against hours retained, visible in the Portal",
          "A written status report you can actually read",
        ]
      : [
          "You grant write access, scoped to this pack",
          "The Portal previews every change before it runs",
          "You deselect anything you don’t want, then schedule the window",
        ];

  const writeCard = isPack
    ? {
        eyebrow: "Paid · one step before anything changes",
        optional: false,
        title: "This pack needs write access. Until now we’ve only had read.",
        body: "Everything up to this point ran through the read-only app registration. Applying a Quick-Start Pack means changing configuration, which is a second, separate consent — granted by you, scoped to what the pack actually touches, and revocable the moment it’s done.",
        foot: "You’ll preview every change in the Portal and can deselect any of them before the pack runs.",
      }
    : {
        eyebrow: "Paid · optional, and you can do it later",
        optional: true,
        title: "Want the fixes applied for you, not just found?",
        body:
          "Everything so far runs on the read-only app registration, and it stays that way unless you say otherwise. Granting write access is what lets " +
          (isMon
            ? "the one-click runbooks and SOP remediation"
            : "your architect’s SOP remediation") +
          " actually change something instead of handing you a checklist. Nothing runs without your approval on each change.",
        foot: "Decline and nothing is lost — you can grant it from the Portal whenever you want.",
      };
  const writeScopes = isPack ? WRITE_SCOPES : SOP_WRITE_SCOPES;

  // ── account screen model ──────────────────────────────────────────────────────
  const acctIsCode = st.stage === "code" || st.stage === "verifying";
  const acctIsPassword = st.stage === "password";
  const acctIsMfa = st.stage === "mfa" || st.stage === "logging";
  const acctReady = acctIsCode
    ? st.codeInput.length === 6
    : acctIsPassword
      ? pwOk
      : mfaOk;
  const acct = {
    step:
      "Paid · " +
      (acctIsCode ? "step 1 of 3" : acctIsPassword ? "step 2 of 3" : "step 3 of 3"),
    email: st.email.trim() || "your billing address",
    title: acctIsCode
      ? "Check your email for a six-digit code"
      : acctIsPassword
        ? "Set a password"
        : "Add a second factor",
    body: acctIsCode
      ? "Payment went through. We sent a code to " +
        (st.email.trim() || "your billing address") +
        " — entering it proves the address is yours and creates your Portal account."
      : acctIsPassword
        ? "This is the password you will use at portal.shanemccaw.com. Twelve characters minimum, one capital, one number."
        : "Your tenant’s data sits behind this account, so a second factor is required rather than offered.",
    cta: acctIsCode
      ? "Verify and continue"
      : acctIsPassword
        ? "Set password"
        : "Finish and sign in",
    advance: acctIsCode ? verifyCode : acctIsPassword ? savePw : finishAccount,
    foot: acctIsCode
      ? "The code expires in ten minutes."
      : acctIsPassword
        ? "Stored hashed. Shane cannot read it."
        : "You will be signed in automatically — no second login.",
  };
  const pwRules = [
    { text: "At least 12 characters", ok: st.pw1.length >= 12 },
    {
      text: "One capital letter and one number",
      ok: /[A-Z]/.test(st.pw1) && /[0-9]/.test(st.pw1),
    },
    { text: "Both fields match", ok: st.pw1.length > 0 && st.pw1 === st.pw2 },
  ];
  const mfaSecret = "JBSW Y3DP EHPK 3PXP";

  const done = {
    title: isPack
      ? "Write access granted. Your pack is ready to preview."
      : isMon
        ? "Monitoring is live on your tenant."
        : "Your retainer starts this month.",
    body: isPack
      ? "Nothing has changed in your tenant yet. The Portal now holds a dry run of every change this pack makes, with each one individually deselectable before you schedule it."
      : st.writeGranted
        ? money(price) +
          "/mo on " +
          selName +
          ". Write access is granted, so remediation can be applied for you — each change still needs your approval."
        : isMon
          ? money(price) +
            "/mo on " +
            selName +
            " for " +
            REAL_SEATS.toLocaleString("en-US") +
            " seats. The first full pass is running now."
          : money(price) +
            "/mo on " +
            selName +
            ". " +
            (st.connected
              ? "Your read-only scan runs before the first session, so the conversation starts from real findings."
              : "You can connect a read-only scan any time from the Portal."),
    next: isPack
      ? [
          { when: "NOW", text: "Review the dry run: every change, in plain English, with what it touches." },
          { when: "YOU PICK", text: "Deselect anything you don’t want and choose the change window." },
          { when: "ON RUN", text: "The people you nominated are notified, and every change is logged." },
        ]
      : isMon
        ? [
            { when: "WITHIN 1H", text: "First full pass across all six engines completes." },
            { when: "DAY 1", text: "Findings appear ranked by what closes the biggest exposure first." },
            { when: "ONGOING", text: "Re-checks run on your cadence, and regressions get caught." },
          ]
        : [
            { when: "TODAY", text: "Shane confirms your first session directly — an email within one business day." },
            { when: "MONTH 1", text: "Hours are logged against real work as they are used." },
            { when: "ONGOING", text: "Anything that becomes delivery work is scoped as a separate fixed-price SOW." },
          ],
  };

  // ── pack dry-run / execution / record model ───────────────────────────────────
  const all = isPack ? liveActions() : [];
  // Live mode ignores dryOff — a real pack executes as one unit (#1316).
  const chosen = all.filter((a) => !a.satisfied && (liveMode || !st.dryOff[a.id]));
  const disruptiveChosen = chosen.filter((a) => a.impact === "disruptive");
  const satisfiedCount = all.filter((a) => a.satisfied).length;
  const dryGroups = liveMode
    ? live.packs.map((p) => {
        const items = all.filter((a) => a.pack === p.serviceSlug);
        const on = items.filter((a) => !a.satisfied).length;
        return {
          key: p.serviceSlug,
          name: p.serviceName,
          count: on + " of " + items.length + " changes approved",
          price: money((p.priceCents ?? 0) / 100),
          items,
        };
      })
    : packKeys.map((k) => {
        const items = all.filter((a) => a.pack === k);
        const on = items.filter((a) => !st.dryOff[a.id] && !a.satisfied).length;
        return {
          key: k,
          name: PACKS_BY_KEY[k]?.name ?? "",
          count: on + " of " + items.length + " changes approved",
          price: money(PACKS_BY_KEY[k]?.price ?? 0),
          items,
        };
      });
  const windows: { k: DryWindow; label: string; sub: string }[] = [
    { k: "now", label: "Run now", sub: "Starts the moment you approve" },
    { k: "tonight", label: "Tonight, 22:00", sub: "Outside working hours" },
    { k: "window", label: "Next change window", sub: "Saturday 06:00, from your calendar" },
  ];
  const scanning = st.dryScan === "scanning";
  const scanState =
    st.dryScan === "done"
      ? "Read " +
        st.dryScanAt +
        " · " +
        satisfiedCount +
        (satisfiedCount === 1
          ? " change was already true and has been dropped"
          : " changes were already true and have been dropped")
      : "Configuration read " + st.dryScanAt + ". Re-read it if anything changed since.";
  const execTotal = liveMode ? live.run.total : chosen.length;
  const execDone = liveMode
    ? Math.min(live.run.completed, execTotal)
    : Math.min(st.execStep, chosen.length);
  const execPct = execTotal ? Math.round((execDone / execTotal) * 100) : 0;
  const execNow = liveMode
    ? (live.run.currentLabel ?? "Finishing up")
    : (chosen[Math.min(st.execStep, chosen.length - 1)]?.title ?? "Finishing up");
  const recordGroups = liveMode
    ? live.packs.map((p) => ({
        key: p.serviceSlug,
        name: p.serviceName,
        price: money((p.priceCents ?? 0) / 100),
        rows: all
          .filter((a) => a.pack === p.serviceSlug)
          .map((a) => {
            // Real per-step outcome from the run's own node results (#1316).
            const outcome = liveStepOutcome(a, live.run);
            return {
              setting: a.title,
              before: a.from,
              after: outcome === "applied" ? a.to : a.from,
              result:
                outcome === "satisfied"
                  ? "Already correct"
                  : outcome === "applied"
                    ? "Applied"
                    : outcome === "failed"
                      ? "Failed"
                      : live.run.phase === "failed"
                        ? "Not run"
                        : "Awaiting verification",
              resultFg:
                outcome === "satisfied"
                  ? "#64748b"
                  : outcome === "applied"
                    ? "#34d399"
                    : outcome === "failed"
                      ? "#f87171"
                      : "#fbbf24",
              afterFg: outcome === "applied" ? "#7dd3fc" : "#64748b",
            };
          }),
      }))
    : packKeys.map((k) => ({
        key: k,
        name: PACKS_BY_KEY[k]?.name ?? "",
        price: money(PACKS_BY_KEY[k]?.price ?? 0),
        rows: all
          .filter((a) => a.pack === k)
          .map((a) => {
            const skipped = a.satisfied;
            const dropped = !!st.dryOff[a.id];
            return {
              setting: a.title,
              before: a.from,
              after: dropped || skipped ? a.from : a.to,
              result: skipped
                ? "Already correct"
                : dropped
                  ? "Declined by you"
                  : "Applied",
              resultFg: skipped ? "#64748b" : dropped ? "#fbbf24" : "#34d399",
              afterFg: skipped || dropped ? "#64748b" : "#7dd3fc",
            };
          }),
      }));
  const declinedCount = liveMode
    ? 0
    : all.filter((a) => st.dryOff[a.id] && !a.satisfied).length;
  const preScanPct = Math.round((st.preScanStep / PRE_SCAN.length) * 100);

  // ── shared style bits ──────────────────────────────────────────────────────────
  const eyebrow: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".2em",
    textTransform: "uppercase",
  };
  const gradientBtn = "linear-gradient(90deg,#3b82f6,#8b5cf6)";

  return (
    <div
      data-testid="buy-page"
      data-product={st.product}
      data-stage={st.stage}
      style={{
        background: "#020617",
        color: "#f8fafc",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        minHeight: "100vh",
      }}
    >
      <style>{`
        @keyframes buySpin{to{transform:rotate(360deg)}}
        @keyframes buyRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        [data-testid="buy-page"] input::placeholder{color:#475569}
      `}</style>

      {/* Header: logo lockup + step rail */}
      <div
        style={{
          borderBottom: "1px solid rgba(30,41,59,.9)",
          background: "rgba(2,6,23,.92)",
          padding: "12px 32px",
          display: "flex",
          alignItems: "center",
          gap: "26px",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexShrink: 0,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <span
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9px",
              background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12.5px",
              fontWeight: 800,
              color: "#fff",
            }}
          >
            SM
          </span>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "#f8fafc",
              whiteSpace: "nowrap",
            }}
          >
            Shane McCaw
          </span>
        </Link>
        <div
          data-testid="buy-steprail"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          {stepLabels.map((label, i) => {
            const state = i < at ? "done" : i === at ? "now" : "next";
            return (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "19px",
                    height: "19px",
                    borderRadius: "999px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9.5px",
                    fontWeight: 700,
                    flex: "none",
                    ...(state === "done"
                      ? {
                          color: "#34d399",
                          background: "rgba(52,211,153,.12)",
                          border: "1px solid rgba(52,211,153,.3)",
                        }
                      : state === "now"
                        ? { color: "#fff", background: gradientBtn }
                        : {
                            color: "#64748b",
                            background: "rgba(255,255,255,.05)",
                            border: "1px solid rgba(71,85,105,.35)",
                          }),
                  }}
                >
                  {i < at ? "✓" : i + 1}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    color:
                      state === "next"
                        ? "#475569"
                        : state === "now"
                          ? "#f8fafc"
                          : "#94a3b8",
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#334155",
                    margin: "0 2px",
                    display: i === stepLabels.length - 1 ? "none" : "inline",
                  }}
                >
                  →
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Buying screen (choices + sticky summary) ────────────────────────────── */}
      {show.buying && (
        <div
          style={{
            maxWidth: "1140px",
            margin: "0 auto",
            padding: "34px 32px 80px",
            display: "flex",
            flexWrap: "wrap",
            gap: "30px 34px",
            alignItems: "flex-start",
          }}
        >
          {/* Left column: choices */}
          <div
            style={{
              flex: "3 1 440px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ ...eyebrow, color: "#60a5fa" }}>{head.eyebrow}</span>
              <h1
                data-testid="buy-heading"
                style={{
                  margin: 0,
                  fontSize: "clamp(23px,2.7vw,30px)",
                  fontWeight: 800,
                  letterSpacing: "-.03em",
                  lineHeight: 1.16,
                  color: "#f8fafc",
                }}
              >
                {head.title}
              </h1>
              <p
                style={{
                  margin: 0,
                  maxWidth: "62ch",
                  fontSize: "14px",
                  lineHeight: 1.68,
                  color: "#94a3b8",
                }}
              >
                {head.body}
              </p>
            </div>

            {/* Options */}
            <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
              <span style={{ ...eyebrow, color: "#64748b" }}>
                {isPack ? "Choose your packs" : "Choose your tier"}
              </span>
              {optionRows.map((o) => (
                <div
                  key={o.key}
                  data-testid={`buy-option-${o.key}`}
                  data-available={o.available}
                  onClick={() => o.available && pick(o.key)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "15px 16px",
                    borderRadius: "13px",
                    cursor: o.available ? "pointer" : "not-allowed",
                    opacity: o.available ? 1 : 0.55,
                    transition: "border-color 200ms,background 200ms",
                    border: o.on
                      ? "1px solid rgba(59,130,246,.5)"
                      : "1px solid rgba(30,41,59,.9)",
                    background: o.on ? "rgba(59,130,246,.07)" : "#0b1524",
                  }}
                >
                  <span
                    style={{
                      width: "17px",
                      height: "17px",
                      borderRadius: isPack ? "5px" : "50%",
                      flex: "none",
                      marginTop: "2px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 800,
                      color: "#fff",
                      border: o.on ? "1px solid #3b82f6" : "1px solid rgba(71,85,105,.9)",
                      background: isPack && o.on ? "#3b82f6" : "transparent",
                    }}
                  >
                    {isPack && o.on ? "✓" : ""}
                    <span
                      style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        background: isPack
                          ? "transparent"
                          : o.on
                            ? "#3b82f6"
                            : "transparent",
                      }}
                    />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "#f8fafc",
                      }}
                    >
                      {o.name}
                      {!o.available && (
                        <span
                          data-testid={`buy-option-coming-soon-${o.key}`}
                          style={{
                            flex: "none",
                            fontSize: "9.5px",
                            fontWeight: 700,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            color: "#fbbf24",
                            background: "rgba(251,191,36,.12)",
                            border: "1px solid rgba(251,191,36,.35)",
                            borderRadius: "999px",
                            padding: "2px 8px",
                          }}
                        >
                          Coming soon
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "#94a3b8",
                        lineHeight: 1.6,
                        marginTop: "3px",
                      }}
                    >
                      {o.desc}
                    </span>
                  </span>
                  <span style={{ flex: "none", textAlign: "right" }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "14.5px",
                        fontWeight: 800,
                        color: "#f8fafc",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {o.priceLabel}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "10.5px",
                        color: "#64748b",
                        marginTop: "2px",
                      }}
                    >
                      {o.unit}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {/* Connect card (monitoring: required; retainer: optional) */}
            {show.connect && (
              <div
                data-testid="buy-connect"
                style={{
                  border: "1px solid rgba(59,130,246,.3)",
                  borderRadius: "16px",
                  background: "rgba(59,130,246,.05)",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "13px",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "9px",
                      background: "rgba(59,130,246,.12)",
                      border: "1px solid rgba(59,130,246,.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#60a5fa",
                    }}
                  >
                    <IconLock />
                  </span>
                  <span style={{ fontSize: "14.5px", fontWeight: 700, color: "#f8fafc" }}>
                    {connectCard.title}
                  </span>
                </span>
                <p style={{ margin: 0, fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.65 }}>
                  {connectCard.body}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {READ_SCOPES.map((rs) => (
                    <span
                      key={rs}
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "flex-start",
                        fontSize: "12px",
                        color: "#cbd5e1",
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: "#34d399", flex: "none", display: "flex", marginTop: "1px" }}>
                        <IconCheck />
                      </span>
                      <span>{rs}</span>
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "11px",
                    flexWrap: "wrap",
                    alignItems: "center",
                    paddingTop: "4px",
                  }}
                >
                  <button
                    data-testid="buy-connect-grant"
                    onClick={doConnect}
                    style={{
                      padding: "10px 18px",
                      border: 0,
                      borderRadius: "10px",
                      fontFamily: "inherit",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#fff",
                      background: gradientBtn,
                      cursor: "pointer",
                    }}
                  >
                    Grant read-only access
                  </button>
                  {connectCard.optional && (
                    <button
                      data-testid="buy-connect-skip"
                      onClick={skipConnect}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        fontFamily: "inherit",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#cbd5e1",
                        background: "transparent",
                        border: "1px solid rgba(148,163,184,.25)",
                        cursor: "pointer",
                      }}
                    >
                      Skip — buy without a scan
                    </button>
                  )}
                </div>
                <span style={{ fontSize: "11px", color: "#475569" }}>{connectCard.foot}</span>
              </div>
            )}

            {/* Seat estimate (monitoring, before connection) */}
            {show.estimate && est && (
              <div
                data-testid="buy-estimate"
                style={{
                  border: "1px solid rgba(30,41,59,.95)",
                  borderRadius: "16px",
                  background: "#0b1524",
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "11px",
                }}
              >
                <span style={{ ...eyebrow, color: est.eyebrowFg }}>{est.eyebrow}</span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "14px",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      flex: "1 1 190px",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>{est.label}</span>
                    <FocusInput
                      data-testid="buy-seat-input"
                      value={st.seatInput}
                      onChange={onSeats}
                      inputMode="numeric"
                      placeholder="e.g. 250"
                      style={{ ...inputStyle, fontSize: "14px" }}
                    />
                  </label>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span
                      style={{
                        fontSize: "25px",
                        fontWeight: 800,
                        color: "#f8fafc",
                        letterSpacing: "-.03em",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {est.price}
                    </span>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{est.basis}</span>
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "11.5px", color: "#475569", lineHeight: 1.6 }}>
                  {est.foot}
                </p>
              </div>
            )}

            {/* Connected confirmation */}
            {show.connected && (
              <div
                data-testid="buy-connected"
                style={{
                  border: "1px solid rgba(52,211,153,.3)",
                  borderRadius: "14px",
                  background: "rgba(52,211,153,.06)",
                  padding: "15px 17px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: "#34d399", flex: "none", display: "flex", marginTop: "2px" }}>
                  <IconCheck />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "13.5px",
                      fontWeight: 700,
                      color: "#f8fafc",
                    }}
                  >
                    {connectedCard.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      color: "#94a3b8",
                      lineHeight: 1.6,
                      marginTop: "3px",
                    }}
                  >
                    {connectedCard.body}
                  </span>
                </span>
                <button
                  onClick={reconnect}
                  style={{
                    flex: "none",
                    padding: "7px 13px",
                    borderRadius: "8px",
                    fontFamily: "inherit",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: "#94a3b8",
                    background: "transparent",
                    border: "1px solid rgba(71,85,105,.5)",
                    cursor: "pointer",
                  }}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Right column: sticky summary */}
          <div
            style={{
              flex: "1 1 300px",
              minWidth: 0,
              position: "sticky",
              top: "20px",
              alignSelf: "flex-start",
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              paddingRight: "2px",
            }}
          >
            <div
              style={{
                border: "1px solid rgba(59,130,246,.32)",
                borderRadius: "16px",
                background: "linear-gradient(160deg,rgba(59,130,246,.1),#0b1524 70%)",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "15px",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ ...eyebrow, color: "#64748b" }}>{summary.label}</span>
                <span
                  data-testid="buy-summary-total"
                  style={{
                    fontSize: "31px",
                    fontWeight: 800,
                    letterSpacing: "-.035em",
                    lineHeight: 1,
                    color: "#f8fafc",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {summary.total}
                </span>
                <span
                  data-testid="buy-summary-sub"
                  style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}
                >
                  {summary.sub}
                </span>
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  paddingTop: "14px",
                  borderTop: "1px solid rgba(30,41,59,.9)",
                }}
              >
                {summary.lines.map((ln, i) => (
                  <span
                    key={ln.label + i}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "#94a3b8" }}>{ln.label}</span>
                    <span
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 700,
                        color: ln.fg,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                      }}
                    >
                      {ln.value}
                    </span>
                  </span>
                ))}
              </div>

              {/* Payment details — shown whenever payment is offered (never hidden by the terms
                  box); gated only for monitoring before the tenant is connected. */}
              {show.pay && (
                <div
                  data-testid="buy-payment-fields"
                  style={{ display: "flex", flexDirection: "column", gap: "11px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ ...eyebrow, color: "#64748b" }}>Payment details</span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        color: "#64748b",
                      }}
                    >
                      <IconLock /> Processed by Stripe
                    </span>
                  </div>
                  {st.stage === "paying" ? (
                    st.intent ? (
                      <StripePaymentElement
                        clientSecret={st.intent.clientSecret}
                        publishableKey={st.intent.publishableKey}
                        onSuccess={(paymentIntentId) => confirmPayment(paymentIntentId)}
                      />
                    ) : (
                      <div
                        style={{
                          border: "1px solid rgba(30,41,59,.95)",
                          borderRadius: "14px",
                          background: "#0b1524",
                          padding: "22px 18px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "10px",
                          minHeight: "120px",
                        }}
                      >
                        <div
                          style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            border: "2px solid rgba(51,65,85,.9)",
                            borderTopColor: "#3b82f6",
                            animation: spinAnim,
                            flex: "none",
                          }}
                        />
                        <span style={{ fontSize: "12.5px", color: "#94a3b8" }}>
                          Preparing secure payment…
                        </span>
                      </div>
                    )
                  ) : (
                    <div
                      style={{
                        border: "1px solid rgba(30,41,59,.95)",
                        borderRadius: "14px",
                        background: "#0b1524",
                        padding: "18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "11px",
                      }}
                    >
                      <FocusInput
                        data-testid="buy-email"
                        type="text"
                        value={st.email}
                        onChange={onEmail}
                        placeholder="billing@yourcompany.com"
                        style={inputStyle}
                      />
                      <FocusInput
                        data-testid="buy-fullname"
                        type="text"
                        value={st.fullName}
                        onChange={onFullName}
                        placeholder="Full name"
                        style={inputStyle}
                      />
                      <FocusInput
                        data-testid="buy-company"
                        type="text"
                        value={st.company}
                        onChange={onCompany}
                        placeholder="Company"
                        style={inputStyle}
                      />
                    </div>
                  )}
                  {st.payingError && (
                    <p
                      data-testid="buy-pay-error"
                      style={{ fontSize: "12.5px", color: "#f87171", lineHeight: 1.5, margin: 0 }}
                    >
                      {st.payingError}
                    </p>
                  )}
                </div>
              )}

              {/* Terms + Pay — hidden once "paying" starts: the real Stripe
                  Payment Element (rendered above) owns the actual charge from
                  there, and showing both would read as two pay buttons. */}
              {st.stage === "buy" && (
                <>
                  <div
                    data-testid="buy-terms"
                    onClick={toggleAgree}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "9px",
                      cursor: "pointer",
                      paddingTop: "12px",
                      borderTop: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    <span
                      style={{
                        flex: "none",
                        marginTop: "1px",
                        width: "17px",
                        height: "17px",
                        borderRadius: "5px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 800,
                        color: "#fff",
                        cursor: "pointer",
                        border: st.agreed ? "1px solid #3b82f6" : "1px solid rgba(100,116,139,.75)",
                        background: st.agreed ? "#3b82f6" : "transparent",
                      }}
                    >
                      {st.agreed ? "✓" : ""}
                    </span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
                      I agree to the{" "}
                      <span style={{ color: "#60a5fa", fontWeight: 600 }}>Terms of Service</span> and
                      the <span style={{ color: "#60a5fa", fontWeight: 600 }}>Privacy Policy</span>.
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "9px",
                      paddingTop: "14px",
                      borderTop: "1px solid rgba(30,41,59,.9)",
                    }}
                  >
                    <button
                      data-testid="buy-pay"
                      onClick={submit}
                      style={{
                        width: "100%",
                        padding: "12px",
                        border: 0,
                        borderRadius: "11px",
                        fontFamily: "inherit",
                        fontSize: "13.5px",
                        fontWeight: 700,
                        color: "#fff",
                        cursor: blocked ? "not-allowed" : "pointer",
                        background: blocked ? "rgba(71,85,105,.4)" : gradientBtn,
                      }}
                    >
                      {summary.cta}
                    </button>
                    <span
                      style={{
                        fontSize: "11px",
                        lineHeight: 1.5,
                        color: "#64748b",
                        textAlign: "center",
                      }}
                    >
                      {summary.foot}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* What happens next */}
            <div
              style={{
                border: "1px solid rgba(30,41,59,.95)",
                borderRadius: "14px",
                background: "rgba(11,21,36,.7)",
                padding: "15px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "9px",
              }}
            >
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                What happens next
              </span>
              {nextUp.map((nu) => (
                <span
                  key={nu}
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                    fontSize: "11.5px",
                    color: "#94a3b8",
                    lineHeight: 1.55,
                  }}
                >
                  <span style={{ color: "#22d3ee", flex: "none", display: "flex", marginTop: "1px" }}>
                    <IconCheck />
                  </span>
                  <span>{nu}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Account creation (code → password → MFA) ─────────────────────────────── */}
      {show.account && (
        <div
          data-testid="buy-account"
          style={{
            maxWidth: "520px",
            margin: "0 auto",
            padding: "48px 32px 90px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            animation: "buyRise 460ms ease both",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            <span style={{ ...eyebrow, color: "#34d399" }}>{acct.step}</span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(22px,2.6vw,28px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.18,
                color: "#f8fafc",
              }}
            >
              {acct.title}
            </h1>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65, color: "#94a3b8" }}>
              {acct.body}
            </p>
          </div>

          <div
            style={{
              border: "1px solid rgba(30,41,59,.95)",
              borderRadius: "16px",
              background: "#0b1524",
              padding: "22px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {acctIsCode && (
              <>
                <FocusInput
                  data-testid="buy-code"
                  value={st.codeInput}
                  onChange={onCode}
                  inputMode="numeric"
                  placeholder="000000"
                  style={{
                    width: "100%",
                    background: "rgba(2,6,23,.7)",
                    border: "1px solid rgba(51,65,85,.9)",
                    borderRadius: "10px",
                    padding: "14px",
                    fontSize: "26px",
                    fontWeight: 700,
                    letterSpacing: ".42em",
                    textAlign: "center",
                    color: "#f1f5f9",
                    outline: "none",
                    fontFamily: "Menlo,Consolas,monospace",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                    Sent to {acct.email}
                  </span>
                  <button
                    onClick={resend}
                    style={{
                      padding: 0,
                      border: 0,
                      background: "none",
                      fontFamily: "inherit",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      color: "#60a5fa",
                      cursor: "pointer",
                    }}
                  >
                    Resend code
                  </button>
                </div>
              </>
            )}

            {acctIsPassword && (
              <>
                <FocusInput
                  type="password"
                  value={st.pw1}
                  onChange={onPw1}
                  placeholder="Choose a password"
                  style={inputStyle}
                />
                <FocusInput
                  type="password"
                  value={st.pw2}
                  onChange={onPw2}
                  placeholder="Confirm password"
                  style={inputStyle}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {pwRules.map((pr) => (
                    <span
                      key={pr.text}
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        fontSize: "11.5px",
                        color: pr.ok ? "#34d399" : "#64748b",
                      }}
                    >
                      <span style={{ display: "flex", flex: "none" }}>
                        {pr.ok ? (
                          <Icon size={12}>
                            <path d="M5 13l4 4L19 7" />
                          </Icon>
                        ) : (
                          <Icon size={12}>
                            <circle cx={12} cy={12} r={8} />
                          </Icon>
                        )}
                      </span>
                      <span>{pr.text}</span>
                    </span>
                  ))}
                </div>
              </>
            )}

            {acctIsMfa && (
              <>
                {(
                  [
                    { key: "app" as MfaMethod, name: "Authenticator app", desc: "Microsoft Authenticator, 1Password, or anything TOTP." },
                    { key: "rsa" as MfaMethod, name: "RSA SecurID", desc: "A hardware or software token, if that is what your organization already issues." },
                  ]
                ).map((m) => {
                  const on = st.mfaMethod === m.key;
                  return (
                    <div
                      key={m.key}
                      onClick={() => pickMfa(m.key)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "11px",
                        padding: "13px 14px",
                        borderRadius: "11px",
                        cursor: "pointer",
                        border: on
                          ? "1px solid rgba(59,130,246,.5)"
                          : "1px solid rgba(30,41,59,.9)",
                        background: on ? "rgba(59,130,246,.07)" : "rgba(2,6,23,.4)",
                      }}
                    >
                      <span
                        style={{
                          width: "16px",
                          height: "16px",
                          borderRadius: "50%",
                          flex: "none",
                          marginTop: "2px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: on ? "1px solid #3b82f6" : "1px solid rgba(71,85,105,.9)",
                        }}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            background: on ? "#3b82f6" : "transparent",
                          }}
                        />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: "13.5px",
                            fontWeight: 700,
                            color: "#f8fafc",
                          }}
                        >
                          {m.name}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: "11.5px",
                            color: "#94a3b8",
                            lineHeight: 1.55,
                            marginTop: "2px",
                          }}
                        >
                          {m.desc}
                        </span>
                      </span>
                    </div>
                  );
                })}
                {st.mfaMethod === "app" && (
                  <>
                    <div
                      style={{
                        border: "1px solid rgba(59,130,246,.28)",
                        borderRadius: "11px",
                        background: "rgba(59,130,246,.06)",
                        padding: "13px 15px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "7px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          letterSpacing: ".16em",
                          textTransform: "uppercase",
                          color: "#64748b",
                        }}
                      >
                        Setup key
                      </span>
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          letterSpacing: ".16em",
                          color: "#f1f5f9",
                          fontFamily: "Menlo,Consolas,monospace",
                        }}
                      >
                        {mfaSecret}
                      </span>
                      <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
                        Scan or paste this into your authenticator, then enter the code it shows.
                      </span>
                    </div>
                    <FocusInput
                      value={st.mfaCode}
                      onChange={onMfaCode}
                      inputMode="numeric"
                      placeholder="Code from your app"
                      style={inputStyle}
                    />
                  </>
                )}
                {st.mfaMethod === "rsa" && (
                  <>
                    <FocusInput
                      value={st.phone}
                      onChange={onPhone}
                      placeholder="Token serial number"
                      style={inputStyle}
                    />
                    <FocusInput
                      value={st.mfaCode}
                      onChange={onMfaCode}
                      inputMode="numeric"
                      placeholder="Current token code"
                      style={inputStyle}
                    />
                  </>
                )}
              </>
            )}

            <button
              data-testid="buy-account-advance"
              onClick={acct.advance}
              style={{
                width: "100%",
                padding: "12px",
                border: 0,
                borderRadius: "10px",
                fontFamily: "inherit",
                fontSize: "13.5px",
                fontWeight: 700,
                color: "#fff",
                cursor: acctReady ? "pointer" : "not-allowed",
                background: acctReady ? gradientBtn : "rgba(71,85,105,.4)",
              }}
            >
              {acct.cta}
            </button>
            <span
              style={{ fontSize: "11px", color: "#475569", lineHeight: 1.5, textAlign: "center" }}
            >
              {acct.foot}
            </span>
          </div>
        </div>
      )}

      {/* ── Write consent ────────────────────────────────────────────────────────── */}
      {show.writeConsent && (
        <div
          data-testid="buy-write"
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "48px 32px 90px",
            display: "flex",
            flexDirection: "column",
            gap: "22px",
            animation: "buyRise 480ms ease both",
          }}
        >
          <span
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "rgba(251,191,36,.12)",
              border: "1px solid rgba(251,191,36,.32)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fbbf24",
            }}
          >
            <IconKey />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={{ ...eyebrow, color: "#fbbf24" }}>{writeCard.eyebrow}</span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(24px,3vw,32px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.16,
                color: "#f8fafc",
              }}
            >
              {writeCard.title}
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "14.5px",
                lineHeight: 1.68,
                color: "#94a3b8",
                maxWidth: "60ch",
              }}
            >
              {writeCard.body}
            </p>
          </div>
          <div
            style={{
              border: "1px solid rgba(30,41,59,.95)",
              borderRadius: "16px",
              background: "#0b1524",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 700,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              The write app registration asks for
            </span>
            {writeScopes.map((ws) => (
              <span key={ws.scope} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ color: "#fbbf24", flex: "none", display: "flex", marginTop: "2px" }}>
                  <IconKey size={13} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: "#f8fafc",
                      fontFamily: "Menlo,Consolas,monospace",
                    }}
                  >
                    {ws.scope}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "11.5px",
                      color: "#94a3b8",
                      lineHeight: 1.55,
                      marginTop: "3px",
                    }}
                  >
                    {ws.why}
                  </span>
                </span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              data-testid="buy-write-grant"
              onClick={grantWrite}
              style={{
                padding: "12px 24px",
                border: 0,
                borderRadius: "11px",
                fontFamily: "inherit",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
                background: gradientBtn,
                cursor: "pointer",
              }}
            >
              Grant write access
            </button>
            {writeCard.optional && (
              <button
                data-testid="buy-write-decline"
                onClick={declineWrite}
                style={{
                  padding: "12px 22px",
                  borderRadius: "11px",
                  fontFamily: "inherit",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  color: "#cbd5e1",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,.25)",
                  cursor: "pointer",
                }}
              >
                Not now — stay read-only
              </button>
            )}
            <span
              style={{ fontSize: "11.5px", color: "#64748b", maxWidth: "38ch", lineHeight: 1.55 }}
            >
              {writeCard.foot}
            </span>
          </div>
        </div>
      )}

      {/* ── Targeted pre-scan ────────────────────────────────────────────────────── */}
      {show.preScan && (
        <div
          data-testid="buy-prescan"
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "84px 32px 120px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ ...eyebrow, color: "#60a5fa" }}>
              Step 1 of 2 · reading your tenant
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(21px,2.5vw,27px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.2,
                color: "#f8fafc",
              }}
            >
              Scanning before anything is written.
            </h1>
            <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.68, color: "#94a3b8" }}>
              The dry run is built from your tenant as it is right now, not from the read taken at
              checkout. Changes that are already true are dropped before you see the list.
            </p>
          </div>
          <span
            style={{
              width: "100%",
              height: "6px",
              borderRadius: "999px",
              background: "rgba(30,41,59,.9)",
              overflow: "hidden",
              display: "block",
            }}
          >
            <span
              style={{
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg,#3b82f6,#22d3ee)",
                transition: "width 420ms",
                width: preScanPct + "%",
                display: "block",
              }}
            />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            {PRE_SCAN.map((t, i) => (
              <span
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "12.5px",
                  lineHeight: 1.6,
                  color:
                    i < st.preScanStep
                      ? "#cbd5e1"
                      : i === st.preScanStep
                        ? "#f8fafc"
                        : "#475569",
                }}
              >
                <span
                  style={{
                    flex: "none",
                    width: "16px",
                    textAlign: "center",
                    fontWeight: 800,
                    color: i < st.preScanStep ? "#34d399" : "#60a5fa",
                  }}
                >
                  {i < st.preScanStep ? "✓" : i === st.preScanStep ? "•" : ""}
                </span>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Dry run ──────────────────────────────────────────────────────────────── */}
      {show.dryRun && (
        <div
          data-testid="buy-dryrun"
          style={{
            maxWidth: "1080px",
            margin: "0 auto",
            padding: "40px 32px 130px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            animation: "buyRise 460ms ease both",
          }}
        >
          <span
            data-testid="buy-dry-source"
            data-state={liveMode ? "live" : "fixture"}
            style={{ display: "none" }}
          />
          {liveMode && (live.dryStatus === "error" || live.run.phase === "error") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                padding: "13px 16px",
                borderRadius: "13px",
                border: "1px solid rgba(248,113,113,.32)",
                background: "rgba(248,113,113,.06)",
              }}
            >
              <span
                data-testid="buy-dry-live-error"
                style={{ flex: "1 1 300px", minWidth: 0, fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6 }}
              >
                {live.dryStatus === "error"
                  ? `The live read of your tenant failed (${live.dryError ?? "unknown"}). Nothing has been changed — re-read the tenant to try again.`
                  : `The run could not start (${live.run.error ?? "unknown"}). Nothing has been changed.`}
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            <span style={{ ...eyebrow, color: "#fbbf24" }}>
              Dry run · nothing has changed yet
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(23px,2.7vw,30px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.16,
                color: "#f8fafc",
              }}
            >
              Every change these packs will make, before any of them run.
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: "70ch",
                fontSize: "14px",
                lineHeight: 1.68,
                color: "#94a3b8",
              }}
            >
              Write access is granted but unused. Below is each write the packs perform, what it
              touches, the value in your tenant now and the value after. Deselect anything you do
              not want and it is never sent.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap",
              padding: "14px 16px",
              borderRadius: "13px",
              border: "1px solid rgba(59,130,246,.28)",
              background: "rgba(59,130,246,.05)",
            }}
          >
            <span style={{ flex: "1 1 320px", minWidth: 0, fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6 }}>
              {scanState}
            </span>
            <button
              onClick={rescan}
              style={{
                flex: "none",
                padding: "8px 14px",
                borderRadius: "9px",
                border: "1px solid rgba(59,130,246,.45)",
                background: "rgba(59,130,246,.1)",
                color: "#93c5fd",
                fontSize: "11.5px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {scanning ? "Reading your tenant…" : "Re-read the tenant"}
            </button>
          </div>

          {disruptiveChosen.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                padding: "13px 16px",
                borderRadius: "13px",
                border: "1px solid rgba(248,113,113,.32)",
                background: "rgba(248,113,113,.06)",
              }}
            >
              <span
                style={{
                  flex: "none",
                  fontSize: "19px",
                  fontWeight: 800,
                  color: "#f87171",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {disruptiveChosen.length}
              </span>
              <span style={{ flex: "1 1 300px", minWidth: 0, fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6 }}>
                {disruptiveChosen.length === 1
                  ? "1 approved change blocks something that works today"
                  : disruptiveChosen.length + " approved changes block something that works today"}
                . Each one names what it breaks in its own row, and the report-only period where
                there is one.
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
            {dryGroups.map((g) => (
              <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "12px",
                    flexWrap: "wrap",
                    paddingBottom: "10px",
                    borderBottom: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>
                    {g.name}
                  </span>
                  <span style={{ fontSize: "11.5px", color: "#64748b" }}>{g.count}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "13px",
                      fontWeight: 800,
                      color: "#94a3b8",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {g.price}
                  </span>
                </div>
                {g.items.map((a) => {
                  const skipped = a.satisfied;
                  const dropped = !!st.dryOff[a.id];
                  const live = !skipped && !dropped;
                  const tone = IMPACT_TONE[a.impact];
                  return (
                    <div
                      key={a.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "20px minmax(0,1fr) 118px",
                        gap: "14px",
                        alignItems: "start",
                        padding: "13px 15px",
                        borderRadius: "12px",
                        transition: "border-color 180ms,background 180ms",
                        border: skipped
                          ? "1px solid rgba(30,41,59,.7)"
                          : live
                            ? "1px solid rgba(30,41,59,.95)"
                            : "1px solid rgba(30,41,59,.6)",
                        background: live ? "rgba(11,21,36,.66)" : "rgba(2,6,23,.34)",
                        opacity: live ? 1 : 0.62,
                      }}
                    >
                      <span
                        data-testid={`buy-dry-toggle-${a.id}`}
                        onClick={() => toggleAction(a.id)}
                        style={{
                          flex: "none",
                          marginTop: "1px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "5px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: 800,
                          color: "#fff",
                          cursor: skipped || liveMode ? "default" : "pointer",
                          border: live ? "1px solid #3b82f6" : "1px solid rgba(100,116,139,.6)",
                          background: live ? "#3b82f6" : "transparent",
                        }}
                      >
                        {live ? "✓" : ""}
                      </span>
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            lineHeight: 1.35,
                            color: live ? "#f8fafc" : "#94a3b8",
                            textDecoration: dropped ? "line-through" : "none",
                          }}
                        >
                          {a.title}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                            fontSize: "11.5px",
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ color: "#64748b" }}>{a.touches}</span>
                          <span style={{ color: "#475569" }}>·</span>
                          <span style={{ color: "#94a3b8" }}>{a.from}</span>
                          <span style={{ color: "#475569" }}>→</span>
                          <span style={{ color: "#7dd3fc" }}>{a.to}</span>
                        </span>
                        {a.note && live && (
                          <span style={{ fontSize: "11.5px", color: "#fbbf24", lineHeight: 1.55 }}>
                            {a.note}
                          </span>
                        )}
                        <span style={{ fontSize: "10.5px", color: "#475569" }}>
                          {a.reversible ? "Reversible from the Portal" : "Not reversible"}
                        </span>
                      </span>
                      <span
                        style={{
                          justifySelf: "end",
                          textAlign: "center",
                          whiteSpace: "nowrap",
                          padding: "3px 9px",
                          borderRadius: "999px",
                          fontSize: "9.5px",
                          fontWeight: 800,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          border: skipped
                            ? "1px solid rgba(52,211,153,.4)"
                            : dropped
                              ? "1px solid rgba(100,116,139,.4)"
                              : `1px solid ${tone[0]}66`,
                          color: skipped ? "#34d399" : dropped ? "#64748b" : tone[0],
                        }}
                      >
                        {skipped ? "Already true" : dropped ? "Deselected" : tone[1]}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "9px", paddingTop: "6px" }}>
            <span
              style={{
                fontSize: "9.5px",
                fontWeight: 800,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              When should this run
            </span>
            <div style={{ display: "flex", gap: "9px", flexWrap: "wrap" }}>
              {windows.map((w) => {
                const on = st.dryWindow === w.k;
                // Live mode runs at approval — scheduling is not wired to the
                // real engine yet, so the other windows are not selectable
                // rather than silently ignored (#1316).
                const unavailable = liveMode && w.k !== "now";
                return (
                  <button
                    key={w.k}
                    onClick={() => {
                      if (!unavailable) setWindow(w.k);
                    }}
                    style={{
                      flex: "1 1 170px",
                      textAlign: "left",
                      cursor: unavailable ? "not-allowed" : "pointer",
                      opacity: unavailable ? 0.45 : 1,
                      fontFamily: "inherit",
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px",
                      padding: "11px 13px",
                      borderRadius: "11px",
                      border: on ? "1px solid rgba(59,130,246,.5)" : "1px solid rgba(30,41,59,.9)",
                      background: on ? "rgba(59,130,246,.09)" : "rgba(11,21,36,.5)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 700,
                        color: on ? "#f8fafc" : "#cbd5e1",
                      }}
                    >
                      {w.label}
                    </span>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{w.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              position: "sticky",
              bottom: "16px",
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
              padding: "14px 18px",
              borderRadius: "14px",
              border: "1px solid rgba(59,130,246,.4)",
              background: "rgba(8,16,32,.94)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 18px 50px rgba(2,6,23,.6)",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span
                style={{
                  fontSize: "9.5px",
                  fontWeight: 800,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Approved
              </span>
              <span
                data-testid="buy-dry-approved"
                style={{
                  fontSize: "20px",
                  fontWeight: 800,
                  color: "#f8fafc",
                  letterSpacing: "-.02em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {chosen.length + " of " + all.length + " changes approved"}
              </span>
            </span>
            <span style={{ flex: 1, minWidth: "150px", fontSize: "11.5px", color: "#64748b", lineHeight: 1.5 }}>
              Deselected changes are never sent to Graph. Everything approved is logged in the
              Portal with a rollback point.
            </span>
            <button
              data-testid="buy-dry-execute"
              onClick={execute}
              disabled={chosen.length === 0}
              style={{
                flex: "none",
                padding: "12px 20px",
                border: 0,
                borderRadius: "10px",
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 700,
                color: "#fff",
                cursor: chosen.length ? "pointer" : "not-allowed",
                background: chosen.length ? gradientBtn : "rgba(71,85,105,.45)",
              }}
            >
              {"Run " + chosen.length + (chosen.length === 1 ? " approved change" : " approved changes")}
            </button>
          </div>
        </div>
      )}

      {/* ── Executing ────────────────────────────────────────────────────────────── */}
      {show.executing && (
        <div
          data-testid="buy-executing"
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "90px 32px 120px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <span style={{ ...eyebrow, color: "#60a5fa" }}>Applying your approved changes</span>
          <span
            style={{
              fontSize: "38px",
              fontWeight: 800,
              color: "#f8fafc",
              letterSpacing: "-.04em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {execDone} / {execTotal}
          </span>
          <span
            style={{
              width: "100%",
              height: "6px",
              borderRadius: "999px",
              background: "rgba(30,41,59,.9)",
              overflow: "hidden",
              display: "block",
            }}
          >
            <span
              style={{
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg,#3b82f6,#22d3ee)",
                transition: "width 380ms",
                width: execPct + "%",
                display: "block",
              }}
            />
          </span>
          <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.6 }}>{execNow}</span>
          <span style={{ fontSize: "11.5px", color: "#475569", lineHeight: 1.6 }}>
            Each write is executed in dependency order. If one fails, the run stops and everything
            before it is left in place with a rollback point.
          </span>
        </div>
      )}

      {/* ── Executed: the change record ──────────────────────────────────────────── */}
      {show.executed && (
        <div
          data-testid="buy-executed"
          style={{
            maxWidth: "1040px",
            margin: "0 auto",
            padding: "44px 32px 110px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            animation: "buyRise 460ms ease both",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            <span style={{ ...eyebrow, color: "#34d399" }}>
              Change record ·{" "}
              {liveMode && live.run.runIds.length
                ? live.run.runIds.map((id) => `Run #${id}`).join(" · ")
                : CR_ID}
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(22px,2.6vw,28px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.18,
                color: "#f8fafc",
              }}
            >
              {liveMode ? live.run.completed : chosen.length} changes applied. Here is every before
              and after.
            </h1>
            {liveMode && live.run.phase === "awaiting_verification" && (
              <p
                data-testid="buy-executed-gate-note"
                style={{ margin: 0, fontSize: "13px", lineHeight: 1.6, color: "#fbbf24" }}
              >
                This run is paused at the tenant-admin verification gate — the remaining changes
                apply after verification.
              </p>
            )}
            {liveMode && live.run.phase === "failed" && (
              <p
                data-testid="buy-executed-failed-note"
                style={{ margin: 0, fontSize: "13px", lineHeight: 1.6, color: "#f87171" }}
              >
                The run stopped at a failed step. Everything applied before it is left in place.
              </p>
            )}
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.68, color: "#94a3b8" }}>
              This is your record. Every change below carries the value your tenant held before and
              the value it holds now, alongside the ones you declined, which were never sent.
              Download it as a PDF or CSV for your auditor — each applied change keeps its prior
              value for rollback until {ROLLBACK_LONG}.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,minmax(0,1fr))",
              gap: "9px",
            }}
          >
            {[
              {
                label: "Applied",
                value: String(liveMode ? live.run.completed : chosen.length),
                fg: "#34d399",
              },
              { label: "Declined by you", value: String(declinedCount), fg: "#fbbf24" },
              { label: "Already correct", value: String(satisfiedCount), fg: "#94a3b8" },
            ].map((tile) => (
              <div
                key={tile.label}
                style={{
                  padding: "13px 14px",
                  borderRadius: "12px",
                  border: "1px solid rgba(30,41,59,.95)",
                  background: "rgba(11,21,36,.6)",
                }}
              >
                <div
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    marginBottom: "5px",
                  }}
                >
                  {tile.label}
                </div>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    color: tile.fg,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {tile.value}
                </div>
              </div>
            ))}
            <div
              style={{
                padding: "13px 14px",
                borderRadius: "12px",
                border: "1px solid rgba(30,41,59,.95)",
                background: "rgba(11,21,36,.6)",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: "5px",
                }}
              >
                Rollback until
              </div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#e2e8f0",
                  lineHeight: 1.4,
                  marginTop: "3px",
                }}
              >
                {ROLLBACK_SHORT}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {recordGroups.map((g) => (
              <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "12px",
                    flexWrap: "wrap",
                    paddingBottom: "9px",
                    borderBottom: "1px solid rgba(30,41,59,.9)",
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>
                    {g.name}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "12px",
                      fontWeight: 800,
                      color: "#94a3b8",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {g.price}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1.2fr) 104px",
                    gap: "12px",
                    padding: "8px 0 7px",
                    borderBottom: "1px solid rgba(30,41,59,.7)",
                  }}
                >
                  {["Setting", "Before", "After", "Result"].map((h, i) => (
                    <span
                      key={h}
                      style={{
                        fontSize: "9px",
                        fontWeight: 800,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        color: "#475569",
                        textAlign: i === 3 ? "right" : "left",
                      }}
                    >
                      {h}
                    </span>
                  ))}
                </div>
                {g.rows.map((r, i) => (
                  <div
                    key={g.key + i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1.2fr) 104px",
                      gap: "12px",
                      alignItems: "start",
                      padding: "11px 0",
                      borderBottom: "1px solid rgba(30,41,59,.55)",
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45 }}>
                      {r.setting}
                    </span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                      {r.before}
                    </span>
                    <span style={{ fontSize: "11.5px", lineHeight: 1.5, color: r.afterFg }}>
                      {r.after}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        textAlign: "right",
                        color: r.resultFg,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.result}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "14px 16px",
              borderRadius: "13px",
              border: "1px solid rgba(52,211,153,.25)",
              background: "rgba(52,211,153,.05)",
            }}
          >
            <span style={{ flex: "1 1 320px", minWidth: 0, fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6 }}>
              A read-only scan confirmed every applied value 20 minutes after the run. Two changes
              sit in a report-only period and are re-verified when they enforce.
            </span>
            <Link
              href={`/records/${CR_ID}`}
              style={{
                flex: "none",
                padding: "10px 16px",
                borderRadius: "9px",
                fontSize: "12px",
                fontWeight: 700,
                color: "#fff",
                background: gradientBtn,
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              Download as PDF
            </Link>
          </div>
          <div style={{ display: "flex", gap: "11px", flexWrap: "wrap", alignItems: "center" }}>
            <Link
              href={`/records/${CR_ID}`}
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 700,
                color: "#fff",
                background: gradientBtn,
                textDecoration: "none",
              }}
            >
              Open your change record
            </Link>
            <a
              href="/portal"
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#cbd5e1",
                border: "1px solid rgba(148,163,184,.22)",
                textDecoration: "none",
              }}
            >
              Or tour the Portal
            </a>
          </div>
          <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>
            The change record is a document, not a dashboard: every before and after value, the
            accounts affected, what you declined, and the rollback window. Print it or save it as
            PDF for your auditor.
          </span>
        </div>
      )}

      {/* ── Done (portal handoff) ────────────────────────────────────────────────── */}
      {show.done && (
        <div
          data-testid="buy-done"
          style={{
            maxWidth: "660px",
            margin: "0 auto",
            padding: "64px 32px 96px",
            display: "flex",
            flexDirection: "column",
            gap: "26px",
            animation: "buyRise 520ms ease both",
          }}
        >
          <span
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "rgba(52,211,153,.12)",
              border: "1px solid rgba(52,211,153,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#34d399",
            }}
          >
            <IconCheck size={20} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(25px,3.2vw,34px)",
                fontWeight: 800,
                letterSpacing: "-.03em",
                lineHeight: 1.15,
                color: "#f8fafc",
              }}
            >
              {done.title}
            </h1>
            <p style={{ margin: 0, maxWidth: "58ch", fontSize: "15px", lineHeight: 1.65, color: "#94a3b8" }}>
              {done.body}
            </p>
          </div>
          <div
            style={{
              border: "1px solid rgba(30,41,59,.95)",
              borderRadius: "14px",
              background: "#0b1524",
              padding: "19px 21px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <span style={{ ...eyebrow, color: "#64748b" }}>In your Portal</span>
            {done.next.map((dn) => (
              <span key={dn.when} style={{ display: "flex", gap: "13px", alignItems: "baseline" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    color: "#22d3ee",
                    flex: "none",
                    width: "66px",
                  }}
                >
                  {dn.when}
                </span>
                <span style={{ fontSize: "13px", lineHeight: 1.6, color: "#94a3b8" }}>{dn.text}</span>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <a
              href="/portal"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "13px 24px",
                borderRadius: "11px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
                background: gradientBtn,
                textDecoration: "none",
              }}
            >
              Open your Portal <IconArrow />
            </a>
            <Link href="/" style={{ fontSize: "13px", fontWeight: 600, color: "#60a5fa" }}>
              Back to the site
            </Link>
          </div>
        </div>
      )}

      {/* ── Processing overlay ───────────────────────────────────────────────────── */}
      {show.processing && (
        <div
          data-testid="buy-processing"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(2,6,23,.86)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                border: "2px solid rgba(51,65,85,.9)",
                borderTopColor: "#3b82f6",
                animation: spinAnim,
              }}
            />
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#94a3b8" }}>
              {processingLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
