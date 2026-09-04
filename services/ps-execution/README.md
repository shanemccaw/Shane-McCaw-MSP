# ps-execution

Standalone Docker image for the containerized PowerShell execution service
(epic #180).

- **Phase 1 (#196):** image builds with `ExchangeOnlineManagement` baked in
  at build time and starts fast. No Azure, no cert handling, no
  request-handling entrypoint, no live tenant connection.
- **Phase 2 (#198):** `entrypoint.ps1` — at container startup, retrieves the
  app-only auth certificate and a shared bearer token from Azure Key Vault
  via the Container App's Managed Identity (no static credential in the
  image or in Container Apps config), then serves HTTP requests, rejecting
  anything that doesn't present the bearer token.
- **Phase 3 (#210, this phase, per #209's approved design):** real request
  handling. `POST` a JSON body `{ cmdletKey, params }` — `cmdletKey`
  resolves to one of a fixed, code-owned allowlist of approved cmdlet
  invocations (`$script:CmdletCatalog` in `entrypoint.ps1`), never an
  arbitrary script string from the request; `params` fill that cmdlet's
  allowed parameter values only, never control flow. Executes via
  `Connect-IPPSSession` (cert parsed from the Key Vault secret at startup)
  + the resolved cmdlet, capturing the success/output stream only. This
  phase ships one trivial placeholder (`get-connection-info` →
  `Get-ConnectionInformation`, no tenant data involved) to exercise the
  full connect/invoke/capture/disconnect path end to end.
- **Phase 4 (#212, this phase):** the four real DLP/Label cmdlets —
  `get-dlp-policies` → `Get-DlpCompliancePolicy`, `get-dlp-incidents` →
  `Export-ActivityExplorerData` (the current, non-retired DLP-incident
  source — `Get-DlpIncidentDetailReport`/`Get-DlpDetailReport` are both
  retired per Microsoft Learn), `get-labels` → `Get-Label`,
  `get-label-policies` → `Get-LabelPolicy`. Two additional per-entry
  catalog fields (`ResultProperty`, `PostFilter`) exist only for these —
  see the catalog's own comments in `entrypoint.ps1` for why.

Not part of the pnpm workspace — this is a plain Docker image, built and
run independently of the Node/pnpm toolchain.

## Snapshot-shaped unfiltered read entries (#1961)

`#1796`'s configuration-snapshot collector ran live against the testbed and found
**215 registry resource types recorded `skipped` / `no_executor`**: each named a
real read cmdlet this catalog had no entry for. That is #209's boundary working
as designed — `cmdletKey` resolves only to a code-owned entry here and a caller
can never name a cmdlet — so the gap could only be closed inside the container.

#1961 pass 1 added **63 entries**, taking the catalog from 38 to 101 and the
PowerShell-reachable resource types from **5 to 88**. Two rules define them:

- **Unfiltered, always.** A snapshot's consumer is #1797's differ; a check's
  consumer wants the bad subset. A `PostFilter`ed entry used for a snapshot would
  make the differ report every excluded object as *deleted* on the next run. So
  the check-shaped entries are untouched, and five cmdlets that previously existed
  only behind a filter now also have an unfiltered twin under a `get-all-*` key
  (`Get-DkimSigningConfig`, `Get-InboundConnector`, `Get-Label`, `Get-LabelPolicy`,
  `Get-HostedOutboundSpamFilterPolicy`) — the precedent `get-all-dlp-policies`
  (#1301) already set.
- **Chosen from live evidence, not from docs.** Every cmdlet added was recorded
  `status = 'ok'` by #1793's capability survey (run 4) executing it under app-only
  certificate auth *in this container* against the live testbed. That survey only
  probes cmdlets with a zero-mandatory-parameter parameter set, which is why every
  new entry can safely declare `AllowedParams = @()`.

The security posture is unchanged: this widens *which* cmdlets may run and nothing
else. All 63 are literal, code-owned, `Get-*` reads with `AllowedParams = @()` —
the request body cannot fill a single parameter value — and none carries `IsWrite`.

**Deliberately not in pass 1**, tracked as real follow-up rather than left silent:
Teams (`Get-Cs*`, ~54 resource types, a uniform block of its own), and per-user /
per-mailbox / directory enumerations (`Get-Mailbox`, `Get-User`, `Get-Recipient`,
`Get-Group`, `Get-ManagementRoleAssignment`, …) — tenant *inventory* rather than
tenant *configuration*, unbounded in size, and not what a Dev→Test→Prod promotion
moves.

The api-server half is `PS_CATALOG_BY_CMDLET` in
`artifacts/api-server/src/lib/config-snapshot-collector.ts`; without a row there
an entry here exists but nothing routes to it.

## The app-only capability survey (#1793) — `survey.ps1`

Six catalog entries (`survey-list-commands-{compliance,exchange,teams}` and
`survey-probe-{compliance,exchange,teams}`) answer a question nothing else in
this platform has ever measured: **of the several hundred cmdlets these modules
actually export, which ones work under app-only certificate auth?** Microsoft's
documentation describes delegated behaviour and app-only support differs cmdlet
by cmdlet, so the only source of truth is a live run.

`survey.ps1` holds the implementation and is dot-sourced by `child-worker.ps1`
only (the parent never evaluates a `Script` body). Read that file's header for
the full rationale; the two things worth knowing here:

- **The survey is code-owned, not request-driven.** The request supplies only
  `Skip` / `Take` / `BudgetSeconds` — three integers. It cannot name a cmdlet,
  add a parameter to a probed cmdlet, or widen the eligible set. #209's
  what-code-runs-stays-code-owned boundary is fully intact.
- **Read-safety fails closed, from the command's own metadata.** `Get-*` only;
  no `SupportsShouldProcess`; at least one parameter set with zero mandatory
  parameters; not on the unbounded/expensive deny list. `Test-*` is
  deliberately excluded (`Test-Mailflow` sends real mail). Everything rejected
  is recorded `not_attempted` with the literal gate that rejected it — never
  silently dropped, and never reported as "doesn't work".

The results land in `ps_capability_survey_runs` / `ps_capability_survey_results`
(migration `lib/db/migrations/manual/2026-08-30-ps-capability-survey-1793.sql`).
Driver, doc generator, and read route:

```
pnpm --filter @workspace/scripts run ps-capability-survey        # run it
pnpm --filter @workspace/scripts run ps-capability-survey-doc    # regenerate the markdown
GET /api/simulator/ps-execution/capability-survey                # query it
```

`docs/powershell-capability-survey.md` is generated from those tables, never
hand-edited. Nothing in the survey wires a `monitor_checks` row — cataloguing
what works and deciding what to check are separate decisions (#1793's own
non-goal), and the second waits for the resource model in #1795.

## Deploy targets — Dev vs Production (#1385)

There are **two** Container Apps running this image, deliberately isolated so a
redeploy for testing can never hit live production PowerShell execution against
real customer tenants:

| | Production | Dev |
|---|---|---|
| Container App | `ca-ps-execution` | `ca-ps-execution-dev` |
| Endpoint | `https://ca-ps-execution.proudstone-22013f89.eastus2.azurecontainerapps.io/` | `https://ca-ps-execution-dev.proudstone-22013f89.eastus2.azurecontainerapps.io/` |
| Image tag convention | `acrsmccaw2184.azurecr.io/ps-execution:vNN` (e.g. `:v11`) | `acrsmccaw2184.azurecr.io/ps-execution:dev` |
| api-server env var | `PS_EXECUTION_CONTAINER_URL` | `PS_EXECUTION_CONTAINER_URL_DEV` |
| Who redeploys it | Shane, deliberately, at go-live of tested changes | freely, for any dev/testing cycle |

Both live in resource group **`rg-smccaw-2184`** (East US 2), managed environment
**`cae-smccaw-2184`**, and share the **same** Container Registry **`acrsmccaw2184`**
(distinct image tags, not distinct registries — the isolation that matters is at
the Container App level) and the **same** Key Vault **`ShaneMcCawConsulting`**.
Both use a **system-assigned Managed Identity** with exactly two RBAC roles:
`AcrPull` on the registry and `Key Vault Secrets User` on the vault.

**Routing is automatic** — `artifacts/api-server/src/lib/ps-execution-client.ts`
picks the endpoint by the same real dev/prod environment-tiering the rest of the
platform uses (`env.ts` → `isProductionEnvironment` → `stripe.ts`'s
`isReplitDevEnvironment`, the exact signal `getStripeKey()` uses for
sk_test_/sk_live_). Dev → `PS_EXECUTION_CONTAINER_URL_DEV`; Staging/Production →
`PS_EXECUTION_CONTAINER_URL`. Dev **never** falls back to the production URL — an
unset dev URL throws rather than crossing over.

### Deploy to PRODUCTION (`ca-ps-execution`) — Shane only, deliberate

```
# 1. Build a new production image tag from current source (bump the version):
az acr build --registry acrsmccaw2184 --image ps-execution:v12 services/ps-execution

# 2. Point the PRODUCTION container at it:
az containerapp update -n ca-ps-execution -g rg-smccaw-2184 \
  --image acrsmccaw2184.azurecr.io/ps-execution:v12
```

### Deploy to DEV (`ca-ps-execution-dev`) — safe to run freely

```
# 1. Build the dev image tag from current source:
az acr build --registry acrsmccaw2184 --image ps-execution:dev services/ps-execution

# 2. Point the DEV container at it (add --revision-suffix to force a clean revision):
az containerapp update -n ca-ps-execution-dev -g rg-smccaw-2184 \
  --image acrsmccaw2184.azurecr.io/ps-execution:dev --revision-suffix devNNNN
```

### Deploy to DEV — automated & agent-callable (#1277)

The two `az` commands above are automated end-to-end by BuildConsole so neither
Shane nor a build agent has to run them by hand — the whole point of #1277 is to
remove the manual hand-deploy from the `#1482`/`#1483` diagnose → deploy →
read-container-logs loop. It is **DEV-only by construction** (`ca-ps-execution-dev`
is a hardcoded const in `desktop/BuildConsole/Services/PsExecutionDeployService.cs`;
there is no parameter for the Container App name, so this path can never reach
production `ca-ps-execution` — the #1385 isolation is structural, not a runtime
check that could be bypassed).

Agent-callable over the same `shaneapp://` local protocol every other agent action
uses (see `desktop/BuildConsole/AGENT_PROTOCOLS.md`):

```
# Build + push + deploy a fresh revision, then confirm the now-active revision.
# ?path= is the abs path to services/ps-execution in your checkout; ?suffix= optional.
shaneapp://deployPsExecution?src=claude-code&path=<abs services/ps-execution>

# Read-only: which revision is serving RIGHT NOW (Azure control plane)?
shaneapp://psExecutionRevision?src=claude-code
```

Both write a JSON result envelope (default `%TEMP%\shaneapp-<action>.result.json`)
with the confirmed active revision `{ name, image, trafficWeight, createdTime }`.
The precondition is #1277's stated one: `az account show` must already succeed
non-interactively on the build machine — if it doesn't, the handler renders an
honest `blocked: true` state rather than working around an interactive login.

**Verifying WHICH revision is live — two authoritative sources:**

1. **Azure control plane** — `az containerapp revision list … --query "[?properties.active]"`
   (what `psExecutionRevision` returns): the revision Azure has switched traffic to.
2. **The container's own `/healthz`** — an unauthenticated `GET` added in #1277 that
   returns `{ revision, containerApp, image, startedAtUtc, port }` read from the
   `CONTAINER_APP_REVISION` env var Azure injects. This reports the revision of the
   code that is *genuinely executing*. The api-server reads this via
   `artifacts/api-server/src/lib/ps-execution-revision.ts`
   (`getServingPsExecutionRevision()`, channel `integration.azure`) so a #1482 fix is
   verified against the live revision and not a stale one (the #1434 failure mode).

```
# /healthz needs no bearer token (it exposes only deployment metadata, no tenant data):
curl -s https://ca-ps-execution-dev.proudstone-22013f89.eastus2.azurecontainerapps.io/healthz
```

### One-time DEV container provisioning (for reproducibility)

```
# Create the isolated dev Container App. --registry-identity system enables the
# system-assigned MI AND auto-grants it AcrPull on the registry:
az containerapp create --name ca-ps-execution-dev --resource-group rg-smccaw-2184 \
  --environment cae-smccaw-2184 \
  --image acrsmccaw2184.azurecr.io/ps-execution:dev \
  --system-assigned \
  --registry-server acrsmccaw2184.azurecr.io --registry-identity system \
  --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 2 --cpu 0.5 --memory 1.0Gi \
  --env-vars AZURE_KEY_VAULT_URL=https://shanemccawconsulting.vault.azure.net/ \
             MT_APP_CLIENT_ID=9ea2e409-d1b9-422a-8451-02fa0b98d1c3

# Grant the dev MI read access to the same Key Vault secrets prod uses — this
# mirrors production's "Key Vault Secrets User" RBAC role exactly (the vault is
# RBAC-authorized, no access policies). Use the principalId from the create above:
az role assignment create \
  --assignee-object-id <ca-ps-execution-dev principalId> --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/eae24589-2931-4571-9269-0fc6da779f06/resourceGroups/rg-smccaw-2184/providers/Microsoft.KeyVault/vaults/ShaneMcCawConsulting
```

### Live smoke test (#1385, run against the DEV container)

```
# Reads the shared bearer token from Key Vault, then exercises the full
# connect/invoke/capture/disconnect path with the trivial get-connection-info
# cmdlet against the testbed tenant (TEST_TENANT_ID = c4c814d4-…; initial domain
# mccawsoft2.onmicrosoft.com):
TOKEN=$(az keyvault secret show --vault-name ShaneMcCawConsulting --name ps-execution-bearer-token --query value -o tsv)
curl -i https://ca-ps-execution-dev.proudstone-22013f89.eastus2.azurecontainerapps.io/ \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cmdletKey":"get-connection-info","params":{"Organization":"mccawsoft2.onmicrosoft.com"}}'
```

**First real live end-to-end result (2026-08-27, dev container revision
`dev1385a`):** every piece of the container infrastructure works — the
system-assigned MI acquires a token, reads the `mt-app-cert` and
`ps-execution-bearer-token` secrets from Key Vault, imports the modules, parses
the app-only certificate (thumbprint `251BDCD5…`), serves on 8080, and passes the
bearer-token gate. But `Connect-IPPSSession` itself then fails with a **structured
`502 auth_failed`**, and the container console log shows the real cause:

```
Connect-compliance session failed:
Could not load file or assembly 'Microsoft.Identity.Client, Version=4.83.1.0,
Culture=neutral, PublicKeyToken=0a613f4dd989e8ae'.
```

This is a **pre-existing defect in the image itself** (an `Microsoft.Identity.Client`
assembly-version conflict — most likely from importing both
`ExchangeOnlineManagement` and `MicrosoftTeams` into the same pwsh process, which
pull different MSAL versions), **not** a tenant/permission problem and **not** a
consequence of the dev/prod split — the production container is built from the
identical source and would reproduce it. It affects the real DLP/Label/Teams
checks equally on both containers and needs its own follow-up issue; it is
explicitly out of scope for #1385 (which is container isolation). The dev/prod
separation is exactly what lets that MSAL fix be built and verified on
`ca-ps-execution-dev` first, without ever touching live production.

## Phase 2: Key Vault / Managed Identity config

| Env var | Required | Purpose |
|---|---|---|
| `AZURE_KEY_VAULT_URL` | yes | Same Key Vault instance/URL convention as `artifacts/api-server/src/lib/azure-keyvault.ts` — Managed Identity is a different credential path to the same vault, not a different vault. |
| `PS_EXECUTION_CERT_SECRET_NAME` | no (default `mt-app-cert`) | Key Vault secret name holding the app-only auth cert. **Not yet confirmed against a live Key Vault** — no Azure/Managed-Identity reachability from this dev environment. Override if the real name differs. |
| `PS_EXECUTION_BEARER_TOKEN_SECRET_NAME` | no (default `ps-execution-bearer-token`) | Key Vault secret name holding the shared bearer token the api-server uses to call this container. Same not-yet-confirmed caveat as above. |
| `AZURE_MI_CLIENT_ID` | no | Only needed if the Container App's Managed Identity is user-assigned rather than system-assigned. |
| `MT_APP_CLIENT_ID` | no (informational this phase) | Recorded/logged only — see `entrypoint.ps1` for why `MT_APP_CLIENT_ID` is the leading (not yet independently verified) candidate app registration for the cert, per #198's own decision text. |
| `PORT` | no (default `8080`) | HTTP listen port. |

The Container App itself needs a Managed Identity (system- or
user-assigned) granted read access to those two secrets in Key Vault —
infra provisioning is out of scope for this phase, see #198.

## Verify (Phase 2): token round-trip

Omitting the `Authorization` header, or sending the wrong token, should
return `401` regardless of method or body.

## Verify (Phase 3): request handling

```
curl -i http://localhost:8080/ \
  -H "Authorization: Bearer <the-real-bearer-token>" \
  -H "Content-Type: application/json" \
  -d '{"cmdletKey":"get-connection-info","params":{"Organization":"<tenant>.onmicrosoft.com"}}'
```

Should return `200` with a JSON array of the container's current
EXO/IPPS connection info (an array since `Get-ConnectionInformation`
can return multiple items; a single-item result serializes as a bare
object, per #210/#211's response contract).

Structured error cases (never a raw PowerShell exception in the body):
- Non-`POST` method → `405 {"error":"method_not_allowed",...}`
- Malformed JSON body → `400 {"error":"bad_request",...}`
- `params.Organization` missing → `400 {"error":"bad_request",...}`
- Unknown `cmdletKey` → `400 {"error":"unknown_cmdlet",...}`
- `Connect-IPPSSession` failure → `502 {"error":"auth_failed",...}`
- The resolved cmdlet throwing → `500 {"error":"script_error",...}`

**Not verified in this environment** — this Windows/MINGW64 dev checkout has
no Docker CLI, no reachable Azure Managed Identity/IMDS endpoint, and no
live M365 tenant to actually run `Connect-IPPSSession` against. The
`System.Net.HttpListener` request-handling control flow (parsing, allowlist
lookup, param merge, single-vs-array response shaping, every error branch)
was exercised locally against stub replacements for
`Connect-IPPSSession`/`Get-ConnectionInformation`/`Disconnect-ExchangeOnline`
(the real `ExchangeOnlineManagement` module isn't installed outside the
Docker image) and all round-tripped correctly. Shane needs to build, deploy,
and hit this against a real dev Container App + testbed tenant to confirm
the live `Connect-IPPSSession` cert-auth path and the Managed
Identity/Key Vault round-trip together, end to end.

## Build

```
docker build -t ps-execution:local services/ps-execution
```

## Verify: module is baked in, no live install at runtime

```
docker run --rm ps-execution:local pwsh -NoLogo -NonInteractive -Command \
  "Get-Module -ListAvailable -Name ExchangeOnlineManagement"
```

Should print the module immediately — if a container run attempted a live
`Install-Module` from PSGallery, this step is broken and needs a build fix,
not a runtime workaround.

## Verify: fast startup

```
docker run --rm ps-execution:local pwsh -Version
```

Should respond in well under a few seconds. Compare against the 10+ minute
cold `Install-Module` behavior seen on Replit's Nix container, which this
image is built to avoid entirely.
