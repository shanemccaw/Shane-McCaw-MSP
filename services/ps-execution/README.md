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
