---
name: CRM admin vs client routing architecture
description: Admin CRM sections live in Admin Panel (/admin-panel/), not in the CRM artifact (/crm/). Admins hitting /crm are cross-artifact redirected.
---

**Architecture decision:** The CRM artifact at `/crm` is for the **client portal** (client-role users). All admin-facing CRM management sections (Leads, Clients, Projects, Services, Reports, Invoices, Documents, Messages, Purchases, Contracts) live in the Admin Panel at `/admin-panel/crm/*`.

**Why:** Consolidation — admins have one place to manage everything. The client portal remains clean.

**Cross-artifact redirects:** Since Wouter's `<Redirect>` is scoped to the artifact's base path, admin redirects out of the CRM artifact use `window.location.href = "/admin-panel/"` and `window.location.replace("/admin-panel/")` — NOT wouter `<Redirect>`.

**How to apply:** Any new admin-only CRM feature → add to Admin Panel (`artifacts/admin-panel/src/pages/crm/`), add route to App.tsx, add nav item to DashboardShell.tsx NAV_GROUPS["CRM"].items.
