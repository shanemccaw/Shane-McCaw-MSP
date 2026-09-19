import type { PillarDriftDomainWire } from "./types";
import { DRIFT_STATE_LABEL, driftNote } from "./pillarDisplay";

const TRACKED_INK = "#00B4D8";
const TRACKED_BORDER = "rgba(0,180,216,.45)";
const DIM_INK = "#94a3b8";
const DIM_BORDER = "rgba(148,163,184,.30)";

/**
 * "CONFIG DRIFT BASELINE" (`Pillar Pages.dc.html` → `driftShow`, Git #4578):
 * one row per drift domain this pillar's checks own, each with the collector's
 * own state. Rendered only when the pillar owns a domain — the design's
 * `drift: null` pillars simply have no panel.
 *
 * `not comparable` and `error` are shown as what they are, with the collector's
 * recorded reason: a domain that could not be diffed is never dressed up as a
 * clean baseline.
 */
export function PillarDriftPanel({ domains }: { domains: PillarDriftDomainWire[] }) {
  if (domains.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-[6px] rounded-[12px] px-[14px] py-3"
      style={{ border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.015)" }}
      data-testid="pillar-drift"
    >
      <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">CONFIG DRIFT BASELINE</span>
      {domains.map((domain) => {
        const tracked = domain.state === "tracked";
        return (
          <div key={domain.domainKey} className="flex flex-col gap-[6px]" data-testid={`pillar-drift-${domain.domainKey}`}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[12px] font-semibold text-[#cbd5e1]">{domain.domainKey}</span>
              <span
                className="flex-none rounded-full px-[9px] py-[2px] text-[10px] font-semibold"
                style={{
                  color: tracked ? TRACKED_INK : DIM_INK,
                  border: `1px solid ${tracked ? TRACKED_BORDER : DIM_BORDER}`,
                }}
                data-testid={`pillar-drift-state-${domain.domainKey}`}
              >
                {DRIFT_STATE_LABEL[domain.state]}
              </span>
            </div>
            <span className="text-[10.5px] leading-[1.5] text-[#64748b]">{driftNote(domain)}</span>
          </div>
        );
      })}
    </div>
  );
}
