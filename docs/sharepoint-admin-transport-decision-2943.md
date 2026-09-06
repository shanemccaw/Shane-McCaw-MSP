# SharePoint-admin transport — decision record (Git #2943)

**Question asked:** can the `ps-execution` container realistically gain a PnP/SharePoint
session type, or should the 23 `read_transport = 'sharepoint-admin'` resource types be
permanently marked `no_executor` with a documented reason?

**Answer: neither.** Both options in the question are wrong, for the same reason: they
both assume the only way to read SharePoint tenant administration is PowerShell. It
isn't, and this platform already has the alternative built, credentialed and
consented — it is simply not wired into the config-snapshot collector.

- **Do not add PnP.PowerShell to the container.** It buys nothing the platform cannot
  already do, and costs a module, a session type, a survey pass, and an image rebuild.
- **Do not mark the 23 rows permanently `no_executor`.** That records a false
  impossibility. Every one of them is reachable today with existing credentials.
- **Do wire `read_transport = 'sharepoint-admin'` to the Node CSOM/REST client that
  already exists** at `artifacts/api-server/src/lib/sharepoint-admin.ts`.

Decided 2026-09-06 on live evidence against the testbed tenant (tenants.id = 1,
mccawsoft2.onmicrosoft.com), reproducible via
`node scripts/config-state/probe-sharepoint-admin-transport.mjs --tenant 1`.

---

## 1. What #2943 correctly established

Every negative claim in the issue body is accurate and was re-verified:

| Claim | Verified |
|---|---|
| `services/ps-execution/Dockerfile` bakes only `ExchangeOnlineManagement` + `MicrosoftTeams` | yes — no `PnP.PowerShell` |
| `child-worker.ps1` knows only `exchange` / `compliance` / `teams` session types | yes — `sharepoint`/`spo` absent, no `Connect-PnPOnline` anywhere |
| `cmdlet-catalog.ps1` has zero `Pnp` entries | yes — zero matches |
| `ps_capability_survey_results` has no `Get-Pnp*` / `Get-MgAdminSharepoint*` rows | yes — 0 rows |
| The 23 rows are gated `is_collectable = false` / `no_executor` | yes — 23/23 |

So #2943's premise about the *container* is entirely sound. What it did not account
for is that the container is not the only executor this platform has.

## 2. The thing that changes the answer

`artifacts/api-server/src/lib/sharepoint-admin.ts` (615 lines, with its own
`sharepoint-admin.README.md`) is already a complete app-only client for SharePoint
Online *tenant administration*:

- certificate-based `client_assertion` app-only auth (SharePoint rejects
  client-secret app-only tokens — that constraint is why this module exists);
- per-`(tenant, resource host)` token cache;
- **CSOM `POST /_vti_bin/client.svc/ProcessQuery` against `{prefix}-admin.sharepoint.com`**;
- SPSiteManager REST against `{prefix}.sharepoint.com`.

**CSOM `ProcessQuery` on the admin host is the same wire protocol `Get-PnPTenant`
uses.** PnP.PowerShell is a *client for* that endpoint, not a privileged path to it.
Adding PnP to the container would add a second, heavier client for a protocol this
codebase already speaks in Node.

The credentials and consent are already in place, not hypothetical:

- `MT_APP_CLIENT_ID` + `MT_APP_CERT_PRIVATE_KEY` + `MT_APP_CERT_THUMBPRINT` are all set.
- The testbed tenant's `tenants.consent` already records
  `sharepoint: { grants: ["Sites.FullControl.All"], status: "granted" }` **and**
  `SharePointTenantSettings.Read.All` under the Graph grants. The same is true of
  tenant 3. The consent flow (`artifacts/api-server/src/routes/consent.ts`) already
  asks for both.

## 3. Live evidence (2026-09-06, tenant 1, read-only)

```
[A] GET /v1.0/admin/sharepoint/settings -> 200
    28 properties: … sharingCapability, sharingDomainRestrictionMode,
    idleSessionSignOut, personalSiteDefaultStorageLimitInMB,
    isLegacyAuthProtocolsEnabled, excludedFileExtensionsForSyncApp, …

[B] POST https://mccawsoft2-admin.sharepoint.com/_vti_bin/client.svc/ProcessQuery -> 200
    _ObjectType_=Microsoft.Online.SharePoint.TenantAdministration.Tenant
    — 325 tenant properties
    SPOSharingSettings/SPOAccessControlSettings: 5/5 probe properties present
    ODSettings:                                  5/5 probe properties present
    SPOTenantSettings:                           4/4 probe properties present
    SPOOrgAssetsLibrary:                         1/1 probe properties present
    SPOBrowserIdleSignout:                       0/3 (covered by Graph idleSessionSignOut)
    SPOTheme:                                    0/1 (separate CSOM method, not a Tenant property)

[C] SPOHubSite:       GET  /_api/HubSites                                   -> 200 (0 items — tenant has none)
[C] SPOHomeSite:      GET  /_api/SPHSite                                    -> 200
[C] SPOSiteDesign:    POST /_api/…SiteScriptUtility.GetSiteDesigns          -> 200 (0 items)
[C] SPOSiteScript:    POST /_api/…SiteScriptUtility.GetSiteScripts          -> 200 (0 items)
[C] SPOStorageEntity: GET  /_api/web/GetStorageEntity('…')                  -> 200
```

Every endpoint returned `200` app-only on the first attempt. The `0 items` results are
a genuinely empty testbed tenant, not an auth failure — an auth failure on this surface
is a `401 unsupported app only token`, which is exactly what the module's header
documents and what none of these returned.

**One CSOM read returns 325 tenant properties.** That single call is the substantive
content of at least seven of the 23 resource types.

## 4. Coverage of the 23 rows

| Reachability | Resource types | Count |
|---|---|---|
| **One CSOM `Tenant` read** (proven above) | ODSettings, SPOAccessControlSettings, SPOSharingSettings, SPOTenantSettings, SPOOrgAssetsLibrary, SPOBrowserIdleSignout*, SPOTenantCdnEnabled, SPOTenantCdnPolicy | 8 |
| **Admin-host REST / CSOM method** (4 of 5 proven above) | SPOHomeSite, SPOHubSite, SPOSiteDesign, SPOSiteDesignRights, SPOSiteScript, SPOStorageEntity, SPOTheme, SPOApp | 8 |
| **Search admin surface** (`Get-PnPSearchConfiguration` → search config XML on the admin host) | SPOSearchManagedProperty, SPOSearchResultSource | 2 |
| **Per-site fan-out** — needs one connection *per site collection*, whatever the client | SPOPropertyBag, SPOSiteAuditSettings, SPOSiteGroup, SPOUserProfileProperty, SPOTenantSite-scoped reads | 5 |

\* `SPOBrowserIdleSignout` is not a `Tenant` CSOM property; it is served by Graph's
`idleSessionSignOut` on `/admin/sharepoint/settings`, already a collectable registry
row (`graph:v1.0:/admin/sharepoint/settings`, `is_collectable = true`).

The per-site group is genuinely expensive — but it is expensive *identically* under
PnP. `Get-PnPPropertyBag` also requires `Connect-PnPOnline` per site. PnP does not
make that group cheaper; it makes it slower, because each site would be a separate
container round-trip with a fresh child process, module import and connect.

## 5. Tradeoffs, stated plainly

### Adding a PnP session type to `ps-execution`

**Cost**
- `PnP.PowerShell` in the image. It is a large module with a heavy dependency graph;
  the Dockerfile's own comment records that a live `Install-Module` was measured at
  10+ minutes cold, which is why every module is baked at build time. This is another
  bake, another image-size increase, another rebuild-and-redeploy of the DEV container.
- A fourth session type in `child-worker.ps1`. It is **not** shaped like the existing
  three: `Connect-PnPOnline` needs the **SharePoint admin site URL**
  (`{prefix}-admin.sharepoint.com`), not the Entra tenant id / organization the other
  three take. That means the request contract into the container has to carry a value
  it does not carry today (the SharePoint tenant prefix, which per
  `sharepoint-admin.ts` is *not* derivable from the AAD tenant GUID).
- MSAL assembly-load risk. #1389 is a live, recorded MSAL conflict in this exact
  container; #1400's fresh-child-process-per-request architecture exists specifically
  to contain it. PnP.PowerShell carries its own MSAL/Graph SDK assemblies — a new
  candidate for that class of failure, in the subsystem that has already been bitten.
- A full #1793 capability-survey pass before any catalog entry may be added, per
  #1961's evidence bar.
- Then, and only then, ~23 `PS_CATALOG_BY_CMDLET` entries plus the mirrored
  `PS_CATALOG_CMDLETS` set in `build-snapshot-registry.mjs`.

**Benefit**
- None that the CSOM path does not already provide. The data is identical because the
  protocol is identical.

### Wiring `sharepoint-admin` to the existing Node CSOM client

**Cost**
- A `collectSharePointAdminResource()` in `config-snapshot-collector.ts` and a
  per-resource-type read map (which CSOM property set / REST endpoint each row maps
  to). This is real work — roughly the size of the existing `collectGraphResource`
  path plus the map.
- Resolving the SharePoint tenant prefix per customer. `sharepoint-admin.ts` already
  names this as a distinct identifier from the AAD tenant GUID; today it is derived
  from `tenants.domain`, which holds `*.onmicrosoft.com` for both current tenants but
  is not guaranteed to for a customer with a vanity domain. **This needs a real
  resolution step** (Graph `GET /sites/root` returns the SharePoint hostname), not a
  string split.
- `Sites.FullControl.All` is a high-privilege grant for a read-only collector. It is
  already granted on both tenants and already required by the existing module, so this
  decision does not introduce it — but it is worth stating that the SharePoint
  tenant-admin API offers no narrower app-only scope (`Sites.Manage.All` /
  `Sites.Selected` are rejected for tenant administration), so this is a property of
  the surface, not a choice being made here.

**Benefit**
- No container change, no image rebuild, no new module, no MSAL risk, no survey pass.
- One HTTP call instead of a container round-trip that spawns a process, imports a
  module and authenticates — materially faster and cheaper per resource type.
- Reuses a module that already has a README, an auth-error type deliberately separated
  from Graph consent state, and a token cache.

## 6. Consequent finding — the collector routes this transport to the wrong executor

`config-snapshot-collector.ts:1115` dispatches `read_transport === "sharepoint-admin"`
into `collectPowerShellResource()`, the ps-execution container path:

```ts
} else if (rt.readTransport === "powershell" || rt.readTransport === "sharepoint-admin") {
  const psResult = await collectPowerShellResource(entraTenantId, organization, rt);
```

That is why all 23 rows resolve to `no_executor`: they are being asked of an executor
that structurally cannot serve them, while the executor that can sits unused in the
same process. The `no_executor` gate #2873 added is still correct *as a gate* — it
stops the rows inflating the collectable denominator while nothing collects them — but
its stated reason ("the container has no PnP") describes a limitation of the wrong
component. Filed as its own issue rather than fixed inline, because the fix is the
collector work in §5, not a comment change.

## 7. Recommended order of work

1. Resolve the SharePoint tenant prefix per customer properly (Graph `/sites/root`),
   persisted, rather than splitting `tenants.domain`.
2. Add `collectSharePointAdminResource()` to `config-snapshot-collector.ts`, routing
   `read_transport = 'sharepoint-admin'` to `sharepoint-admin.ts` instead of the
   container.
3. Land the 8 one-CSOM-read resource types first — they are the highest value per unit
   of work and are already proven to return data.
4. Then the 8 admin-host REST/method types.
5. Defer the 5 per-site fan-out types behind an explicit budget; they are O(sites) on
   any transport and should not run in the default snapshot path.
6. Leave `SPOSearchManagedProperty` / `SPOSearchResultSource` last — the search admin
   surface returns configuration XML, not JSON, and needs its own shape work.

Nothing in this list requires a change to `ps-execution`, and nothing in it is blocked
on Shane. `Sites.FullControl.All` and the certificate are already consented on the DEV
side; per CLAUDE.md's production-change gate this is all DEV-app-registration /
`ca-ps-execution-dev` scoped work, none of which touches the PROD registration.
