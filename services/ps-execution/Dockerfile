# PowerShell execution container.
#
# Phase 1 (#196): prove a Docker image builds with ExchangeOnlineManagement
# baked in at build time and starts fast.
# Phase 2 (#198): request-handling entrypoint that retrieves the app-only
# auth cert + a shared bearer token from Azure Key Vault via Managed
# Identity at startup, and rejects any request missing the bearer token.
# Still no live Connect-IPPSSession / tenant connection — that's a later
# phase of the containerized execution service epic (#180).
#
# Pinned per #199: mcr.microsoft.com/powershell doesn't publish full
# patch-level tags for this OS, only major.minor-os rolling tags. 7.4 is
# the current LTS branch; this avoids `latest`'s multi-platform manifest
# list (which also includes Windows/arm images and was, at pin time,
# floating on an older 7.4.2 patch than this tag's 7.4.6).
FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04

# Bake ExchangeOnlineManagement into the image now, so container startup
# never triggers a live PSGallery install. A live Install-Module was
# measured at 10+ minutes cold on Replit's Nix container — this pays that
# cost once, at intentional image-build time, never per deploy or request.
# v3.0.0+ is required for certificate-based app-only Connect-IPPSSession
# auth (see #180 architecture comment).
#
# #1253: MicrosoftTeams baked in the same way, for the new "teams"
# ps-execution session type (Get-CsOnlineUser / Get-CsTeamsMeetingPolicy).
# v5.0.0+ is required for certificate-based app-only Connect-MicrosoftTeams
# auth (-Certificate accepting an X509Certificate2 object directly, the same
# shape ExchangeOnlineManagement's Connect-ExchangeOnline already uses above)
# — not independently verified against a live install from this environment,
# same class of gap #180's own architecture comment already documents for
# this file; flagged for Shane to confirm once this image actually builds.
RUN pwsh -NoLogo -NonInteractive -Command " \
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; \
    Install-Module -Name ExchangeOnlineManagement -MinimumVersion 3.0.0 -Scope AllUsers -Force -AllowClobber -AcceptLicense; \
    Install-Module -Name MicrosoftTeams -MinimumVersion 5.0.0 -Scope AllUsers -Force -AllowClobber -AcceptLicense; \
    Get-Module -ListAvailable -Name ExchangeOnlineManagement, MicrosoftTeams"

# Phase 2 (#198) request-handling entrypoint. See entrypoint.ps1 for the
# Managed Identity -> Key Vault -> secrets round-trip and the bearer-token
# gate on incoming requests.
#
# #1400: entrypoint.ps1 is now a thin dispatcher only — it spawns
# child-worker.ps1 as a fresh process per request (the real fix for
# #1389's MSAL assembly-load conflict). common.ps1 (shared logging) and
# cmdlet-catalog.ps1 (the allowlist) are dot-sourced by both.
COPY common.ps1 /app/common.ps1
COPY cmdlet-catalog.ps1 /app/cmdlet-catalog.ps1
COPY child-worker.ps1 /app/child-worker.ps1
COPY entrypoint.ps1 /app/entrypoint.ps1

# Container Apps default ingress target port; override via the PORT env var
# if the Container App is configured differently.
EXPOSE 8080

CMD ["pwsh", "-NoLogo", "-NonInteractive", "-File", "/app/entrypoint.ps1"]
