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
# Confirm the base image tag is still current before rebuilding — pin to a
# specific tag (not `latest`) once verified, for build reproducibility.
FROM mcr.microsoft.com/powershell:latest

# Bake ExchangeOnlineManagement into the image now, so container startup
# never triggers a live PSGallery install. A live Install-Module was
# measured at 10+ minutes cold on Replit's Nix container — this pays that
# cost once, at intentional image-build time, never per deploy or request.
# v3.0.0+ is required for certificate-based app-only Connect-IPPSSession
# auth (see #180 architecture comment).
RUN pwsh -NoLogo -NonInteractive -Command " \
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; \
    Install-Module -Name ExchangeOnlineManagement -MinimumVersion 3.0.0 -Scope AllUsers -Force -AllowClobber -AcceptLicense; \
    Get-Module -ListAvailable -Name ExchangeOnlineManagement"

# Phase 2 (#198) request-handling entrypoint. See entrypoint.ps1 for the
# Managed Identity -> Key Vault -> secrets round-trip and the bearer-token
# gate on incoming requests.
COPY entrypoint.ps1 /app/entrypoint.ps1

# Container Apps default ingress target port; override via the PORT env var
# if the Container App is configured differently.
EXPOSE 8080

CMD ["pwsh", "-NoLogo", "-NonInteractive", "-File", "/app/entrypoint.ps1"]
