# ps-execution (Phase 1: image only)

Standalone Docker image for the containerized PowerShell execution service
(epic #180). This phase only proves the image builds with
`ExchangeOnlineManagement` baked in at build time and starts fast — no
Azure, no cert handling, no request-handling entrypoint, no live tenant
connection. See #196 for the full scope and acceptance criteria.

Not part of the pnpm workspace — this is a plain Docker image, built and
run independently of the Node/pnpm toolchain.

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
