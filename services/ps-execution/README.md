# ps-execution

Standalone Docker image for the containerized PowerShell execution service
(epic #180).

- **Phase 1 (#196):** image builds with `ExchangeOnlineManagement` baked in
  at build time and starts fast. No Azure, no cert handling, no
  request-handling entrypoint, no live tenant connection.
- **Phase 2 (#198, this phase):** `entrypoint.ps1` — at container startup,
  retrieves the app-only auth certificate and a shared bearer token from
  Azure Key Vault via the Container App's Managed Identity (no static
  credential in the image or in Container Apps config), then serves HTTP
  requests, rejecting anything that doesn't present the bearer token. Still
  no `Connect-IPPSSession`, no live tenant connection, and no real
  request/response API contract — those are later phases.

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

```
curl -i http://localhost:8080/ -H "Authorization: Bearer <the-real-bearer-token>"
```

Should return `200` with `{"status":"ok","certLoaded":true,"authOk":true}`.
Omitting the header, or sending the wrong token, should return `401`.

**Not verified in this environment** — this Windows/MINGW64 dev checkout has
no Docker CLI and no reachable Azure Managed Identity/IMDS endpoint (that
endpoint only exists inside a real Azure compute resource). Shane needs to
build and run this in a real dev Container App instance (or anywhere IMDS is
reachable) to confirm the secrets retrieve successfully and the bearer-token
gate behaves as above.

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
