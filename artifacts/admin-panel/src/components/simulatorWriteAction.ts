// artifacts/admin-panel/src/components/simulatorWriteAction.ts
//
// Pure helpers for the Simulator "Write Actions" canvas — split out from the
// .tsx (matching the simulatorTreeState.ts / simulatorFullResponse.ts /
// simulatorResponseView.ts convention in this app) so the variable-prefill and
// readiness logic can be unit-tested without React.
//
// DELIBERATELY NO DESTRUCTIVE DEFAULTS. For a tenant-mutating action, a
// pre-filled value could silently drive a real write (a default accountEnabled,
// a default skuId). So required variables start EMPTY — the operator must
// consciously supply every one — and we only offer a type HINT (placeholder)
// per known variable name, never a value.

/**
 * A placeholder hint for a required-variable input. Never a value that would be
 * submitted — purely a format cue, so the operator knows what to type.
 */
export function variablePlaceholder(varName: string): string {
  switch (varName) {
    case "userId":
      return "user GUID or userPrincipalName";
    case "groupId":
      return "group GUID";
    case "teamId":
      return "team GUID";
    case "memberId":
      return "member (user) GUID";
    case "membershipId":
      return "Teams conversation membership id (NOT the user id)";
    case "skuId":
      return "license SKU GUID";
    case "driveId":
      return "drive id";
    case "itemId":
      return "drive item id";
    case "accountEnabled":
      return "true / false";
    case "tempPassword":
      return "a real generated temporary password";
    default:
      return varName;
  }
}

/** Every required variable, initialised to an empty string — no destructive defaults. */
export function buildInitialVariables(requiredVariables: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of requiredVariables) out[v] = "";
  return out;
}

/**
 * Whether all required variables have a non-empty value — the client-side mirror
 * of the executor's own requiredVariables check. The server re-validates (a
 * preview reports missingVariables, execute would 400), so this only gates the
 * "Preview request" button, never the real decision.
 */
export function readyToPreview(requiredVariables: string[], values: Record<string, string>): boolean {
  return requiredVariables.every(v => (values[v] ?? "").trim() !== "");
}

/** A short, plain description of what an HTTP method DOES to the tenant — for the confirmation copy. */
export function describeMethodConsequence(method: string): string {
  switch (method) {
    case "POST":
      return "creates or adds something on the tenant";
    case "PATCH":
      return "modifies existing tenant state";
    case "PUT":
      return "replaces existing tenant state";
    case "DELETE":
      return "removes something from the tenant";
    default:
      return "changes tenant state";
  }
}

/**
 * A one-line rollback summary + tone for the safety panel, derived from the real
 * reverse-template pairing. Never claims a rollback exists when reverseTemplateId
 * is null.
 */
export function describeRollback(input: {
  reversible: boolean;
  reverseTemplateId: string | null;
  reverseTemplateLabel: string | null;
}): { text: string; tone: "ok" | "warn" } {
  if (input.reversible && input.reverseTemplateId) {
    const name = input.reverseTemplateLabel ?? input.reverseTemplateId;
    // A self-paired reverse (e.g. the sign-in toggle) inverts its own captured value.
    return { text: `Reversible via "${name}" (${input.reverseTemplateId})`, tone: "ok" };
  }
  return { text: "No single-step rollback path — this action cannot be automatically undone", tone: "warn" };
}
