import type { LicenseSkuLedgerWire } from "./types";
import {
  formatCents,
  formatPurchasedMultiple,
  ledgerExcludedReason,
  ledgerFootnote,
} from "./pillarDisplay";

const HAIRLINE = "rgba(255,255,255,.09)";
const RULE = "rgba(255,255,255,.06)";
const HEAD_INK = "#475569";

const COLUMNS: { key: string; label: string; flex: number }[] = [
  { key: "purchased", label: "PURCHASED", flex: 0.6 },
  { key: "assigned", label: "ASSIGNED", flex: 0.6 },
  { key: "unassigned", label: "UNASSIGNED", flex: 0.6 },
  { key: "price", label: "PRICE / MO", flex: 0.7 },
  { key: "waste", label: "WASTE / YR", flex: 0.7 },
];

/**
 * The Licensing pillar's "SKU LEDGER — PRICED WHERE A PRICE EXISTS" table
 * (`Pillar Pages.dc.html` → `ledgerShow` / `ledgerEx`, Git #4578).
 *
 * Every row is `PillarSummaryPayload.licenseSkuLedger` — the real
 * `/subscribedSkus` page priced against `sku_price_reference`
 * (`resolveLicenseSkuLedger`, Git #1230). A SKU with no usable price is not a
 * row: it is listed underneath with the real reason, because the design's own
 * rule is that excluded is a rendered state, not a hidden one.
 */
export function PillarSkuLedger({ ledger }: { ledger: LicenseSkuLedgerWire | null }) {
  return (
    <div className="flex flex-col gap-2" data-testid="pillar-sku-ledger">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">
          SKU LEDGER — PRICED WHERE A PRICE EXISTS
        </span>
        <div className="h-px flex-1" style={{ background: RULE }} />
        {ledger ? <span className="text-[10.5px] text-[#475569]">{ledger.checkKey}</span> : null}
      </div>

      <div
        className="flex flex-col gap-2 rounded-[12px] px-[14px] py-3"
        style={{ border: `1px solid ${HAIRLINE}`, background: "rgba(255,255,255,.015)" }}
      >
        {ledger == null ? (
          <span className="text-[11.5px] text-[#94a3b8]" data-testid="pillar-sku-ledger-unavailable">
            No licence data on file for this tenant yet — the ledger fills in once a scan has stored the tenant's
            subscribed SKUs.
          </span>
        ) : (
          <>
            <div className="flex items-center gap-[10px] pb-[6px]" style={{ borderBottom: `1px solid ${RULE}` }}>
              <span className="text-[9.5px] font-semibold tracking-[.12em]" style={{ flex: 1.6, color: HEAD_INK }}>
                SKU
              </span>
              {COLUMNS.map((col) => (
                <span
                  key={col.key}
                  className="text-right text-[9.5px] font-semibold tracking-[.12em]"
                  style={{ flex: col.flex, color: HEAD_INK }}
                >
                  {col.label}
                </span>
              ))}
            </div>

            {ledger.rows.length === 0 ? (
              <span className="text-[11.5px] text-[#94a3b8]" data-testid="pillar-sku-ledger-no-priced-rows">
                None of this tenant's SKUs has a price on file, so no waste is computed. Every SKU is listed below
                with why.
              </span>
            ) : (
              ledger.rows.map((row) => (
                <div
                  key={row.skuPartNumber}
                  className="flex items-center gap-[10px]"
                  data-testid={`pillar-sku-row-${row.skuPartNumber}`}
                >
                  <div className="flex min-w-0 flex-col gap-px" style={{ flex: 1.6 }}>
                    <span className="text-[12.5px] font-semibold text-[#f8fafc]">{row.displayName}</span>
                    <span className="text-[10px] text-[#475569]">{row.skuPartNumber}</span>
                  </div>
                  <span className="text-right text-[12.5px] tabular-nums text-[#cbd5e1]" style={{ flex: 0.6 }}>
                    {row.purchased.toLocaleString("en-US")}
                  </span>
                  <span className="text-right text-[12.5px] tabular-nums text-[#cbd5e1]" style={{ flex: 0.6 }}>
                    {row.assigned.toLocaleString("en-US")}
                  </span>
                  <span className="text-right text-[12.5px] tabular-nums text-[#cbd5e1]" style={{ flex: 0.6 }}>
                    {row.unassigned.toLocaleString("en-US")}
                  </span>
                  <span className="text-right text-[12.5px] tabular-nums text-[#cbd5e1]" style={{ flex: 0.7 }}>
                    {formatCents(row.unitMonthlyPriceCents, true)}
                  </span>
                  <span
                    className="text-right text-[12.5px] font-bold tabular-nums text-[#f8fafc]"
                    style={{ flex: 0.7 }}
                    data-testid={`pillar-sku-waste-${row.skuPartNumber}`}
                  >
                    {formatCents(row.annualWasteCents, false)}
                  </span>
                </div>
              ))
            )}

            {ledger.excluded.length > 0 ? (
              <>
                <div className="flex items-center gap-[7px] pt-[6px]" style={{ borderTop: `1px solid ${RULE}` }}>
                  <span className="text-[9.5px] font-semibold tracking-[.12em]" style={{ color: HEAD_INK }}>
                    EXCLUDED FROM WASTE MATHS — WITH REASONS
                  </span>
                </div>
                {ledger.excluded.map((ex) => (
                  <div
                    key={ex.skuPartNumber}
                    className="flex items-center gap-[10px]"
                    data-testid={`pillar-sku-excluded-${ex.skuPartNumber}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[#94a3b8]">{ex.skuPartNumber}</span>
                    <span className="text-[11.5px] tabular-nums text-[#64748b]">
                      {formatPurchasedMultiple(ex.purchased)}
                    </span>
                    <span
                      className="flex-none rounded-full px-[9px] py-[2px] text-[10px] text-[#94a3b8]"
                      style={{ border: "1px solid rgba(148,163,184,.30)" }}
                    >
                      {ledgerExcludedReason(ex.reason)}
                    </span>
                  </div>
                ))}
              </>
            ) : null}

            <span
              className="pt-2 text-[10.5px] leading-[1.5] text-[#475569]"
              style={{ borderTop: `1px solid ${RULE}` }}
            >
              {ledgerFootnote(ledger.rows.length, ledger.rows.length + ledger.excluded.length)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
