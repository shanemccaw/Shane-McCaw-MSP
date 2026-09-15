/**
 * Consent and Onboarding — MSP-wide (Operations) module page (Git #2627,
 * Feature #2563). Mounts at `/ops/consent`
 * (`Design/MSP_Console/design_handoff_msp_console/Consent and Onboarding.dc.html`,
 * README screen 64). See `@/api/consent-onboarding-api.ts` for the full real
 * route map and the note on where this build diverges from the design's own
 * copy (two of #2818's findings have since been fixed server-side).
 *
 * Two tabs: consent grants per tenant (read / write-back / SharePoint — each
 * granted, revoked, declined or never started) and onboarding links this MSP
 * has issued. `GET /api/msp/consent` drops every tenant with three empty
 * grants, so an MSP whose customers have not consented sees an empty array —
 * the empty state below says exactly that, not a generic "no data."
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import { useDirectory } from "@/api/console-api";
import {
  useConsentList, useConsentDetail, useCreateReadConsentInvite, useStartWriteConsent,
  useStartSharepointConsent, useRevokeConsent, useOnboardingLinks,
  type ConsentGrant, type ConsentKey, type ConsentTenantRow, type OnboardingLink,
} from "@/api/consent-onboarding-api";

type Tab = "consent" | "links";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok, amber: signal.warning, red: signal.critical, blue: signal.info,
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};
const STATUS_TONE: Record<string, keyof typeof TONE> = {
  granted: "green", pending: "amber", declined: "red", revoked: "slate", none: "slate",
};
const KEYS: { key: ConsentKey; eyebrow: string; title: string }[] = [
  { key: "graph", eyebrow: "READ ACCESS · graph", title: "Reading the tenant" },
  { key: "writeBack", eyebrow: "WRITE-BACK · writeBack", title: "Writing changes into the tenant" },
  { key: "sharepoint", eyebrow: "SHAREPOINT · sharepoint", title: "Publishing documents to their SharePoint" },
];
const SHORT: Record<ConsentKey, string> = { graph: "Read", writeBack: "Write-back", sharepoint: "SharePoint" };

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: { strong: string; text: string; tint: string; border: string }, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 5, padding: "0 9px", height: 20, borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function emptyState(icon: string, title: string, body: string) {
  return (
    <div style={{ border: `1px dashed ${border.card}`, borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
      <Icon name={icon} size={18} color={text.faint} />
      <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>{title}</span>
      <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 360, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}
function primaryBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 30, padding: "0 12px",
    borderRadius: 6, border: `1px solid ${disabled ? border.card : action.base}`, background: disabled ? "transparent" : action.base,
    color: disabled ? text.faint : "#fff", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
  };
}
function ghostBtn(disabled?: boolean): React.CSSProperties {
  return {
    height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${border.card}`,
    background: "transparent", color: disabled ? text.faint : text.secondary, fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function labelSpan(): React.CSSProperties { return { fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }; }

// ── Root ──────────────────────────────────────────────────────────────────────

export function ConsentOnboarding() {
  const [tab, setTab] = useState<Tab>("consent");

  const listQuery = useConsentList();
  const listed = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const linksQuery = useOnboardingLinks();
  const links = linksQuery.data ?? [];

  const tabDefs: { id: Tab; label: string; count: number }[] = [
    { id: "consent", label: "Consent grants", count: listed.length },
    { id: "links", label: "Onboarding links", count: links.length },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {tabDefs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
                border: `1px solid ${on ? "rgba(96,165,250,.45)" : border.card}`, background: on ? "rgba(37,99,235,.18)" : "transparent",
                color: on ? "#f1f5f9" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: on ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {tab === "consent" && <ConsentTab listed={listed} loading={listQuery.isLoading} error={listQuery.isError} />}
      {tab === "links" && <LinksTab links={links} loading={linksQuery.isLoading} error={linksQuery.isError} />}
    </div>
  );
}

// ── Consent tab ────────────────────────────────────────────────────────────────

function ConsentTab({ listed, loading, error }: { listed: ConsentTenantRow[]; loading: boolean; error: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const directory = useDirectory();
  const allCustomers = directory.data?.customers ?? [];
  const hidden = useMemo(() => {
    const listedIds = new Set(listed.map((t) => t.customerId));
    return allCustomers.filter((c) => !listedIds.has(c.id));
  }, [allCustomers, listed]);

  useEffect(() => {
    if (openId == null && listed.length > 0) setOpenId(listed[0]!.customerId);
    if (openId != null && listed.length > 0 && !listed.some((t) => t.customerId === openId)) setOpenId(listed[0]!.customerId);
  }, [listed, openId]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Tenants that have started at least one consent flow</span>
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
            {loading ? "Loading…" : listed.length + " listed · scoped to your MSP · the row's updated date is the tenant's, not any one grant's"}
          </span>
        </div>

        {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading consent grants…</span> :
         error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load consent grants.</span> :
         listed.length === 0 ? emptyState(
            "shield-alert", "No tenant has started a consent flow",
            "The list route drops every tenant with three empty grants, so an MSP whose customers have not yet consented to anything sees an empty array here — not the customers with nothing against them.",
          ) :
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {listed.map((t) => <TenantRow key={t.customerId} tenant={t} open={t.customerId === openId} onSelect={() => setOpenId(t.customerId)} />)}
          </div>}

        {hidden.length > 0 && (
          <div style={{ border: `1px dashed ${border.card}`, borderRadius: 10, background: "rgba(2,6,23,.3)", padding: "11px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: text.muted }}>
              {hidden.length} more tenant{hidden.length === 1 ? "" : "s"} in your book {hidden.length === 1 ? "is" : "are"} not in this list
            </span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
              {hidden.map((h) => h.name).join(", ")} — never started any of the three flows, so the list route drops {hidden.length === 1 ? "it" : "them"} entirely.
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {openId == null ? emptyState("shield-alert", "Pick a tenant", "Read access, write-back and SharePoint are three separate grants with their own dates.") :
          <TenantDetail customerId={openId} />}
      </div>
    </div>
  );
}

function TenantRow({ tenant, open, onSelect }: { tenant: ConsentTenantRow; open: boolean; onSelect: () => void }) {
  const grants = KEYS.map((k) => {
    const g = tenant[k.key];
    const tone = TONE[STATUS_TONE[g ? g.consentStatus : "none"]]!;
    return { key: k.key, label: `${SHORT[k.key]} · ${g ? g.consentStatus : "never started"}`, tone };
  });
  return (
    <button onClick={onSelect} style={{
      display: "flex", flexDirection: "column", gap: 8, textAlign: "left", border: `1px solid ${open ? "rgba(96,165,250,.4)" : border.soft}`,
      borderRadius: 10, background: open ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer", minWidth: 0,
    }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 120 }}>{tenant.customerName}</span>
        <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>row updated {fmtDate(tenant.updatedAt)}</span>
      </span>
      <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.faint, wordBreak: "break-all" }}>{tenant.tenantId}</span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {grants.map((g) => <span key={g.key} style={pill(g.tone)}>{g.label}</span>)}
      </span>
    </button>
  );
}

function TenantDetail({ customerId }: { customerId: number }) {
  const detail = useConsentDetail(customerId);
  const [ttl, setTtl] = useState("72");
  const [result, setResult] = useState<{ text: string; tone: keyof typeof TONE; url?: string; expiresAt?: string; scopes?: string[] } | null>(null);

  const readInvite = useCreateReadConsentInvite(customerId);
  const writeStart = useStartWriteConsent(customerId);
  const sharepointStart = useStartSharepointConsent(customerId);
  const revoke = useRevokeConsent(customerId);

  if (detail.isLoading) return <div style={cardStyle({ padding: 20 })}><span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span></div>;
  if (detail.isError || !detail.data) return <div style={cardStyle({ padding: 20 })}><span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load this tenant's consent detail.</span></div>;
  const t = detail.data;

  function mint(key: ConsentKey) {
    setResult(null);
    if (key === "graph") {
      const raw = parseInt(ttl, 10);
      const clamped = Math.min(Math.max(isNaN(raw) ? 72 : raw, 1), 168);
      readInvite.mutate(clamped, {
        onSuccess: (r) => setResult({ text: `Single-use token, valid ${clamped} hours.`, tone: "blue", url: r.consentUrl, expiresAt: r.expiresAt, scopes: r.scopes }),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to mint invite"),
      });
    } else if (key === "writeBack") {
      writeStart.mutate(undefined, {
        onSuccess: (r) => setResult({ text: "Single-use token, valid 72 hours (fixed).", tone: "blue", url: r.consentUrl, expiresAt: r.expiresAt }),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to mint invite"),
      });
    } else {
      sharepointStart.mutate(undefined, {
        onSuccess: (r) => setResult({ text: "Single-use token, valid 72 hours (fixed).", tone: "blue", url: r.consentUrl, expiresAt: r.expiresAt, scopes: r.permissions }),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to mint invite"),
      });
    }
  }

  function doRevoke(key: ConsentKey) {
    setResult(null);
    revoke.mutate(key, {
      onSuccess: () => { toast.success(`${SHORT[key]} consent revoked`); setResult({ text: "Stamped revoked with a server-side timestamp. The scopes stay on the record as history of what was held.", tone: "red" }); },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revoke"),
    });
  }

  const minting = readInvite.isPending || writeStart.isPending || sharepointStart.isPending;

  return (
    <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: text.strong }}>{t.customerName}</span>
        <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.faint, wordBreak: "break-all" }}>{t.tenantId}</span>
        <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>One row, three independent grants. The detail route never hides a tenant — a customer who has consented to nothing comes back with all three empty.</span>
      </div>

      {KEYS.map((k) => {
        const g: ConsentGrant | null = t[k.key];
        const tone = TONE[STATUS_TONE[g ? g.consentStatus : "none"]]!;
        const canRevoke = !!g && g.consentStatus === "granted";
        return (
          <div key={k.key} style={{ border: `1px solid ${g?.consentStatus === "granted" ? signal.ok.border : border.soft}`, borderRadius: 11, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 150, flex: 1 }}>
                <span style={labelSpan()}>{k.eyebrow}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>{k.title}</span>
              </span>
              <span style={pill(tone, { height: 22, fontSize: 10.5 })}>{g ? g.consentStatus : "never started"}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
              <Fact label="CONSENTED" value={g?.consentedAt ?? "—"} present={!!g?.consentedAt} />
              <Fact label="REVOKED" value={g?.revokedAt ?? "—"} present={!!g?.revokedAt} negative />
              <Fact label="APPROVED BY" value={g?.adminDisplayName ?? g?.adminEmail ?? "—"} present={!!(g?.adminDisplayName || g?.adminEmail)} />
            </div>

            {g && g.grants.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {g.grants.map((s) => <span key={s} style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: "rgba(148,163,184,.06)", border: `1px solid ${border.soft}`, fontSize: 10, fontFamily: "Menlo, monospace", color: text.secondary }}>{s}</span>)}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${border.soft}`, paddingTop: 10 }}>
              {g?.consentStatus !== "granted" && k.key === "graph" && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: text.muted, whiteSpace: "nowrap" }}>Valid for</span>
                    <input value={ttl} onChange={(e) => setTtl(e.target.value)} style={{ width: 52, height: 28, padding: "0 8px", borderRadius: 6, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12, outline: "none", textAlign: "right" }} />
                    <span style={{ fontSize: 11, color: text.muted, whiteSpace: "nowrap" }}>hours (1–168)</span>
                  </label>
                  <button onClick={() => mint("graph")} disabled={minting} style={primaryBtn(minting)}>{readInvite.isPending ? "Sending…" : "Send a read-consent invite"}</button>
                </>
              )}
              {g?.consentStatus !== "granted" && k.key !== "graph" && (
                <button onClick={() => mint(k.key)} disabled={minting} style={primaryBtn(minting)}>
                  {(k.key === "writeBack" ? writeStart.isPending : sharepointStart.isPending) ? "Starting…" : `Start ${SHORT[k.key].toLowerCase()} consent`}
                </button>
              )}
              {canRevoke && (
                <button onClick={() => doRevoke(k.key)} disabled={revoke.isPending} style={{
                  height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint,
                  color: signal.critical.text, fontSize: 12, fontWeight: 600, cursor: revoke.isPending ? "wait" : "pointer",
                }}>
                  {revoke.isPending ? "Revoking…" : `Revoke ${SHORT[k.key].toLowerCase()}`}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {result && (
        <div style={{ border: `1px solid ${TONE[result.tone]!.border}`, borderRadius: 12, background: TONE[result.tone]!.tint, padding: 13, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{result.text}</span>
          {result.url && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: `1px solid ${border.soft}`, paddingTop: 9, minWidth: 0 }}>
              <span style={labelSpan()}>CONSENT URL · SINGLE USE</span>
              <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: signal.info.text, wordBreak: "break-all" }}>{result.url}</span>
              {result.expiresAt && <span style={{ fontSize: 11, color: text.muted }}>Expires {fmtDateTime(result.expiresAt)}</span>}
              {result.scopes && result.scopes.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {result.scopes.map((s) => <span key={s} style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: "rgba(148,163,184,.06)", border: `1px solid ${border.soft}`, fontSize: 10, fontFamily: "Menlo, monospace", color: text.secondary }}>{s}</span>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, present, negative }: { label: string; value: string; present: boolean; negative?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={labelSpan()}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: present ? (negative ? signal.critical.text : text.strong) : text.faint, textWrap: "pretty" }}>{value}</span>
    </div>
  );
}

// ── Onboarding links tab ────────────────────────────────────────────────────────

const LINK_STATUS_TONE: Record<OnboardingLink["status"], keyof typeof TONE> = { used: "green", pending: "amber", expired: "slate" };

function LinksTab({ links, loading, error }: { links: OnboardingLink[]; loading: boolean; error: boolean }) {
  return (
    <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Onboarding links this MSP has issued</span>
        <span style={{ fontSize: 11, color: text.muted }}>{loading ? "Loading…" : links.length + " issued · newest first"}</span>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading onboarding links…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load onboarding links.</span> :
       links.length === 0 ? emptyState(
          "inbox", "No onboarding links issued",
          "A real empty array. Links are created by the sibling generate-link route; this list is a straight read of what that route wrote.",
        ) :
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 780 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.5fr 1.1fr 1.4fr 100px 1fr 1fr", gap: 12, padding: "0 12px 6px", borderBottom: `1px solid ${border.soft}` }}>
              {["TOKEN", "FOR", "SERVICE", "NOTE", "STATUS", "EXPIRES", "ISSUED"].map((h) => <span key={h} style={labelSpan()}>{h}</span>)}
            </div>
            {links.map((l) => <LinkRow key={l.token} link={l} />)}
          </div>
        </div>}

      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.soft}`, paddingTop: 10 }}>
        Newest first, two hundred at most, no paging past that. Status is worked out from two timestamps — used, else expired, else pending — nothing is stored. The service and the issuing staff member arrive as bare ids with no name joined on this wire.
      </span>
    </div>
  );
}

function LinkRow({ link: l }: { link: OnboardingLink }) {
  const tone = TONE[LINK_STATUS_TONE[l.status]]!;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.5fr 1.1fr 1.4fr 100px 1fr 1fr", gap: 12, alignItems: "center", border: `1px solid ${border.soft}`, borderRadius: 9, background: "rgba(2,6,23,.4)", padding: "10px 12px", minWidth: 0 }}>
      <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: signal.info.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="The full token is on the wire; the link it belongs to is not">
        {l.token.slice(0, 8)}…{l.token.slice(-4)}
      </span>
      <span style={{ fontSize: 12, color: text.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.customerEmail}</span>
      <span style={{ fontSize: 11.5, color: l.serviceId === null ? text.faint : text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {l.serviceId === null ? "none named" : `service #${l.serviceId}`}
      </span>
      <span style={{ fontSize: 11.5, color: l.note ? text.secondary : text.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.note || "—"}</span>
      <span style={{ ...pill(tone), justifySelf: "start" }}>{l.status}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap" }}>{fmtDate(l.expiresAt)}</span>
        <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>{l.usedAt ? `used ${fmtDate(l.usedAt)}` : l.redirectPortalUrl ? "redirect set" : "not used"}</span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</span>
        <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>{l.createdByUserId === null ? "—" : `user #${l.createdByUserId}`}</span>
      </span>
    </div>
  );
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
