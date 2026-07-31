# PowerShell execution container — Phase 1 (image build only).
#
# Scope: prove a Docker image builds with ExchangeOnlineManagement baked in
# at build time and starts fast. No Azure, no cert handling, no live
# Connect-IPPSSession, no request-handling entrypoint — those are later
# phases of the containerized execution service epic (#180), scoped
# separately once this phase lands. See GitHub issue #196.
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

CMD ["pwsh"]
