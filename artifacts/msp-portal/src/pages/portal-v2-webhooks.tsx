/**
 * portal-v2-webhooks.tsx — Webhooks (Part 12).
 *
 * Ported from the prototype's `isWebhooks` block (Customer Portal Shell.dc.html
 * 2520-2719) and its render values (15383-15475, 19690-19708), transcribed into
 * webhooksData.ts / webhooksModel.ts.
 *
 * ── Same taxonomy as Alert preferences ──────────────────────────────────────
 * The catalogue events key off the Alert preferences categories: one taxonomy,
 * two delivery surfaces. The wire name is what lands in the payload.
 *
 * ── UI-only, expand/collapse is real ────────────────────────────────────────
 * Row expansion, the docs disclosure and the per-endpoint "test event sent"
 * confirmation are the design's own local state and are wired.
 *
 * ── Rotate / Edit / Delete are wired (Git #1605) ────────────────────────────
 * Rotate secret, Edit endpoint, Edit subscription and Delete now call their
 * real, already-live backend routes (`webhooks.ts` — rotate-secret, PATCH,
 * DELETE; see `docs/webhooks-contract-pack.md` §2), each behind a real
 * confirmation naming the actual consequence (no grace period on rotate; the
 * delivery-history cascade on delete) and surfacing that route's own error
 * shape on failure — see `RotateSecretPanel.tsx` / `DeleteWebhookPanel.tsx` /
 * `webhooksMutations.ts`. They're disabled whenever the page is showing the
 * design fixture (`dataState !== "live"`) rather than a real fetched row, so a
 * click can never target a fixture id that doesn't exist server-side.
 * Reveal and Replay remain inert — both are real, documented backend gaps
 * (no reveal-after-creation endpoint; no replay endpoint at all), not a
 * wiring gap in this page. Pause/Resume is also left inert: it is the same
 * PATCH `isActive` this pass already wires for Edit endpoint, but toggling it
 * from its own dedicated button was not in #1605's scope.
 */

import { useState } from "react";
import { Link } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { RotateSecretPanel, type RotateSecretSpec } from "@/components/portal-v2/RotateSecretPanel";
import { DeleteWebhookPanel, type DeleteWebhookSpec } from "@/components/portal-v2/DeleteWebhookPanel";
import { useWebhookMutations } from "@/components/portal-v2/webhooksMutations";
import {
  WH_CATALOGUE_HEADERS,
  WH_CATALOGUE_KICKER,
  WH_DELETE,
  WH_DOCS_KICKER,
  WH_DOCS_SUB,
  WH_EDIT_ENDPOINT,
  WH_EDIT_SUBSCRIPTION,
  WH_ENDPOINTS_KICKER,
  WH_RECENT_DELIVERIES,
  WH_RETRY_FACTS,
  WH_REVEAL,
  WH_ROTATE,
  WH_SAMPLE_KICKER,
  WH_SAMPLE_PAYLOAD,
  WH_SEND_TEST,
  WH_SIGNING_SECRET,
  WH_SUBSCRIBED_EVENTS,
  WH_SUBTITLE,
  WH_TARGET_RETRIES,
  WH_TEST_SENT_BODY_POST,
  WH_TEST_SENT_BODY_PRE,
  WH_TEST_SENT_KICKER,
  WH_TEST_SENT_TYPE,
  WH_TITLE,
  WH_VERIFY_COPY,
  WH_VERIFY_DOCS,
  WH_VERIFY_KICKER,
  WH_VERIFY_STEPS,
  WH_VERIFY_SUB,
  WH_VIEW_FULL_LOG,
  type Webhook,
} from "@/components/portal-v2/webhooksData";
import {
  whBannerBody,
  whBannerTitle,
  whDeliveryColor,
  whEventCatalogue,
  whHasFailing,
  whPauseLabel,
  whReplayLabel,
  whStateMeta,
} from "@/components/portal-v2/webhooksModel";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import { useWebhooksLive } from "@/components/portal-v2/webhooksLive";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import {
  liveBannerBody,
  liveBannerTitle,
  liveEventCatalogue,
  liveHasFailing,
  liveReplayLabel,
  type LiveEndpoint,
} from "@/components/portal-v2/webhooksWire";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
      {children}
    </span>
  );
}

function Chevron({ deg, size = 13 }: { deg: number; size?: number }) {
  return (
    <span style={{ display: "flex", transform: `rotate(${deg}deg)`, transition: "transform 180ms" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

function InlineBtn({
  children,
  tone = "muted",
  onClick,
  disabled,
  testId,
}: {
  children: React.ReactNode;
  tone?: "muted" | "gold" | "blue" | "red";
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const map = {
    muted: { border: "rgba(148,163,184,.22)", bg: "transparent", color: "#94a3b8" },
    gold: { border: "rgba(194,166,61,.35)", bg: "rgba(194,166,61,.08)", color: "#c2a63d" },
    blue: { border: "rgba(0,120,212,.45)", bg: "rgba(0,120,212,.12)", color: "#60a5fa" },
    red: { border: "rgba(248,113,113,.35)", bg: "transparent", color: "#f87171" },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        padding: "4px 10px",
        borderRadius: 5,
        border: `1px solid ${map.border}`,
        background: map.bg,
        fontSize: "10.5px",
        fontWeight: 600,
        color: map.color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

/* ── One endpoint row — proto 2554-2648 ────────────────────────────────────── */

function EndpointRow({
  w,
  chips,
  eventCountLabel,
  index,
  expanded,
  onToggle,
  testShown,
  onTest,
  isLive,
  onRotate,
  onEditEndpoint,
  onEditSubscription,
  onDelete,
}: {
  w: Webhook;
  chips: readonly string[];
  eventCountLabel: string;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  testShown: boolean;
  onTest: () => void;
  /** Mutations only target a real, live-fetched webhookId — never a fixture row. */
  isLive: boolean;
  onRotate: () => void;
  onEditEndpoint: () => void;
  onEditSubscription: () => void;
  onDelete: () => void;
}) {
  const meta = whStateMeta(w);
  const failing = w.state === "failing";
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderTop: index === 0 ? "none" : "1px solid rgba(30,41,59,.85)",
        opacity: w.state === "paused" ? 0.7 : 1,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `${meta.c}${failing ? "cc" : "66"}` }} />
      <button
        type="button"
        onClick={onToggle}
        data-testid={`pv2-wh-row-${w.id}`}
        aria-expanded={expanded}
        style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 16px", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
      >
        <span style={{ flex: "0 0 auto", marginTop: 3 }}>
          <Chevron deg={expanded ? 180 : -90} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{w.name}</span>
            <span style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 5, border: `1px solid ${meta.c}55`, background: `${meta.c}14`, fontSize: "9.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: meta.c, whiteSpace: "nowrap" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: meta.c, flex: "0 0 5px" }} />
              {meta.label}
            </span>
            <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>{w.id}</span>
          </div>
          <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45, wordBreak: "break-all", fontFamily: MONO }}>{w.url}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{w.lastDelivery}</span>
            <span style={{ fontSize: "10.5px", color: "#475569" }}>·</span>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{eventCountLabel}</span>
          </div>
        </div>
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: meta.c, fontFamily: MONO }}>{w.successRate}</span>
          <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>{w.volume}</span>
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 16px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          {w.failure && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                border: `1px solid ${failing ? "rgba(248,113,113,.4)" : "rgba(194,166,61,.35)"}`,
                borderLeft: `2px solid ${failing ? "#f87171" : "#c2a63d"}`,
                borderRadius: 9,
                background: failing ? "rgba(248,113,113,.07)" : "rgba(194,166,61,.06)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: failing ? "#f87171" : "#c2a63d" }}>
                {w.failure.code} · {w.failure.count} affected · {w.failure.since}
              </span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>{w.failure.reason}</span>
              <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{w.failure.next}</span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#64748b" }}>{WH_SUBSCRIBED_EVENTS}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {chips.map((c) => (
                  <span key={c} style={{ flex: "0 0 auto", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(96,165,250,.3)", background: "rgba(96,165,250,.08)", fontSize: "10px", fontWeight: 600, color: "#93c5fd", whiteSpace: "nowrap", fontFamily: MONO }}>{c}</span>
                ))}
              </div>
              <span style={{ alignSelf: "flex-start" }}>
                <InlineBtn
                  onClick={onEditSubscription}
                  disabled={!isLive}
                  testId={`pv2-wh-edit-subscription-${w.id}`}
                >
                  {WH_EDIT_SUBSCRIPTION}
                </InlineBtn>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#64748b" }}>{WH_SIGNING_SECRET}</span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", fontFamily: MONO }}>{w.secretHint}</span>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>{w.rotated}</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <InlineBtn>{WH_REVEAL}</InlineBtn>
                <InlineBtn tone="gold" onClick={onRotate} disabled={!isLive} testId={`pv2-wh-rotate-${w.id}`}>
                  {WH_ROTATE}
                </InlineBtn>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#64748b" }}>{WH_TARGET_RETRIES}</span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.5 }}>{w.target}</span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45 }}>{w.retries}</span>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>Created {w.created}</span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#64748b" }}>{WH_RECENT_DELIVERIES}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 9, background: "#0b1524", overflow: "hidden" }}>
              {w.recent.map((d, di) => {
                const c = whDeliveryColor(d);
                return (
                  <div key={di} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1.6fr) minmax(0,.8fr) minmax(0,.5fr) minmax(0,.55fr)", gap: 8, padding: "8px 12px", borderBottom: "1px solid rgba(30,41,59,.7)", alignItems: "center" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, flex: "0 0 5px" }} />
                    <span style={{ minWidth: 0, fontSize: "11px", color: "#e2e8f0", fontFamily: MONO, overflowWrap: "anywhere" }}>{d.event}</span>
                    <span style={{ minWidth: 0, fontSize: "10.5px", color: "#64748b", overflowWrap: "anywhere" }}>{d.when}</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: c, textAlign: "right", fontFamily: MONO }}>{d.code}</span>
                    <span style={{ minWidth: 0, fontSize: "10.5px", color: "#64748b", textAlign: "right", fontFamily: MONO, overflowWrap: "anywhere" }}>{d.ms} ms</span>
                  </div>
                );
              })}
              <div style={{ padding: "8px 12px" }}>
                <button type="button" style={{ padding: 0, background: "none", border: "none", fontSize: "10.5px", fontWeight: 600, color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}>{WH_VIEW_FULL_LOG}</button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid rgba(30,41,59,.8)" }}>
            <button
              type="button"
              onClick={onTest}
              data-testid={`pv2-wh-test-${w.id}`}
              style={{ marginTop: 10, padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(0,120,212,.45)", background: "rgba(0,120,212,.12)", fontSize: "11.5px", fontWeight: 700, color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}
            >
              {WH_SEND_TEST}
            </button>
            <button type="button" style={{ marginTop: 10, padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}>{whPauseLabel(w)}</button>
            <button
              type="button"
              onClick={onEditEndpoint}
              disabled={!isLive}
              data-testid={`pv2-wh-edit-endpoint-${w.id}`}
              style={{ marginTop: 10, padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8", cursor: isLive ? "pointer" : "not-allowed", opacity: isLive ? 1 : 0.5, fontFamily: "inherit" }}
            >
              {WH_EDIT_ENDPOINT}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={!isLive}
              data-testid={`pv2-wh-delete-${w.id}`}
              style={{ marginTop: 10, padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(248,113,113,.35)", background: "transparent", fontSize: "11.5px", fontWeight: 600, color: "#f87171", cursor: isLive ? "pointer" : "not-allowed", opacity: isLive ? 1 : 0.5, fontFamily: "inherit" }}
            >
              {WH_DELETE}
            </button>
          </div>

          {testShown && (
            <div data-testid={`pv2-wh-test-result-${w.id}`} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "11px 13px", border: "1px solid rgba(52,211,153,.35)", borderRadius: 9, background: "rgba(52,211,153,.06)" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#34d399" }}>{WH_TEST_SENT_KICKER}</span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55 }}>
                {WH_TEST_SENT_BODY_PRE}
                <span style={{ fontFamily: MONO }}>{WH_TEST_SENT_TYPE}</span>
                {WH_TEST_SENT_BODY_POST}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortalV2WebhooksPage() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [testFor, setTestFor] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const { endpoints, dataState, loading, refresh } = useWebhooksLive();
  const isLive = dataState === "live";

  const { updateWebhook, deleteWebhook, rotateSecret } = useWebhookMutations();
  const { openForm, formElement } = useFormDrawer();
  const [rotateSpec, setRotateSpec] = useState<RotateSecretSpec | null>(null);
  const [deleteSpec, setDeleteSpec] = useState<DeleteWebhookSpec | null>(null);
  // Edit (both "Edit endpoint" and "Edit subscription") goes through
  // FormDrawer's fire-and-flip-to-done pattern (same as every other form in
  // the portal, see FormDrawer.tsx) — the write happens in the background and
  // only a real failure surfaces here, echoing portal-v2-risk-register.tsx's
  // `acceptError` banner for the same reason: FormDrawer's own "done" view is
  // decided before the response comes back, so it can't show a real failure.
  const [editError, setEditError] = useState<string | null>(null);

  function openEditEndpoint(ep: LiveEndpoint) {
    const isActive = ep.webhook.state !== "paused";
    openForm({
      kicker: "Edit endpoint",
      title: `Edit ${ep.webhook.name}`,
      intro: "Update the label, target URL, or pause deliveries to this endpoint.",
      submitLabel: "Save changes",
      fields: [
        { id: "label", label: "Label", value: ep.webhook.name, hint: "Shown only inside this portal." },
        { id: "url", label: "Endpoint URL", value: ep.webhook.url, wide: true, hint: "Must start with http:// or https://." },
        {
          id: "isActive",
          label: "Delivery status",
          kind: "select",
          value: isActive ? "active" : "paused",
          options: [
            { value: "active", label: "Active — deliveries enabled" },
            { value: "paused", label: "Paused — deliveries stopped" },
          ],
        },
      ],
      doneNote: "Saving now. If the change doesn't take, an error banner appears at the top of the page.",
      onSubmit: (values) => {
        void updateWebhook(ep.webhook.id, {
          label: (values.label ?? "").trim(),
          url: (values.url ?? "").trim(),
          isActive: values.isActive === "active",
        }).then((result) => {
          if (result.ok) {
            setEditError(null);
            refresh();
          } else {
            setEditError(result.error);
          }
        });
      },
    });
  }

  function openEditSubscription(ep: LiveEndpoint) {
    openForm({
      kicker: "Edit subscription",
      title: `Subscribed events — ${ep.webhook.name}`,
      intro:
        'The exact wire strings sent in each delivery payload\'s "type" field, comma- or line-separated. Not checked against a fixed catalogue — any non-empty string is accepted.',
      submitLabel: "Save subscription",
      fields: [
        {
          id: "eventTypes",
          label: "Subscribed event types",
          kind: "textarea",
          value: ep.chips.join(", "),
          wide: true,
          hint: 'Leave blank to subscribe to nothing — this field has no "all events" value.',
        },
      ],
      doneNote: "Saving now. If the change doesn't take, an error banner appears at the top of the page.",
      onSubmit: (values) => {
        const eventTypes = (values.eventTypes ?? "")
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        void updateWebhook(ep.webhook.id, { eventTypes }).then((result) => {
          if (result.ok) {
            setEditError(null);
            refresh();
          } else {
            setEditError(result.error);
          }
        });
      },
    });
  }

  const catalogue = isLive ? liveEventCatalogue(endpoints) : whEventCatalogue();
  const hasFailing = isLive ? liveHasFailing(endpoints) : whHasFailing();
  const bannerTitle = isLive ? liveBannerTitle(endpoints) : whBannerTitle();
  const bannerBody = isLive ? liveBannerBody(endpoints) : whBannerBody();
  const replayLabel = isLive ? liveReplayLabel(endpoints) : whReplayLabel();

  return (
    <PortalV2Shell eyebrow="Account" title={WH_TITLE}>
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          data-testid="pv2-webhooks"
          style={{
            position: "relative",
            maxWidth: 1320,
            margin: "0 auto",
            padding: "26px 26px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          <Link
            href="/portal-v2"
            data-testid="pv2-wh-back"
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontFamily: "inherit", textDecoration: "none" }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Overview
          </Link>

          {/* Header — proto 2527-2535 */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid rgba(30,41,59,.9)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span data-testid="pv2-page-title" style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}>{WH_TITLE}</span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "80ch" }}>{WH_SUBTITLE}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{endpoints.length} endpoints</span>
              <span data-testid="pv2-wh-source" style={PV2_SOURCE_CLIP}>{dataState}</span>
            </div>
          </div>

          {/* Edit-failure banner — real error surfaced from PATCH, Git #1605 */}
          {editError && (
            <div
              data-testid="pv2-wh-edit-error"
              style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", border: "1px solid rgba(248,113,113,.4)", borderLeft: "3px solid #f87171", borderRadius: 10, background: "rgba(248,113,113,.08)" }}
            >
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#fca5a5" }}>Could not save changes</span>
                <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.5 }}>{editError}</span>
              </div>
              <button
                type="button"
                onClick={() => setEditError(null)}
                aria-label="Dismiss"
                style={{ flex: "0 0 auto", background: "none", border: "none", padding: 2, cursor: "pointer", color: "#94a3b8", fontSize: "13px", fontFamily: "inherit" }}
              >
                ×
              </button>
            </div>
          )}

          {/* Failing banner — proto 2537-2548 */}
          {hasFailing && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", border: "1px solid rgba(248,113,113,.45)", borderLeft: "3px solid #f87171", borderRadius: 11, background: "rgba(248,113,113,.08)" }}>
              <span className="pv2-slow-pulse" style={{ flex: "0 0 7px", width: 7, height: 7, borderRadius: "50%", background: "#f87171", marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <span data-testid="pv2-wh-banner" style={{ fontSize: "12.5px", fontWeight: 700, color: "#fca5a5" }}>{bannerTitle}</span>
                <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{bannerBody}</span>
              </div>
              <div style={{ flex: "0 0 auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={{ padding: "6px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700, border: "1px solid rgba(248,113,113,.5)", background: "rgba(248,113,113,.14)", color: "#fca5a5", cursor: "pointer", fontFamily: "inherit" }}>{replayLabel}</button>
              </div>
            </div>
          )}

          <div className="pv2-gov-grid">
            {/* Left column — endpoints + catalogue */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <Kicker>{WH_ENDPOINTS_KICKER}</Kicker>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
                {loading ? (
                  // Real read in flight: honest skeleton, never the design's
                  // fixture endpoints swapping in after the fact (Git #1365).
                  <div style={{ padding: "14px 16px" }}>
                    <PortalV2LoadingState rows={3} label="Loading your webhook endpoints…" testId="pv2-wh-loading" />
                  </div>
                ) : (
                  endpoints.map((ep, i) => (
                    <EndpointRow
                      key={ep.webhook.id}
                      w={ep.webhook}
                      chips={ep.chips}
                      eventCountLabel={ep.eventCountLabel}
                      index={i}
                      expanded={expanded === i}
                      onToggle={() => setExpanded((e) => (e === i ? null : i))}
                      testShown={testFor === ep.webhook.id}
                      onTest={() => setTestFor(ep.webhook.id)}
                      isLive={isLive}
                      onRotate={() => setRotateSpec({ webhookId: ep.webhook.id, webhookName: ep.webhook.name })}
                      onEditEndpoint={() => openEditEndpoint(ep)}
                      onEditSubscription={() => openEditSubscription(ep)}
                      onDelete={() =>
                        setDeleteSpec({ webhookId: ep.webhook.id, webhookName: ep.webhook.name, volumeLabel: ep.webhook.volume })
                      }
                    />
                  ))
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                <Kicker>{WH_CATALOGUE_KICKER}</Kicker>
                <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,.9fr) minmax(0,.7fr)", gap: 10, padding: "9px 16px", borderBottom: "1px solid rgba(30,41,59,.9)", background: "rgba(96,165,250,.05)" }}>
                    {WH_CATALOGUE_HEADERS.map((h, hi) => (
                      <span key={h} style={{ minWidth: 0, fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b", textAlign: hi === 3 ? "right" : "left" }}>{h}</span>
                    ))}
                  </div>
                  {catalogue.map((e) => (
                    <div key={e.wire} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,.9fr) minmax(0,.7fr)", gap: 10, padding: "8px 16px", borderBottom: "1px solid rgba(30,41,59,.8)", alignItems: "baseline" }}>
                      <span style={{ minWidth: 0, fontSize: "11px", fontWeight: 700, color: "#93c5fd", fontFamily: MONO, overflowWrap: "anywhere" }}>{e.wire}</span>
                      <span style={{ minWidth: 0, fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45, overflowWrap: "anywhere", textWrap: "pretty" }}>{e.label}</span>
                      <span style={{ minWidth: 0, fontSize: "11px", color: "#64748b", lineHeight: 1.45, overflowWrap: "anywhere", textWrap: "pretty" }}>{e.from}</span>
                      <span style={{ minWidth: 0, fontSize: "11px", color: "#94a3b8", textAlign: "right", fontFamily: MONO, overflowWrap: "anywhere" }}>{e.subscribed}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column — verify / sample / behaviour */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(0,120,212,.3)", borderRadius: 12, background: "rgba(0,120,212,.05)", overflow: "hidden" }}>
                <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(0,120,212,.16)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#60a5fa" }}>{WH_VERIFY_KICKER}</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>{WH_VERIFY_SUB}</span>
                </div>
                {WH_VERIFY_STEPS.map((v) => (
                  <div key={v.k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 14px", borderBottom: "1px solid rgba(0,120,212,.1)" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#60a5fa" }}>{v.k}</span>
                    <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{v.v}</span>
                  </div>
                ))}
                <div style={{ padding: "11px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" style={{ padding: "6px 11px", borderRadius: 6, border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.12)", fontSize: "11px", fontWeight: 700, color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}>{WH_VERIFY_COPY}</button>
                  <button type="button" style={{ padding: "6px 11px", borderRadius: 6, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "11px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}>{WH_VERIFY_DOCS}</button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.4)", overflow: "hidden" }}>
                <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                  <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>{WH_SAMPLE_KICKER}</span>
                </div>
                <pre style={{ margin: 0, padding: "12px 14px", fontSize: "10.5px", lineHeight: 1.6, color: "#cbd5e1", fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#0b1524" }}>{WH_SAMPLE_PAYLOAD}</pre>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.4)", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setDocsOpen((o) => !o)}
                  data-testid="pv2-wh-docs-toggle"
                  aria-expanded={docsOpen}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
                >
                  <span style={{ flex: "0 0 auto" }}>
                    <Chevron deg={docsOpen ? 180 : -90} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>{WH_DOCS_KICKER}</span>
                    <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>{WH_DOCS_SUB}</span>
                  </span>
                </button>
                {docsOpen && (
                  <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 0 }}>
                    {WH_RETRY_FACTS.map((r) => (
                      <div key={r.k} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "8px 0", borderBottom: "1px solid rgba(30,41,59,.75)" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>{r.k}</span>
                        <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.5, textWrap: "pretty" }}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {formElement}

      {rotateSpec && (
        <RotateSecretPanel
          spec={rotateSpec}
          onClose={() => setRotateSpec(null)}
          onConfirm={async (id) => {
            const result = await rotateSecret(id);
            if (result.ok) refresh();
            return result;
          }}
        />
      )}

      {deleteSpec && (
        <DeleteWebhookPanel
          spec={deleteSpec}
          onClose={() => setDeleteSpec(null)}
          onConfirm={(id) => deleteWebhook(id)}
          onDeleted={refresh}
        />
      )}
    </PortalV2Shell>
  );
}
