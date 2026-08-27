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
