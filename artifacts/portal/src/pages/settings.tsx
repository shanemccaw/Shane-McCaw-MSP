import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Bell, Building2, KeySquare, Mail, ShieldAlert, Webhook } from "lucide-react";

import { AlertPreferencesContent } from "@/components/settings/AlertPreferencesContent";
import { DepartmentsContent } from "@/components/settings/DepartmentsContent";
import { DataRightsAndPrivacyContent } from "@/pages/data-rights-and-privacy";
import { EmailAuthSetupContent } from "@/pages/email-auth-setup";
import { NotificationPreferencesContent } from "@/pages/notification-preferences";
import { WebhooksContent } from "@/pages/webhooks";

const HAIRLINE = "rgba(255,255,255,.06)";

type TabKey = "alerts" | "notifs" | "emailauth" | "webhooks" | "departments" | "data";

interface NavItem {
  readonly key: TabKey;
  readonly label: string;
  readonly icon: typeof Bell;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

// Groups, order, and tab set are the real Shell design's own
// `settingsGroups` / `stab` state machine
// (Design/portal/design_handoff_full_site/screens/Shell.dc.html:1418-1450),
// read directly rather than re-derived — Change Control, Ownership, and
// Account Security do NOT appear here; the landed design keeps each of
// those on its own dedicated page/popover destination instead (see #1736's
// completion notes / the finding filed against #1596).
const SETTINGS_GROUPS: readonly NavGroup[] = [
  { label: "ALERTS", items: [
    { key: "alerts", label: "Alert preferences", icon: ShieldAlert },
    { key: "notifs", label: "Notifications", icon: Bell },
  ] },
  { label: "YOUR TENANT", items: [
    { key: "emailauth", label: "Email authentication", icon: Mail },
    { key: "webhooks", label: "Webhooks", icon: Webhook },
    { key: "departments", label: "Departments", icon: Building2 },
  ] },
  { label: "YOUR ACCOUNT", items: [
    { key: "data", label: "Privacy and your data", icon: KeySquare },
  ] },
];

const ALL_KEYS: readonly TabKey[] = SETTINGS_GROUPS.flatMap((g) => g.items.map((it) => it.key));

function isTabKey(v: string | null): v is TabKey {
  return v !== null && (ALL_KEYS as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const stab = useMemo<TabKey>(() => {
    const raw = new URLSearchParams(search).get("tab");
    return isTabKey(raw) ? raw : "alerts";
  }, [search]);

  const selectTab = (key: TabKey) => {
    setLocation(`/settings?tab=${key}`, { replace: true });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="settings-page">
      <div className="flex w-[196px] flex-none flex-col gap-[2px] border-r px-[10px] pt-5" style={{ borderColor: HAIRLINE }}>
        <span className="px-[10px] pb-2 text-[10px] font-bold tracking-[.14em] text-[#475569]">SETTINGS</span>
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-[2px]">
            <span className="px-[10px] pb-1 pt-[9px] text-[9px] font-bold tracking-[.13em] text-[#334155]">{group.label}</span>
            {group.items.map((it) => {
              const Icon = it.icon;
              const active = stab === it.key;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => selectTab(it.key)}
                  className="flex items-center gap-[9px] rounded-[7px] px-[10px] py-[7px] text-left transition-colors"
                  style={{ background: active ? "rgba(255,255,255,.06)" : "transparent" }}
                  data-testid={`settings-nav-${it.key}`}
                >
                  <Icon size={14} strokeWidth={1.75} color={active ? "#f8fafc" : "#94a3b8"} />
                  <span className="text-[12.5px] font-semibold" style={{ color: active ? "#f8fafc" : "#94a3b8" }}>{it.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        <span className="px-[10px] pt-3 text-[10.5px] leading-[1.5] text-[#334155]">
          Each module adds its own settings here as it lands — this list grows.
        </span>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {/* emailauth/data already carry their own `px-[26px] py-5` from their
            standalone-page origin; alerts/departments/notifs/webhooks don't,
            so they get an equivalent wrapper here. */}
        {stab === "alerts" ? (
          <div className="px-[26px] py-5">
            <AlertPreferencesContent />
          </div>
        ) : null}
        {stab === "notifs" ? (
          <div className="mx-auto max-w-[900px] px-[26px] py-5">
            <NotificationPreferencesContent />
          </div>
        ) : null}
        {stab === "emailauth" ? <EmailAuthSetupContent /> : null}
        {stab === "webhooks" ? (
          <div className="mx-auto max-w-[950px] px-[26px] py-5">
            <WebhooksContent />
          </div>
        ) : null}
        {stab === "departments" ? (
          <div className="px-[26px] py-5">
            <DepartmentsContent />
          </div>
        ) : null}
        {stab === "data" ? <DataRightsAndPrivacyContent /> : null}
      </div>
    </div>
  );
}
