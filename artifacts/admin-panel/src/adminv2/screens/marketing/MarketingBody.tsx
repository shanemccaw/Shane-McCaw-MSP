/**
 * Marketing screen body. Two sub-views, matching `MarketingExplorer.tsx`'s
 * SECTIONS: Campaigns, Traffic & results. Every figure comes from
 * `marketingStore.ts`, which reads `routes/admin-marketing.ts` — nothing here
 * computes a number. See `marketingTypes.ts`'s doc comment for why articles/
 * hero headlines/email templates are not part of this screen.
 */

import { useState, useSyncExternalStore } from "react";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  campaignAssets,
  campaignById,
  clearAdGen,
  createCampaign,
  generateAds,
  getSnapshot,
  saveGeneratedAds,
  selectCampaign,
  setCampaignStatus,
  subscribe,
  updateCampaignField,
  type MarketingState,
} from "./marketingStore";
import {
  AD_TYPES,
  AD_TYPE_LABEL,
  ASSET_TYPE_LABEL,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  CAMPAIGN_STATUS_TRANSITIONS,
  relativeTime,
  shortDate,
  usd,
  type AdType,
  type CampaignListRow,
} from "./marketingTypes";

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>{children}</span>
  );
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        background: `${tone}22`,
        border: `1px solid ${tone}55`,
        color: tone,
      }}
    >
      {text}
    </span>
  );
}

function PrimaryButton({ label, onSelect, busy }: { label: string; onSelect: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={busy}
      style={{ flex: "none", whiteSpace: "nowrap", padding: "5px 14px", borderRadius: 5, border: 0, background: busy ? LINE.control : PRIMARY, color: "#fff", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, cursor: busy ? "default" : "pointer" }}
    >
      {label}
    </button>
  );
}

function QuietButton({ label, onSelect, title, tone, busy }: { label: string; onSelect: () => void; title?: string; tone?: string; busy?: boolean }) {
  return (
    <button
      onClick={onSelect}
      title={title}
      disabled={busy}
      style={{ flex: "none", whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 5, border: `1px solid ${LINE.strong}`, background: "transparent", color: busy ? TEXT.faint : (tone ?? TEXT.soft), fontFamily: "inherit", fontSize: 11.5, cursor: busy ? "default" : "pointer" }}
    >
      {label}
    </button>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: tone ?? TEXT.faint, textWrap: "pretty" }}>{children}</span>;
}

/** A stated empty state. Never an empty box — SHELL.md section 6. */
function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

function TextField({ label, value, onCommit, area, mono }: { label: string; value: string; onCommit: (next: string) => void; area?: boolean; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: TEXT.caption }}>{label}</span>
      {area ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          style={{ resize: "vertical", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: mono ? FONT.mono : "inherit", fontSize: 12.5, lineHeight: 1.5 }}
        />
      ) : (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: mono ? FONT.mono : "inherit", fontSize: 12.5 }}
        />
      )}
      {dirty && (
        <div style={{ display: "flex", gap: 6 }}>
          <QuietButton label="Save" tone={ACCENT.amber} onSelect={() => onCommit(draft)} />
          <QuietButton label="Undo" onSelect={() => setDraft(value)} />
        </div>
      )}
    </div>
  );
}

function Bars({ points, height }: { points: Array<{ label: string; value: number }>; height: number }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9, height }}>
      {points.map((p, i) => (
        <div key={`${p.label}-${i}`} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10.5, color: TEXT.caption }}>{p.value}</span>
          <div style={{ width: "100%", borderRadius: "4px 4px 0 0", height: Math.max(6, Math.round((Math.abs(p.value) / max) * (height - 28))), background: i === points.length - 1 ? TEXT.quiet : LINE.hover }} />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10, color: TEXT.faint, overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

function NewCampaignForm({ onDone }: { onDone: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return <QuietButton label="New campaign" tone={ACCENT.info} onSelect={() => setOpen(true)} />;

  const canSave = name.trim() && goal.trim() && audience.trim() && offer.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card, width: "100%" }}>
      <Eyebrow>New campaign — starts as a draft</Eyebrow>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: "inherit", fontSize: 12.5 }} />
      <input placeholder="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: "inherit", fontSize: 12.5 }} />
      <input placeholder="Audience" value={audience} onChange={(e) => setAudience(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: "inherit", fontSize: 12.5 }} />
      <input placeholder="Offer" value={offer} onChange={(e) => setOffer(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: "inherit", fontSize: 12.5 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <PrimaryButton
          label={busy ? "Creating…" : "Create"}
          busy={busy || !canSave}
          onSelect={() => {
            setBusy(true);
            void createCampaign({ name, goal, audience, offer }).then((row) => {
              setBusy(false);
              if (row) {
                setOpen(false);
                setName("");
                setGoal("");
                setAudience("");
                setOffer("");
                onDone(row.id);
              }
            });
          }}
        />
        <QuietButton label="Cancel" onSelect={() => setOpen(false)} />
      </div>
    </div>
  );
}

function CampaignCard({ c, onOpen }: { c: CampaignListRow; onOpen: () => void }) {
  return (
    <div style={{ flex: "1 1 260px", minWidth: 220, padding: "13px 15px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <button
          onClick={onOpen}
          style={{ flex: 1, minWidth: 0, textAlign: "left", padding: 0, border: 0, background: "transparent", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: TEXT.primary, cursor: "pointer" }}
        >
          {c.name}
        </button>
        <Badge text={c.status} tone={CAMPAIGN_STATUS_TONE[c.status]} />
      </div>
      <div style={{ marginTop: 6 }}>
        <Note>{c.offer}</Note>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div>
          <Eyebrow>Leads</Eyebrow>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT.body }}>{c.leadsGenerated}</div>
        </div>
        <div>
          <Eyebrow>Revenue</Eyebrow>
          <div style={{ fontSize: 16, fontWeight: 800, color: ACCENT_TEXT.green }}>{usd(c.revenueAttributed)}</div>
        </div>
        <div>
          <Eyebrow>Emails</Eyebrow>
          <div style={{ fontSize: 16, fontWeight: 800, color: TEXT.body }}>{c.emailsSentAuto}</div>
        </div>
      </div>
    </div>
  );
}

function CampaignsListView({ state }: { state: MarketingState }) {
  const shell = getShellApi();
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <NewCampaignForm
          onDone={(id) => {
            selectCampaign(id);
            shell?.openDoc({ kind: "campaign", id: String(id), screenId: "marketing" });
          }}
        />
      </div>
      {state.campaigns.length === 0 ? (
        <Stated>{state.campaignsLoading ? "Reading campaigns…" : (state.campaignsError ?? "No campaigns yet — create one above.")}</Stated>
      ) : (
        <div style={{ display: "flex", gap: 13, flexWrap: "wrap", alignContent: "flex-start" }}>
          {state.campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              onOpen={() => {
                selectCampaign(c.id);
                shell?.openDoc({ kind: "campaign", id: String(c.id), screenId: "marketing" });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdGenerator({ campaign }: { campaign: CampaignListRow }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [adType, setAdType] = useState<AdType>("ad_google");
  const [topic, setTopic] = useState(campaign.offer);
  const gen = state.adGen && state.adGen.campaignId === campaign.id ? state.adGen : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow>Generate ad copy</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {AD_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setAdType(t)}
            style={{
              padding: "4px 11px",
              borderRadius: 11,
              fontFamily: "inherit",
              fontSize: 11.5,
              cursor: "pointer",
              border: `1px solid ${adType === t ? "rgba(255,255,255,.28)" : LINE.control}`,
              background: adType === t ? "rgba(255,255,255,.12)" : "transparent",
              color: adType === t ? TEXT.primary : TEXT.dimmer,
            }}
          >
            {AD_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic / angle"
          style={{ flex: "1 1 220px", minWidth: 160, padding: "6px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.primary, fontFamily: "inherit", fontSize: 12.5 }}
        />
        <PrimaryButton label={gen?.busy ? "Generating…" : "Generate"} busy={gen?.busy} onSelect={() => void generateAds(campaign.id, adType, topic || campaign.offer)} />
        {gen?.result && <QuietButton label="Clear" onSelect={clearAdGen} />}
      </div>
      <Note>Real AI copy, not a preview label — nothing is saved as a campaign asset until you press "Save as assets" below.</Note>

      {gen?.result && gen.result.variations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {gen.result.variations.map((v, i) => (
            <div key={i} style={{ padding: "10px 12px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.root, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>{v.headline}</span>
              <span style={{ fontSize: 11.5, color: TEXT.softer, lineHeight: 1.5 }}>{v.description}</span>
              <span style={{ fontSize: 11, color: ACCENT.info }}>{v.cta}{v.url ? ` · ${v.url}` : ""}</span>
            </div>
          ))}
          <PrimaryButton
            label="Save as assets"
            onSelect={() => void saveGeneratedAds(campaign.id, adType, `${AD_TYPE_LABEL[adType]} — ${topic || campaign.offer}`, gen.result!.variations)}
          />
        </div>
      )}
      {gen?.result && gen.result.variations.length === 0 && <Note tone={ACCENT.amber}>{gen.result.error ?? "The model returned nothing usable — try a more specific topic."}</Note>}
    </div>
  );
}

function CampaignDetailView({ campaign, state }: { campaign: CampaignListRow; state: MarketingState }) {
  const detail = state.campaignDetails[campaign.id];
  const assets = campaignAssets(campaign.id);
  const saving = state.savingIds.has(`campaign:${campaign.id}`);
  const available = CAMPAIGN_STATUS_TRANSITIONS[campaign.status];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
        <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{campaign.name}</span>
        <Badge text={CAMPAIGN_STATUS_LABEL[campaign.status]} tone={CAMPAIGN_STATUS_TONE[campaign.status]} />
        <div style={{ flex: 1, minWidth: 4 }} />
        {state.message && <span style={{ fontSize: 11.5, color: ACCENT.greenSoft }}>{state.message}</span>}
        {available.map((a) => (
          <QuietButton key={a.to} label={a.label} busy={saving} onSelect={() => void setCampaignStatus(campaign.id, a.to)} />
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { label: "Leads", value: String(campaign.leadsGenerated), tone: ACCENT.amber },
            { label: "Revenue attributed", value: usd(campaign.revenueAttributed), tone: ACCENT_TEXT.green },
            { label: "Emails sent (real)", value: String(campaign.emailsSentAuto), tone: TEXT.body },
          ].map((f) => (
            <div key={f.label} style={{ flex: "0 1 160px", padding: "13px 15px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
              <Eyebrow>{f.label}</Eyebrow>
              <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800, color: f.tone }}>{f.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Edit it here</Eyebrow>
          <TextField label="Name" value={campaign.name} onCommit={(v) => void updateCampaignField(campaign.id, { name: v })} />
          <TextField label="Goal" value={campaign.goal} area onCommit={(v) => void updateCampaignField(campaign.id, { goal: v })} />
          <TextField label="Audience" value={campaign.audience} area onCommit={(v) => void updateCampaignField(campaign.id, { audience: v })} />
          <TextField label="Offer" value={campaign.offer} area onCommit={(v) => void updateCampaignField(campaign.id, { offer: v })} />
        </div>

        <AdGenerator campaign={campaign} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>{assets.length} asset{assets.length === 1 ? "" : "s"}</Eyebrow>
          {assets.length === 0 ? (
            <Note>Nothing generated for this campaign yet.</Note>
          ) : (
            assets.map((a) => (
              <div key={a.id} style={{ padding: "10px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge text={ASSET_TYPE_LABEL[a.assetType]} tone={ACCENT.info} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10.5, color: TEXT.faint }}>{shortDate(a.createdAt)}</span>
                </div>
                <span style={{ fontSize: 11.5, color: TEXT.softer, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.content.length > 240 ? `${a.content.slice(0, 240)}…` : a.content}</span>
              </div>
            ))
          )}
        </div>

        {detail && detail.emailEvents.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>Recent email events</Eyebrow>
            {detail.emailEvents.slice(0, 8).map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 11.5 }}>
                <Badge text={e.eventType} tone={ACCENT.info} />
                <span style={{ color: TEXT.softer, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject ?? "(no subject)"}</span>
                <span style={{ color: TEXT.caption }}>{e.recipient}</span>
                <span style={{ color: TEXT.faint }}>{relativeTime(e.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignsTab({ recordId, state }: { recordId?: string; state: MarketingState }) {
  const campaign = (recordId ? campaignById(recordId) : undefined) ?? campaignById(state.selectedCampaignId);
  if (!campaign) return <CampaignsListView state={state} />;
  return <CampaignDetailView campaign={campaign} state={state} />;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function AnalyticsTab({ state }: { state: MarketingState }) {
  const a = state.analytics;
  if (!a) {
    return <Stated>{state.analyticsLoading ? "Reading site analytics…" : (state.analyticsError ?? "Nothing loaded yet.")}</Stated>;
  }
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Eyebrow>Visitors, last 7 days</Eyebrow>
        <div style={{ marginTop: 10 }}>
          {a.dailyVisitors.length === 0 ? <Note>Nothing recorded.</Note> : <Bars points={a.dailyVisitors.map((d) => ({ label: shortDate(d.day), value: d.visitors }))} height={100} />}
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 220 }}>
          <Eyebrow>Top pages, last 30 days</Eyebrow>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            {a.topPages.length === 0 ? <Note>Nothing recorded.</Note> : a.topPages.map((p) => (
              <div key={p.page} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                <span style={{ color: TEXT.softer, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT.mono }}>{p.page}</span>
                <span style={{ color: TEXT.dim, flex: "none" }}>{p.views}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 220 }}>
          <Eyebrow>Traffic sources, last 30 days</Eyebrow>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
            {a.trafficSources.length === 0 ? <Note>Nothing recorded.</Note> : a.trafficSources.map((s) => (
              <div key={s.source} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                <span style={{ color: TEXT.softer }}>{s.source}</span>
                <span style={{ color: TEXT.dim }}>{s.sessions}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <Eyebrow>Visitors → contact → leads → converted, last 30 days</Eyebrow>
        <div style={{ marginTop: 10 }}>
          {a.conversionFunnel.length === 0 ? <Note>Nothing recorded.</Note> : <Bars points={a.conversionFunnel.map((f) => ({ label: f.stage, value: f.value }))} height={100} />}
        </div>
      </div>

      <div>
        <Eyebrow>Campaign performance</Eyebrow>
        {a.campaignPerformance.length === 0 ? (
          <Note>No campaigns have assets or leads yet.</Note>
        ) : (
          <div style={{ marginTop: 8, overflowX: "auto", border: `1px solid ${LINE.base}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr>
                  {["Campaign", "Status", "Assets", "Leads", "Revenue", "Revenue / lead"].map((h) => (
                    <th key={h} style={{ textAlign: "left", whiteSpace: "nowrap", padding: "8px 11px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.inset, color: TEXT.caption, fontWeight: 700 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.campaignPerformance.map((c, i) => (
                  <tr key={c.id} style={{ background: i % 2 ? SURFACE.card : "transparent" }}>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer, whiteSpace: "nowrap" }}>{c.name}</td>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer }}>{c.status}</td>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer }}>{c.assetCount}</td>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer }}>{c.leadsGenerated}</td>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: ACCENT_TEXT.green }}>{usd(c.revenueAttributed)}</td>
                    <td style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer }}>{c.revenuePerLead === null ? "—" : usd(c.revenuePerLead)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function MarketingBody({ recordId }: { recordId?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      {state.tab === "campaigns" && <CampaignsTab recordId={recordId} state={state} />}
      {state.tab === "analytics" && <AnalyticsTab state={state} />}
    </div>
  );
}
