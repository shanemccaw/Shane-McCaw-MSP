/**
 * Fire-and-forget beacon into the backend exception tracker
 * (POST /api/client-events). Used by frontend canaries/defensive assertions
 * that want to be observable in Simulator Studio / the log stream, not just
 * shown to the user via toast.
 *
 * Takes the access token directly (rather than fetchWithAuth) so it can never
 * trigger fetchWithAuth's automatic error-toast on a failed beacon call, and
 * so it's safe to call from contexts that don't have the auth hook in scope.
 */

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;

export function reportClientEvent(
  accessToken: string | null,
  errorName: string,
  message: string,
  channel: string,
  context?: Record<string, unknown>,
  stack?: string,
): void {
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

    void fetch("/api/client-events", {
      method: "POST",
      headers,
      body: JSON.stringify({
        errorName,
        message: message.slice(0, MAX_MESSAGE_LENGTH),
        stack: stack?.slice(0, MAX_STACK_LENGTH),
        channel,
        context,
      }),
    }).catch(() => {});
  } catch {
    // Never let telemetry reporting throw or block the caller.
  }
}
