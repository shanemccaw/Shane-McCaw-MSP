-- Wire Real Dashboard Modules — Sharing, Device Health, Power Platform, Copilot
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Appends widgets for metric-registry categories that already have real, computed
-- data (lib/dashboard-registry/src/metrics.ts) but were never placed on any
-- customer_default dashboard_templates row. Data-only change — no schema change,
-- no new tables, canvas_layout jsonb column already exists.
--
-- Idempotent: for each existing customer_default row, only appends widgets whose
-- metricKey isn't already present in that row's canvas_layout (NOT EXISTS guard),
-- so this is safe to re-run and safe to run after a customer/MSPAdmin has already
-- customized their layout via the Designer. New widgets land at y >= 1000, below
-- whatever is already on the canvas — react-grid-layout's default vertical
-- compaction (see DashboardCanvas.tsx) pulls them up to sit right after existing
-- content on next render, so no manual repositioning is required, but MSPAdmins
-- may still want to rearrange/resize via the Designer afterward.
--
-- Coverage decisions (see PLATFORM_BUILD.md "Wire Real Dashboard Modules" row for
-- the full audit):
--   Sharing/Data Exposure — wired: compliance.guestUserCount, compliance.externalInviteCount,
--     collaboration.forwardingMailboxCount, collaboration.sharedMailboxSigninEnabledCount.
--   Device Health — wired: all 8 real intune.* metrics.
--   Copilot/AI — wired: copilot.overshareExposureCount only. copilot.usagePerUser is
--     status "not_collected" in the registry (sourceKey "not_collected:copilot-usage") —
--     NOT real data, intentionally NOT wired. Needs its own engine-signal follow-up.
--   Power Platform — wired as a placeholder-quality pair (appCount, flowCount) only.
--     This does NOT constitute real "Shadow IT detection" — no ownership/risk signal
--     exists in the registry, just raw inventory counts. Flagged as a real gap
--     requiring its own scoped follow-up (a new engine signal), not something to
--     paper over here.
--   Workflow activity/automation logs — NOT wired. workflow.* metrics in the registry
--     are all scope: "msp" (platform-operational engine health: node failures,
--     latency, queue backlog), not customer-facing activity logs. Real gap, needs
--     its own customer-facing engine signal — not fabricated here.
--   Email security & threat trends — wired: security.malwareAlertCount,
--     security.phishingAlertCount (both real, customer-scoped, trend shape).

WITH new_widgets(elem) AS (
  VALUES
    -- ── Sharing / Data Exposure ──────────────────────────────────────────────
    ('{"i":"auto-sharing-guest-users","x":0,"y":1000,"w":4,"h":3,"metricKey":"compliance.guestUserCount","rendererType":"Trend"}'::jsonb),
    ('{"i":"auto-sharing-external-invites","x":4,"y":1000,"w":4,"h":3,"metricKey":"compliance.externalInviteCount","rendererType":"Trend"}'::jsonb),
    ('{"i":"auto-sharing-forwarding-mailboxes","x":8,"y":1000,"w":3,"h":3,"metricKey":"collaboration.forwardingMailboxCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-sharing-shared-mailbox-signin","x":0,"y":1003,"w":3,"h":3,"metricKey":"collaboration.sharedMailboxSigninEnabledCount","rendererType":"Smart"}'::jsonb),

    -- ── Device Health (Intune) ───────────────────────────────────────────────
    ('{"i":"auto-devicehealth-noncompliant","x":3,"y":1003,"w":3,"h":3,"metricKey":"intune.nonCompliantDeviceCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-devicehealth-config-drift","x":6,"y":1003,"w":2,"h":2,"metricKey":"intune.configDriftCount","rendererType":"Stat"}'::jsonb),
    ('{"i":"auto-devicehealth-unencrypted","x":8,"y":1003,"w":3,"h":3,"metricKey":"intune.unencryptedDeviceCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-devicehealth-unenrolled","x":0,"y":1006,"w":3,"h":3,"metricKey":"intune.unenrolledDeviceCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-devicehealth-jailbroken","x":3,"y":1006,"w":3,"h":3,"metricKey":"intune.jailbrokenDeviceCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-devicehealth-rooted","x":6,"y":1006,"w":3,"h":3,"metricKey":"intune.rootedDeviceCount","rendererType":"Smart"}'::jsonb),
    ('{"i":"auto-devicehealth-high-threat","x":0,"y":1009,"w":4,"h":3,"metricKey":"intune.highThreatDeviceCount","rendererType":"Trend"}'::jsonb),
    ('{"i":"auto-devicehealth-outdated","x":4,"y":1009,"w":3,"h":3,"metricKey":"intune.outdatedDeviceCount","rendererType":"Smart"}'::jsonb),

    -- ── Copilot / AI (only the genuinely real metric — see header note) ─────
    ('{"i":"auto-copilot-overshare-exposure","x":7,"y":1009,"w":3,"h":3,"metricKey":"copilot.overshareExposureCount","rendererType":"Smart"}'::jsonb),

    -- ── Power Platform (placeholder-quality — see header note on Shadow IT gap) ─
    ('{"i":"auto-powerplatform-apps","x":0,"y":1012,"w":4,"h":3,"metricKey":"powerPlatform.appCount","rendererType":"Trend","properties":{"note":"Inventory count only — no ownership/risk signal yet. Not a full Shadow IT view."}}'::jsonb),
    ('{"i":"auto-powerplatform-flows","x":4,"y":1012,"w":4,"h":3,"metricKey":"powerPlatform.flowCount","rendererType":"Trend","properties":{"note":"Inventory count only — no ownership/risk signal yet. Not a full Shadow IT view."}}'::jsonb),

    -- ── Email security & threat trends ───────────────────────────────────────
    ('{"i":"auto-emailsecurity-malware","x":8,"y":1012,"w":4,"h":3,"metricKey":"security.malwareAlertCount","rendererType":"Trend"}'::jsonb),
    ('{"i":"auto-emailsecurity-phishing","x":0,"y":1015,"w":4,"h":3,"metricKey":"security.phishingAlertCount","rendererType":"Trend"}'::jsonb)
)
UPDATE dashboard_templates t
SET canvas_layout = t.canvas_layout || (
      SELECT COALESCE(jsonb_agg(nw.elem), '[]'::jsonb)
      FROM new_widgets nw
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(t.canvas_layout) existing
        WHERE existing->>'metricKey' = nw.elem->>'metricKey'
      )
    ),
    updated_at = now()
WHERE t.template_type = 'customer_default';
