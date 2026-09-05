-- 2026-09-05-fresh-start-device-real-endpoint-2941.sql
-- Git #2941 — action.fresh-start-device stored the wrong real operation.
--
-- baseline_action_templates row id 63 (template_id action.fresh-start-device) is
-- labelled "Fresh Start Reset" but stored
-- `POST /deviceManagement/managedDevices/{{deviceId}}/windowsDefenderScan`, which
-- triggers a Microsoft Defender antivirus scan, not a Windows "Fresh Start" reset.
-- These are two genuinely different Intune device actions with different real
-- effects on the device -- an operator picking "Fresh Start Device" from the UI
-- would have triggered a Defender scan instead.
--
-- Confirmed against Microsoft Learn (intune-devices-manageddevice-cleanwindowsdevice,
-- 2024-08-01) that the real Graph API behind Intune's "Fresh Start" device action is:
--   POST /deviceManagement/managedDevices/{managedDeviceId}/cleanWindowsDevice
--   body: { "keepUserData": <boolean> }
--   -> 204 No Content on success
-- Same permission either way (DeviceManagementManagedDevices.PrivilegedOperations.All),
-- so graph-write-permissions.ts's derived permission entry for this template_id does
-- not need to change -- only its endpoint/justification/docUrl comment, done in the
-- same commit as this migration.
--
-- keepUserData defaults to false (removes user data, matching action.remote-wipe-device's
-- existing body_template convention of a literal default rather than an injected
-- variable) -- Fresh Start's whole purpose is a clean reinstall; a caller wanting to
-- preserve user data can still override the stored body_template per-call the same way
-- other templates do.

BEGIN;

UPDATE baseline_action_templates
SET
  endpoint = '/deviceManagement/managedDevices/{{deviceId}}/cleanWindowsDevice',
  body_template = '{"keepUserData": false}'::jsonb,
  description =
    'Performs a real Intune "Fresh Start" reset: POST /deviceManagement/managedDevices/' ||
    '{id}/cleanWindowsDevice, which reinstalls Windows on the device (removing ' ||
    'user-installed apps) while keeping enrollment. keepUserData controls whether the ' ||
    'user''s personal data is preserved; this template defaults it to false. Previously ' ||
    'this row incorrectly stored windowsDefenderScan (an antivirus scan) -- see Git #2941.',
  updated_at = now()
WHERE template_id = 'action.fresh-start-device';

-- Self-mark this migration as run (Simulator Studio Migrations tree, #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-05-fresh-start-device-real-endpoint-2941.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
