/**
 * The Marketing screen's Properties panel.
 *
 * Quick facts for the open campaign, read-only here — editing happens in the
 * body or the `campaign` peek, matching `EngineProperties.tsx`'s "nothing
 * here writes" convention.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT } from "../../theme";
import { campaignAssets, campaignById, getSnapshot, setTab, subscribe } from "./marketingStore";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, relativeTime, shortDate, usd } from "./marketingTypes";

function Group({ title, tag, tagTone, children }: { title: string; tag?: string; tagTone?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE.subtle}`, padding: "9px 0 11px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 12px 6px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
        {tag && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: tagTone ?? TEXT.dim }}>{tag}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: string }) {
  return (
    <div title={value} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 12px" }}>
      <span style={{ flex: "0 0 42%", minWidth: 0, fontSize: 11.5, color: TEXT.caption, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11.5,
          fontFamily: mono ? FONT.mono : "inherit",
          color: tone ?? TEXT.softer,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function MarketingProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const c = campaignById(state.selectedCampaignId);

  if (!c) {
    return (
      <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>
        <button onClick={() => setTab("campaigns")} style={{ background: "transparent", border: 0, color: ACCENT.info, cursor: "pointer", font: "inherit", padding: 0 }}>
          Pick a campaign
        </button>{" "}
        to see its facts here.
      </div>
    );
  }

  const assets = campaignAssets(c.id);
  return (
    <div style={{ paddingBottom: 12 }}>
      <Group title="Campaign" tag={CAMPAIGN_STATUS_LABEL[c.status]} tagTone={CAMPAIGN_STATUS_TONE[c.status]}>
        <Field label="Name" value={c.name} />
        <Field label="Leads" value={String(c.leadsGenerated)} tone={ACCENT.amber} />
        <Field label="Revenue attributed" value={usd(c.revenueAttributed)} tone={ACCENT.greenSoft} />
        <Field label="Emails sent (real)" value={String(c.emailsSentAuto)} />
        <Field label="Emails sent (manual)" value={String(c.emailsSent)} />
        <Field label="Started" value={shortDate(c.startDate)} />
        <Field label="Updated" value={relativeTime(c.updatedAt)} />
      </Group>
      <Group title="Assets" tag={`${assets.length}`}>
        {assets.length === 0 ? (
          <div style={{ padding: "4px 12px", fontSize: 11, color: TEXT.faint }}>Nothing generated yet.</div>
        ) : (
          assets.slice(0, 8).map((a) => <Field key={a.id} label={a.assetType.replace(/_/g, " ")} value={a.title} />)
        )}
      </Group>
    </div>
  );
}
