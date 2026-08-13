/**
 * Live Scan — the Run tab's screen.
 *
 * Run pairs with Git as the amber developer capsule (handoff.md section 3);
 * Git watches the server's own checkout, Run watches the platform's own
 * checks executing against every tenant. There is exactly one legal fixed-tab
 * command here: opening the screen. Triggering a scan needs a specific tenant
 * (a `record` intent — SHELL.md section 1's audit rule), so it has nowhere to
 * live on a fixed tab; that stays a per-tenant action on whichever screen ends
 * up owning the tenant record (today: the old admin panel's
 * ActiveDirectoryCustomerPane "Start Manual Scan").
 */

import { Building2, Radar } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { LiveScanBody } from "./LiveScanBody";
import { markForRow, profilesForTenant, relativeTime, toneForRow } from "./liveScanData";

registerScreen({
  id: "live-scan",
  title: "Live Scan",
  area: "monitor",
  icon: Radar,
  route: "/live-scan",
  render: () => <LiveScanBody />,
  ribbon: [
    {
      tab: "run",
      order: 10,
      group: {
        label: "Live Scan",
        large: [
          {
            label: "Live feed",
            icon: Radar,
            intent: "open",
            onSelect: () => getShellApi()?.navigate("/live-scan"),
            title: "Real-time engine.monitor activity across every tenant",
          },
        ],
      },
    },
  ],
  peeks: {
    // Backed by whatever `LiveScanBody` last fetched from
    // /api/admin/monitor-checks/profiles — see liveScanData.ts's doc comment
    // for why a peek resolver (synchronous) can't fetch this itself.
    tenant: (id) => {
      const rows = profilesForTenant(id);
      if (rows.length === 0) return null;
      const latest = rows[0]!;
      const tone = toneForRow(latest.status, latest.severityMatched);

      return {
        kind: "tenant",
        title: latest.clientCompany !== "Unknown Company" ? latest.clientCompany : latest.clientName,
        sub: id,
        icon: Building2,
        tone,
        tag: `${rows.length} check${rows.length === 1 ? "" : "s"} in this window`,
        tagTone: tone,
        facts: [
          { label: "Last collected", value: relativeTime(latest.collectedAt), prose: true },
          { label: "Checks seen", value: String(rows.length) },
        ],
        list: {
          title: "Recent checks",
          rows: rows.slice(0, 20).map((r) => ({
            id: String(r.id),
            mark: markForRow(r.status, r.severityMatched),
            tone: toneForRow(r.status, r.severityMatched),
            name: r.checkKey,
            sub: r.severityLabel ?? r.errorMessage ?? undefined,
            right: relativeTime(r.collectedAt),
          })),
        },
      };
    },
  },
});
