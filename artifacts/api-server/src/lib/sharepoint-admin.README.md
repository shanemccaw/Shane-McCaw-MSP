# SharePoint Online — App-Only Tenant Administration (`sharepoint-admin.ts`)

Connection/auth layer for **SharePoint Online tenant administration** — the
operations Microsoft Graph does **not** cover: site-collection create/delete,
tenant-wide external sharing settings, and per-site storage quota.

This is the same *shape* of extension as `Exchange.ManageAsApp`: a **second
resource audience** under the **same multi-tenant App Registration** and the same
OAuth2 client-credentials flow the platform already uses for Microsoft Graph
(`graph.ts`) and the O365 Management Activity API — **not** a new app, and **not**
a new auth model.

---

## 1. Required Application permission (AUDIT RESULT — confirmed, not guessed)

| Permission | API surface (resource) | Type | Consent |
|---|---|---|---|
| `Sites.FullControl.All` | **Office 365 SharePoint Online** — resource appId `00000003-0000-0ff1-ce00-000000000000` | Application | Admin consent per customer tenant |

Notes:

- This permission lives under the **"Office 365 SharePoint Online"** API in the
  app-registration "API permissions" blade — **not** under Microsoft Graph. This
  is exactly the same pattern as `Exchange.ManageAsApp` living under
  **"Office 365 Exchange Online"** rather than Graph.
- **SharePoint tenant-admin APIs (both the SPSiteManager REST endpoints and the
  CSOM `ProcessQuery` tenant operations) only accept an app-only token when it
  carries `Sites.FullControl.All`.** Narrower scopes such as `Sites.Manage.All`
  or `Sites.Selected` are **not** sufficient for tenant-level administration
  (site create/delete, sharing capability, storage quota).
- Source: [Granting access via Microsoft Entra ID App-Only](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly-azuread).

This requirement is also declared in code as
`REQUIRED_SHAREPOINT_APP_PERMISSIONS` in `sharepoint-admin.ts`, mirroring how
`graph.ts` declares `REQUIRED_MT_SCOPES` (kept separate because that array is
Graph `.default` scopes only).

---

## 2. Auth mechanism — **certificate required** (critical, differs from Graph)

**SharePoint Online rejects client-secret app-only tokens.** Graph and the
Management Activity API happily accept a token acquired with `MT_APP_CLIENT_SECRET`
(client secret). The SharePoint resource does **not** — it returns an
*"unsupported app only token"* / `401` and mandates a **certificate**-based
token (a signed `client_assertion` JWT).

Consequences for this platform:

- The MT App Registration currently has **only a client secret**
  (`MT_APP_CLIENT_SECRET`, used by `graph.ts`). To make this module function, a
  **certificate must be added to that same app registration** and admin-consented
  with `Sites.FullControl.All`. This is a *second credential on the existing app*,
  not a new app.
- `sharepoint-admin.ts` therefore acquires tokens via an RS256 `client_assertion`
  JWT (same `jsonwebtoken`/RS256 idiom already used in `search-console.ts` for
  Google), stamping the certificate's SHA-1 thumbprint into the JWT `x5t` header.

### Environment variables

| Var | Shared with | Purpose |
|---|---|---|
| `MT_APP_CLIENT_ID` | `graph.ts` (Graph/Activity API) | The multi-tenant app's client id — **reused, not duplicated**. |
| `MT_APP_CERT_PRIVATE_KEY` | *new* | PEM private key of the certificate uploaded to the MT app registration. `\n`-escaped newlines are accepted. |
| `MT_APP_CERT_THUMBPRINT` | *new* | SHA-1 thumbprint (hex) of that certificate, as shown in the Azure portal. |

`sharePointAdminCredentialsPresent()` guards on all three. It deliberately does
**not** treat `MT_APP_CLIENT_SECRET` as sufficient, because a secret cannot
authenticate to the SharePoint resource.

> **Open item for the platform owner:** upload a certificate to the existing MT
> app registration (or reuse the Exchange app-only cert if one already exists),
> grant `Sites.FullControl.All`, admin-consent per tenant, and populate the two
> new env vars. Until then these functions will raise `SharePointAuthError`.

---

## 3. Resource audiences & token cache

SharePoint tokens are **audience-scoped to a specific host**, unlike Graph
(always `graph.microsoft.com`). Two hosts are used, both derived from the
tenant's SharePoint name prefix (`SharePointTenantRef.sharePointTenantPrefix`,
e.g. `contoso`):

| Host | Used for |
|---|---|
| `https://{prefix}.sharepoint.com` | SPSiteManager REST (site create/delete/status) |
| `https://{prefix}-admin.sharepoint.com` | CSOM `ProcessQuery` (sharing capability, storage quota) |

The `.default` scope becomes `https://{host}/.default`. Tokens are cached per
`(aadTenantId | host)` in `sharePointTokenCache`, mirroring `graph.ts`'s
`tenantTokenCache` shape.

`SharePointTenantRef.aadTenantId` (the Entra ID tenant **GUID**) is used only for
the `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` endpoint and is
generally **not** the same string as `sharePointTenantPrefix`.

---

## 4. Operation → real endpoint shape (AUDIT RESULT)

| Function | Transport | Endpoint | Confidence |
|---|---|---|---|
| `createSiteCollection` | REST JSON | `POST /_api/SPSiteManager/create` | **High** — [documented](https://learn.microsoft.com/en-us/sharepoint/dev/apis/site-creation-rest). `Owner` is **required** for app-only. |
| `deleteSiteCollection` | REST JSON | `POST /_api/SPSiteManager/delete` (`{ siteId }`) | **High** — documented. |
| `getSiteStatus` | REST JSON | `GET /_api/SPSiteManager/status?url='…'` | **High** — documented. |
| `getTenantSharingCapability` / `setTenantSharingCapability` | **CSOM** | `POST /_vti_bin/client.svc/ProcessQuery` (admin host) | **Medium** — see below. |
| `getSiteStorageQuota` / `setSiteStorageQuota` | **CSOM** | `POST /_vti_bin/client.svc/ProcessQuery` (admin host) | **Medium** — see below. |

### Why sharing/quota are CSOM, not REST

There is **no documented pure-REST JSON endpoint** for tenant sharing capability
or per-site storage quota. `Set-SPOTenant` / `Set-SPOSite` (and their PnP
equivalents `Set-PnPTenant` / `Set-PnPTenantSite`) are implemented over **CSOM** —
an XML `ObjectPath` query posted to `/_vti_bin/client.svc/ProcessQuery`. This
module builds that XML and posts it with `fetch` (a direct REST call — **not**
PowerShell / PnP.PowerShell invocation), so it honours the "REST/fetch only"
constraint while being honest that the wire format is CSOM.

The CSOM `ProcessQuery` protocol is documented as
[[MS-CSOM]](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-csom/18c961c7-8384-4493-8227-54a3fffdc7cc),
but the concrete `ObjectPath` XML for these specific operations is **not** —
it is reverse-engineered from CSOM/PnP behaviour and is **ObjectPath-index and
`TypeId`-sensitive**. The `Tenant` CSOM `TypeId`
(`{268004ae-ef6b-4e9b-8425-127220d84719}`) is a stable, widely-used constant.

> **These CSOM payloads must be validated against a live tenant before being
> wired into `baseline_action_templates`.** Per this task's scope, that wiring is
> a separate, later task — this module is the connection/auth layer only.

---

## 5. Error handling

`SharePointAuthError` (thrown on `401`/token rejection) deliberately does **not**
flip the shared `tenant_consent` / monitor-profile rows the way `graph.ts`'s
`ConsentRevokedError` → `markTenantConsentRevoked()` does. A SharePoint `401` is
ambiguous — it may mean the certificate is missing/misconfigured, or that
`Sites.FullControl.All` was never granted, rather than that Graph admin consent
(a *different* credential — the client secret) was revoked. Auto-revoking Graph
consent on a SharePoint cert problem would be wrong and noisy, so callers receive
a dedicated, non-DB-mutating error to surface instead.

---

## 6. Logging

All output is on the `integration.sharepoint` channel
(`logger.child({ channel: "integration.sharepoint" })`), a new leaf added to the
locked `integration.*` taxonomy alongside `integration.azure` (registered in
`admin-live-stream.ts`'s `CHANNEL_TAXONOMY`).
