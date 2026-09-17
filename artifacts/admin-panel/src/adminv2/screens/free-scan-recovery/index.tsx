/**
 * Free Scan account recovery screen (Git #4483).
 *
 * PlatformAdmin-only queue of second-factor reset requests from paid Free Scan
 * engagement accounts. An approval here is the out-of-band step between a
 * Prospect proving mailbox + password and being allowed to enrol a new factor.
 * Lives on the Watch tab under "Needs a decision" — a request waiting on an
 * identity check is exactly that.
 */

import { KeyRound } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem } from "../../registry/types";
import { FreeScanRecoveryBody } from "./FreeScanRecoveryBody";
import { getSnapshot, pendingCount, WATCH_PENDING_KEY } from "./freeScanRecoveryStore";

export const ROUTE = "/free-scan-recovery";
const SCREEN_ID = "free-scan-recovery";

registerScreen({
  id: SCREEN_ID,
  title: "Free Scan account recovery",
  area: "free-scan-recovery",
  icon: KeyRound,
  route: ROUTE,
  render: () => <FreeScanRecoveryBody />,

  ribbon: [
    {
      tab: "watch",
      order: 20,
      group: {
        label: "Needs a decision",
        small: [
          {
            label: "Factor resets",
            icon: KeyRound,
            intent: "open",
            color: ACCENT.amber,
            liveKey: WATCH_PENDING_KEY,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "Free Scan engagement accounts asking to replace a lost second factor",
          },
        ],
      },
    },
  ],

  commands: () => {
    const snap = getSnapshot();
    const items: CommandItem[] = [];
    if (snap.loaded) {
      items.push({
        id: "ans:free-scan-recovery-pending",
        type: "answer",
        kind: "answer",
        name: "Free Scan second-factor resets waiting for a decision",
        sub: "Identity check before a Prospect can enrol a new factor",
        area: "free-scan-recovery",
        live: String(pendingCount()),
        run: () => getShellApi()?.navigate(ROUTE),
      });
    }
    return items;
  },
});
