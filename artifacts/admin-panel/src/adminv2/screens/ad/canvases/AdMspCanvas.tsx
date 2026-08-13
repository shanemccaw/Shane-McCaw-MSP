/**
 * MSP Object canvas — profile, subscription/plan + dunning state, derived
 * entitlements, linked customers, linked staff, and platform agreement
 * acceptance. Read-only detail (per docs/build-plans/active-directory.md
 * Phase 2 — no MSP-level edit actions in that phase), plus the two real
 * writes that exist elsewhere in the platform: suspend/reactivate
 * (msp-admin-settings.ts).
 */

import { useCallback, useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../../shell/ContextMenu";
import { fetchAdMsp, reactivateAdMsp, suspendAdMsp } from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { onAdRecordAction, requestAdTreeRefresh } from "../adEvents";
import type { AdMspDetail } from "../adTypes";
import {
  AdArmedButton,
  AdButton,
  AdCanvasBody,
  AdCanvasColumn,
  AdCanvasHeader,
  AdChip,
  AdEmptyRow,
  AdListRow,
  AdListRowGroup,
  AdLoadError,
  AdLoading,
  AdOutcome,
  AdSection,
  AdTile,
  AdTileGrid,
} from "../adKit";

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function usd(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function AdMspCanvas({ mspId }: { mspId: number }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<AdMspDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdMsp(fetchWithAuth, mspId);
      setDetail(data);
      setAdCachedRecord("msp", String(mspId), {
        title: data.msp.name,
        sub: data.msp.domain ?? data.msp.slug,
        tag: data.msp.status,
        tagTone: data.msp.status === "active" ? "good" : data.msp.status === "suspended" ? "bad" : "warn",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this MSP.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, mspId]);

  useEffect(() => {
    setOutcome(null);
    void load();
  }, [load]);

  const runSuspend = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      await suspendAdMsp(fetchWithAuth, mspId);
      setOutcome({ tone: "ok", message: "MSP suspended. Every user under it loses portal access immediately." });
      requestAdTreeRefresh();
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to suspend the MSP." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, mspId, load]);

  const runReactivate = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      await reactivateAdMsp(fetchWithAuth, mspId);
      setOutcome({ tone: "ok", message: "MSP reactivated." });
      requestAdTreeRefresh();
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to reactivate the MSP." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, mspId, load]);

  useEffect(
    () =>
      onAdRecordAction("msp", String(mspId), (action) => {
        if (action === "suspend-msp") void runSuspend();
        if (action === "reactivate-msp") void runReactivate();
      }),
    [mspId, runSuspend, runReactivate],
  );

  if (loading) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (error || !detail) return (
    <AdCanvasColumn>
      <AdLoadError message={error ?? "This MSP could not be loaded."} />
    </AdCanvasColumn>
  );

  const { msp, subscription, entitlements, customers, users, agreementAcceptances, hasAcceptedCurrentAgreement } = detail;
  const pastDue = subscription?.dunningState != null && subscription.dunningState !== "current";

  return (
    <AdCanvasColumn>
      <AdCanvasHeader
        icon={Briefcase}
        name={msp.name}
        kindLabel="MSP"
        chips={
          <>
            <AdChip label={msp.status} tone={msp.status === "active" ? "good" : msp.status === "suspended" ? "bad" : "warn"} />
            {msp.isDirectBusiness && <AdChip label="direct business" />}
            {pastDue && <AdChip label="past due" tone="warn" />}
          </>
        }
        actions={
          msp.status === "active" ? (
            <AdArmedButton
              label="Suspend"
              tone="danger"
              onConfirm={() => void runSuspend()}
              title="Every user under this MSP loses portal access immediately. Billing continues."
            />
          ) : msp.status === "suspended" ? (
            <AdButton label="Reactivate" tone="primary" onClick={() => void runReactivate()} disabled={busy} />
          ) : undefined
        }
      />

      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}

      <AdCanvasBody>
        <AdSection title="Profile">
          <AdTileGrid>
            <AdTile label="Slug" value={msp.slug} />
            <AdTile label="Domain" value={msp.domain ?? "none"} />
            <AdTile label="Customer since" value={fmtDate(msp.createdAt)} />
            <AdTile label="Testbed" value={msp.isTestbed ? "yes" : "no"} />
          </AdTileGrid>
        </AdSection>

        {subscription && (
          <AdSection title="Subscription" note={pastDue ? "Payment failed — access is unaffected until suspended." : undefined}>
            <AdTileGrid>
              <AdTile label="Plan" value={subscription.tierName} />
              <AdTile label="Status" value={subscription.status} accent={subscription.status === "active" ? ACCENT_TEXT.green : undefined} />
              <AdTile label="Billing" value={subscription.billingInterval} />
              <AdTile label="Dunning" value={subscription.dunningState ?? "current"} accent={pastDue ? ACCENT_TEXT.danger : undefined} />
              <AdTile label="Tenant count" value={String(subscription.tenantCountSnapshot)} />
              <AdTile label="Contact" value={subscription.contactEmail ?? "none"} />
            </AdTileGrid>
          </AdSection>
        )}

        {entitlements && (
          <AdSection title="Entitlements" note="Derived from the subscription tier — not editable here.">
            <AdTileGrid>
              <AdTile label="Tenant allowance" value={entitlements.tenantAllowance != null ? String(entitlements.tenantAllowance) : "unlimited"} />
              <AdTile label="AI credit allowance" value={entitlements.aiCreditAllowance != null ? String(entitlements.aiCreditAllowance) : "unlimited"} />
              <AdTile label="Overage rate" value={usd(entitlements.overageRateCents)} />
            </AdTileGrid>
          </AdSection>
        )}

        <AdSection title="Customers" note={`${detail.customerCount} tenant${detail.customerCount === 1 ? "" : "s"}`}>
          <AdListRowGroup>
            {customers.length === 0 ? (
              <AdEmptyRow label="No customers yet." />
            ) : (
              customers.map((c) => (
                <AdListRow
                  key={c.id}
                  label={c.name}
                  detail={c.domain ?? undefined}
                  meta={c.status}
                  onClick={() => shell.openDoc({ kind: "customer", id: String(c.id), screenId: "ad", label: c.name })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "customer", id: String(c.id), screenId: "ad", label: c.name }) },
                        { label: "Copy name", onSelect: () => void navigator.clipboard.writeText(c.name).catch(() => {}) },
                      ],
                      `Actions for ${c.name}`,
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Staff" note={`${detail.userCount} account${detail.userCount === 1 ? "" : "s"}`}>
          <AdListRowGroup>
            {users.length === 0 ? (
              <AdEmptyRow label="No staff accounts yet." />
            ) : (
              users.map((u) => (
                <AdListRow
                  key={u.id}
                  label={u.name || u.email}
                  detail={`${u.email} · ${u.mspRole}`}
                  meta={u.isActive ? "active" : "disabled"}
                  metaAccent={u.isActive ? undefined : ACCENT_TEXT.danger}
                  dot={u.isActive ? "#6ccb96" : "#e57a7a"}
                  onClick={() => shell.openDoc({ kind: "user", id: String(u.id), screenId: "ad", label: u.name || u.email })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "user", id: String(u.id), screenId: "ad", label: u.name || u.email }) },
                        { label: "Copy email", onSelect: () => void navigator.clipboard.writeText(u.email).catch(() => {}) },
                      ],
                      `Actions for ${u.name || u.email}`,
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Platform agreement" note={hasAcceptedCurrentAgreement ? undefined : "The current agreement version has not been accepted."}>
          <AdListRowGroup>
            {agreementAcceptances.length === 0 ? (
              <AdEmptyRow label="No agreement acceptances on file." />
            ) : (
              agreementAcceptances.map((a) => (
                <AdListRow key={a.agreementVersion} label={`v${a.agreementVersion}`} detail={a.checkboxConfirmed ? "checkbox confirmed" : "not confirmed"} meta={fmtDate(a.acceptedAt)} />
              ))
            )}
          </AdListRowGroup>
        </AdSection>
      </AdCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </AdCanvasColumn>
  );
}
