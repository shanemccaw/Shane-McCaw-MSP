/**
 * MSP Directory — screen registration.
 *
 * MSPs → Tenants (Customers) → Users, RBAC Groups, and OU placeholders, as a
 * real directory browser over the platform's own `msps`/`tenants`/`users`
 * tables — the adminv2-shell front end for the initiative documented at
 * `docs/build-plans/active-directory.md` (all 10 phases Done against the old
 * admin panel's own `ActiveDirectoryPage.tsx`). Every read and write here
 * calls the exact same real backend routes that page already used
 * (`admin-active-directory.ts`, `consent.ts`, `msp-diagnostics.ts`,
 * `msp-admin-settings.ts`) — this is new shell chrome over shipped data, not
 * new fabricated data.
 *
 * `msp`/`user`/`group`/`ou` were added to `PEEK_KINDS` (`registry/types.ts`)
 * for this screen, and `ScreenRenderContext` grew a `kind` field so one
 * screen can host five distinct record types — see those files' comments.
 *
 * Known gap, matching the shell's own "Known gaps" convention in SHELL.md:
 * no live count is wired onto the Watch tab for this screen (e.g. tenants
 * not connected, MSPs past due). Doing that honestly needs a background
 * poll independent of whether anyone has opened this screen; out of scope
 * here, and better done once a screen actually needs the Watch tab.
 */

import {
  Briefcase,
  FolderPlus,
  KeyRound,
  Link as LinkIcon,
  LogIn,
  Plus,
  ShieldCheck,
  ShieldOff,
  Users,
  UserCircle,
} from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, ContextualTabSpec } from "../../registry/types";
import { DirCanvas } from "./DirCanvas";
import { DirExplorerTree } from "./DirExplorerTree";
import { DirProperties } from "./DirProperties";
import { getDirAdminFetch } from "./dirAuthBridge";
import { createDirMsp, createDirOu } from "./dirApi";
import { getDirCacheSize, getDirCachedRecord, getAllDirCachedRecords, type DirCacheKind } from "./dirNameCache";
import { requestDirRecordAction, requestDirTreeRefresh } from "./dirEvents";

function toneHex(tone: "good" | "warn" | "bad" | undefined): string | undefined {
  if (tone === "good") return ACCENT.greenSoft;
  if (tone === "warn") return ACCENT.amber;
  if (tone === "bad") return ACCENT.danger;
  return undefined;
}

function openDirRecord(kind: DirCacheKind, id: string, label: string) {
  getShellApi()?.navigate("/msp-directory");
  getShellApi()?.openDoc({ kind, id, screenId: "msp-directory", label });
}

async function onNewMsp() {
  const adminFetch = getDirAdminFetch();
  if (!adminFetch) return;
  const name = window.prompt("New MSP name:");
  if (!name?.trim()) return;
  const suggestedSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = window.prompt("Slug (used in URLs, cannot change afterwards):", suggestedSlug);
  if (!slug?.trim()) return;
  const domain = window.prompt("Primary domain (optional):", "") ?? undefined;
  try {
    const msp = await createDirMsp(adminFetch, { name: name.trim(), slug: slug.trim(), domain: domain?.trim() || undefined });
    requestDirTreeRefresh();
    openDirRecord("msp", String(msp.id), msp.name);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Failed to create the MSP.");
  }
}

async function onNewOu() {
  const adminFetch = getDirAdminFetch();
  if (!adminFetch) return;
  const name = window.prompt("New organizational unit name:");
  if (!name?.trim()) return;
  try {
    const ou = await createDirOu(adminFetch, name.trim());
    requestDirTreeRefresh();
    openDirRecord("ou", String(ou.id), ou.name);
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Failed to create the OU.");
  }
}

registerScreen({
  id: "msp-directory",
  title: "MSP Directory",
  area: "msp-directory",
  icon: Users,
  route: "/msp-directory",
  render: (ctx) => <DirCanvas {...ctx} />,
  left: { title: "Explorer", render: () => <DirExplorerTree /> },
  right: { title: "Properties", render: () => <DirProperties /> },

  ribbon: [
    {
      tab: "msp-directory",
      group: {
        label: "MSP Directory",
        large: [
          {
            label: "Open MSP Directory",
            icon: Users,
            intent: "open",
            onSelect: () => getShellApi()?.navigate("/msp-directory"),
          },
        ],
        small: [
          { label: "New MSP", icon: Plus, intent: "create", onSelect: () => void onNewMsp() },
          { label: "New organizational unit", icon: FolderPlus, intent: "create", onSelect: () => void onNewOu() },
        ],
      },
    },
  ],

  contextualTab: (ctx): ContextualTabSpec | null => {
    if (!ctx.kind || !ctx.recordId) return null;
    const id = ctx.recordId;

    if (ctx.kind === "customer") {
      return {
        id: "dir-tenant-tools",
        label: "Tenant Tools",
        groups: [
          {
            label: "Tenant",
            large: [
              {
                label: "Run scan",
                icon: ShieldCheck,
                intent: "record",
                onSelect: () => requestDirRecordAction({ action: "run-scan", kind: "customer", id }),
              },
            ],
            small: [
              {
                label: "Revoke Graph consent",
                icon: ShieldOff,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => requestDirRecordAction({ action: "revoke-graph-consent", kind: "customer", id }),
              },
              {
                label: "Copy re-consent link",
                icon: LinkIcon,
                intent: "record",
                onSelect: () => requestDirRecordAction({ action: "copy-reconsent-link", kind: "customer", id }),
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "user") {
      return {
        id: "dir-account-tools",
        label: "Account Tools",
        groups: [
          {
            label: "Accounts",
            large: [
              {
                label: "Impersonate",
                icon: LogIn,
                intent: "record",
                onSelect: () => requestDirRecordAction({ action: "impersonate", kind: "user", id }),
              },
            ],
            small: [
              {
                label: "Force password reset",
                icon: KeyRound,
                intent: "record",
                onSelect: () => requestDirRecordAction({ action: "force-password-reset", kind: "user", id }),
              },
              {
                label: "Reset MFA",
                icon: ShieldOff,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => requestDirRecordAction({ action: "reset-mfa", kind: "user", id }),
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "msp") {
      const cached = getDirCachedRecord("msp", id);
      const suspended = cached?.tag === "suspended";
      return {
        id: "dir-msp-tools",
        label: "MSP Tools",
        groups: [
          {
            label: "Billing",
            large: [
              {
                label: suspended ? "Reactivate" : "Suspend",
                icon: Briefcase,
                intent: "record",
                color: suspended ? ACCENT.green : ACCENT.danger,
                onSelect: () =>
                  requestDirRecordAction({ action: suspended ? "reactivate-msp" : "suspend-msp", kind: "msp", id }),
              },
            ],
            small: [
              {
                label: "Impersonate",
                icon: LogIn,
                intent: "record",
                onSelect: () => requestDirRecordAction({ action: "impersonate", kind: "msp", id }),
              },
            ],
          },
        ],
      };
    }

    return null;
  },

  peeks: {
    msp: (id) => {
      const c = getDirCachedRecord("msp", id);
      if (!c) return null;
      return {
        kind: "msp",
        title: c.title,
        sub: c.sub,
        icon: Briefcase,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openDirRecord("msp", id, c.title),
      };
    },
    customer: (id) => {
      const c = getDirCachedRecord("customer", id);
      if (!c) return null;
      return {
        kind: "customer",
        title: c.title,
        sub: c.sub,
        icon: Users,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openDirRecord("customer", id, c.title),
      };
    },
    user: (id) => {
      const c = getDirCachedRecord("user", id);
      if (!c) return null;
      return {
        kind: "user",
        title: c.title,
        sub: c.sub,
        icon: UserCircle,
        tone: ACCENT.info,
        tag: c.tag,
        tagTone: toneHex(c.tagTone),
        open: () => openDirRecord("user", id, c.title),
      };
    },
    group: (id) => {
      const c = getDirCachedRecord("group", id);
      if (!c) return null;
      return {
        kind: "group",
        title: c.title,
        sub: c.sub,
        icon: ShieldCheck,
        tone: ACCENT.info,
        open: () => openDirRecord("group", id, c.title),
      };
    },
    ou: (id) => {
      const c = getDirCachedRecord("ou", id);
      if (!c) return null;
      return {
        kind: "ou",
        title: c.title,
        icon: FolderPlus,
        tone: ACCENT.info,
        open: () => openDirRecord("ou", id, c.title),
      };
    },
  },

  commands: () => {
    const items: CommandItem[] = [
      {
        id: "act:ad-new-msp",
        type: "action",
        kind: "run",
        name: "New MSP",
        sub: "Creates an empty MSP",
        area: "msp-directory",
        run: () => void onNewMsp(),
      },
      {
        id: "act:ad-new-ou",
        type: "action",
        kind: "run",
        name: "New organizational unit",
        sub: "Placeholder container, no policy yet",
        area: "msp-directory",
        run: () => void onNewOu(),
      },
      {
        id: "ans:ad-msp-count",
        type: "answer",
        name: "MSPs in the directory",
        live: String(getDirCacheSize("msp")),
        area: "msp-directory",
        run: () => getShellApi()?.navigate("/msp-directory"),
      },
      {
        id: "ans:ad-tenant-count",
        type: "answer",
        name: "Tenants in the directory",
        live: String(getDirCacheSize("customer")),
        area: "msp-directory",
        run: () => getShellApi()?.navigate("/msp-directory"),
      },
    ];

    for (const { id, record } of getAllDirCachedRecords("msp")) {
      items.push({
        id: `rec:ad-msp-${id}`,
        type: "record",
        kind: "msp",
        name: record.title,
        sub: record.sub,
        tag: record.tag,
        area: "msp-directory",
        run: () => openDirRecord("msp", id, record.title),
      });
    }
    for (const { id, record } of getAllDirCachedRecords("customer")) {
      items.push({
        id: `rec:ad-customer-${id}`,
        type: "record",
        kind: "customer",
        name: record.title,
        sub: record.sub,
        tag: record.tag,
        area: "msp-directory",
        run: () => openDirRecord("customer", id, record.title),
      });
    }
    for (const { id, record } of getAllDirCachedRecords("user")) {
      items.push({
        id: `rec:ad-user-${id}`,
        type: "record",
        kind: "user",
        name: record.title,
        sub: record.sub,
        area: "msp-directory",
        run: () => openDirRecord("user", id, record.title),
      });
    }
    for (const { id, record } of getAllDirCachedRecords("group")) {
      items.push({
        id: `rec:ad-group-${id}`,
        type: "record",
        kind: "group",
        name: `${record.title} (role)`,
        sub: record.sub,
        area: "msp-directory",
        run: () => openDirRecord("group", id, record.title),
      });
    }

    return items;
  },
});
