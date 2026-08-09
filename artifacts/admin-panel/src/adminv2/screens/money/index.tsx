/**
 * Money — the Money tab's screen.
 *
 * Registers against the fixed "money" tab (`SHELL.md`: Home · Inbox · Money ·
 * Watch · View | Git · Run). Every ribbon command here is `open` or `global`
 * — the audit `SHELL.md` describes ("Money... had per-record actions on its
 * fixed tab and was stripped") is why there is no `record`-intent button
 * here at all: nothing on this screen opens a specific sale or retainer.
 *
 * The design's mockup (`Design/adminv2/Admin Shell.dc.html`) has a "Log a
 * sale" button that manufactures a fake sale and fires a celebration. This
 * screen is wired to real data end to end (`admin-money.ts` — real
 * `msp_charges`/`ai_usage_events`/`client_services` rows), and there is no
 * real backend for manually recording a sale outside the Stripe/SOW flow —
 * building that is a `SHELL.md` "Known gap" (the Write Actions safety
 * pattern), not something to fake from here. Deliberately omitted rather
 * than faked.
 */

import { BarChart3, Coins, RefreshCw, Target, TrendingUp } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem } from "../../registry/types";
import { MoneyBody } from "./MoneyBody";
import { copyFigures, getSnapshot, refreshAll, setView } from "./moneyStore";
import { usd } from "./moneyTypes";

function openMoney(view: "month" | "business" | "ramp") {
  return () => {
    getShellApi()?.navigate("/money");
    setView(view);
  };
}

registerScreen({
  id: "money",
  title: "Money",
  area: "money",
  icon: Coins,
  route: "/money",
  render: () => <MoneyBody />,
  ribbon: [
    {
      tab: "money",
      order: 10,
      group: {
        label: "Go to",
        large: [{ label: "This month", icon: Coins, intent: "open", onSelect: openMoney("month"), color: ACCENT.green }],
        small: [
          { label: "The business", icon: BarChart3, intent: "open", onSelect: openMoney("business") },
          { label: "The ramp", icon: Target, intent: "open", onSelect: openMoney("ramp") },
        ],
      },
    },
    {
      tab: "money",
      order: 20,
      group: {
        label: "Where you stand",
        large: [
          {
            label: "Profit this month",
            icon: TrendingUp,
            intent: "open",
            onSelect: openMoney("month"),
            color: ACCENT.green,
            title: "This month's real profit — revenue minus tracked AI cost",
          },
        ],
      },
    },
    {
      tab: "money",
      order: 30,
      group: {
        label: "Do",
        small: [
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: refreshAll },
          { label: "Copy the figures", icon: Coins, intent: "global", onSelect: copyFigures, title: "Copies whatever real numbers are currently loaded, as JSON" },
        ],
      },
    },
  ],
  commands: () => {
    const s = getSnapshot().summary;
    const items: CommandItem[] = [
      {
        id: "act:money-refresh",
        type: "action" as const,
        kind: "run" as const,
        name: "Refresh money figures",
        sub: "Reload this month, the business and the ramp",
        area: "money",
        run: refreshAll,
      },
    ];
    if (s) {
      items.push({
        id: "ans:profit-this-month",
        type: "answer" as const,
        kind: "answer" as const,
        name: "Profit this month",
        sub: `${usd(s.revenue.cents)} in · ${usd(s.cost.cents)} out`,
        area: "money",
        live: usd(s.profit.cents),
        run: openMoney("month"),
      });
    }
    return items;
  },
});
