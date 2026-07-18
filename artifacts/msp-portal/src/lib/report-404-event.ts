/**
 * Fire-and-forget beacon into the backend audit log
 * (POST /api/portal-404-events). Distinct from report-client-event.ts —
 * that one feeds the exception tracker; this one lands in msp_audit_logs so
 * dead links show up in the Audit Log UI.
 *
 * Takes the access token directly (rather than fetchWithAuth) so it can never
 * trigger fetchWithAuth's automatic error-toast on a failed beacon call, and
 * so it's safe to call from contexts that don't have the auth hook in scope.
 */

const MAX_PATH_LENGTH = 500;

export function reportNotFoundEvent(
  accessToken: string | null,
  attemptedPath: string,
  referrer: string | null,
  linkPath?: string | null,
): void {
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

    void fetch("/api/portal-404-events", {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptedPath: attemptedPath.slice(0, MAX_PATH_LENGTH),
        referrer: referrer?.slice(0, MAX_PATH_LENGTH) ?? null,
        linkPath: linkPath?.slice(0, MAX_PATH_LENGTH) ?? null,
      }),
    }).catch(() => {});
  } catch {
    // Never let telemetry reporting throw or block the caller.
  }
}
