/**
 * Money — the Money tab's screen.
 *
 * Registers against the fixed "money" tab (`SHELL.md`: Home · Inbox · Money ·
 * Watch · View | Git · Run). Every ribbon command here is `open` or `global`
 * — the audit `SHELL.md` describes ("Money... had per-record actions on its
 * fixed tab and was stripped") is why there is no `record`-intent button
 * here at all: nothing on this screen opens a specific sale or retainer.
 *
 * Mirrors the design's Money ribbon (`Design/adminv2/Admin Shell.dc.html`,
 * the `Money:` group array) group for group:
 *   - "Go to" — the design pairs a `View` combo (browse the three sub-views,
 *     footer "Set your goals…") with a row of the same three as one-click
 *     buttons. `RibbonCombo` has no `gallery` support in this shell (only
 *     `RibbonCommand` does — see `registry/types.ts`), so the combo becomes
 *     a `large` button wearing the gallery instead; the row is unchanged.
 *   - "Where you stand" — profit/in/out/sales-count, all real numbers.
 *   - "Do" — Log a sale, Set your goals, Who owes you, Copy the figures.
 * All of the money figures on these buttons need `liveKey` (see
 * `shell/liveRibbon.ts`): a screen's `ribbon` array is built once, at
 * module-load time, before any real fetch has resolved.
 *
 * "Log a sale" is real, not the design's fabricated celebration — see
 * `admin-money.ts`'s `ManualSale` doc comment and `moneyStore.ts`'s
 * `logSale`. A manually-logged sale is a genuine, disclosed record that
 * merges into every other figure on this screen, not a mock-up.
 */

import { BarChart3, Coins, DollarSign, RefreshCw, Target, TrendingUp, Users } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem } from "../../registry/types";
import { MoneyBody } from "./MoneyBody";
import {
  copyFigures,
  getSnapshot,
  openGoalsDialog,
  openLogSaleDialog,
  refreshAll,
  setView,
  type MoneyView,
} from "./moneyStore";
import { usd } from "./moneyTypes";

function openMoney(view: MoneyView) {
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
        row: [
          { label: "This month", icon: Coins, intent: "open", onSelect: openMoney("month"), liveKey: "money:goto-month" },
          { label: "The business", icon: BarChart3, intent: "open", onSelect: openMoney("business"), liveKey: "money:goto-business" },
          { label: "The ramp", icon: Target, intent: "open", onSelect: openMoney("ramp"), liveKey: "money:goto-ramp" },
        ],
        large: [
          {
            label: "This month",
            icon: Coins,
            intent: "open",
            onSelect: openMoney("month"),
            color: ACCENT.green,
            liveKey: "money:goto",
            title: "Browse the three money views",
            gallery: {
              id: "money-views",
              title: "Money",
              searchable: false,
              rows: [
                { id: "month", tile: "$", name: "This month", sub: "what came in, what went out", onSelect: openMoney("month") },
                { id: "business", tile: "%", name: "The business", sub: "how you compare to a healthy MSP", onSelect: openMoney("business") },
                { id: "ramp", tile: "#", name: "The ramp", sub: "what you are asking of yourself", onSelect: openMoney("ramp") },
              ],
              footer: { label: "Set your goals…", onSelect: openGoalsDialog },
            },
          },
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
            onSelect: openMoney("business"),
            color: ACCENT.green,
            liveKey: "money:stand-profit",
            title: "This month's real profit — revenue minus tracked AI cost. Opens The business.",
          },
        ],
        small: [
          { label: "Revenue", icon: Coins, intent: "open", onSelect: openMoney("month"), color: ACCENT.green, liveKey: "money:stand-in" },
          { label: "Cost", icon: DollarSign, intent: "open", onSelect: openMoney("month"), color: ACCENT.red, liveKey: "money:stand-out" },
          { label: "Sales", icon: Target, intent: "open", onSelect: openMoney("ramp"), color: ACCENT.amber, liveKey: "money:stand-sales" },
        ],
      },
    },
    {
      tab: "money",
      order: 30,
      group: {
        label: "Do",
        large: [
          {
            label: "Log a sale",
            icon: DollarSign,
            intent: "create",
            onSelect: openLogSaleDialog,
            color: ACCENT.greenBright,
            title: "Record a real sale that did not go through Stripe/SOW — merges straight into these figures",
          },
        ],
        small: [
          { label: "Set your goals", icon: Target, intent: "open", onSelect: openGoalsDialog },
          { label: "Who owes you", icon: Users, intent: "open", onSelect: openMoney("business") },
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
        type: "action",
        kind: "run",
        name: "Refresh money figures",
        sub: "Reload this month, the business and the ramp",
        area: "money",
        run: refreshAll,
      },
      {
        id: "act:money-log-sale",
        type: "action",
        kind: "run",
        name: "Log a sale",
        sub: "Record a real sale that did not go through Stripe/SOW",
        area: "money",
        run: () => {
          getShellApi()?.navigate("/money");
          openLogSaleDialog();
        },
      },
      {
        id: "act:money-set-goals",
        type: "action",
        kind: "run",
        name: "Set your goals",
        sub: "Sales target and recurring-revenue target",
        area: "money",
        run: () => {
          getShellApi()?.navigate("/money");
          openGoalsDialog();
        },
      },
    ];
    if (s) {
      items.push({
        id: "ans:profit-this-month",
        type: "answer",
        kind: "answer",
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
