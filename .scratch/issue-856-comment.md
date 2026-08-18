## Code fix applied

Added `IdentityRiskEvent.Read.All` to `REQUIRED_MT_SCOPES` in `artifacts/api-server/src/lib/graph.ts`, next to the existing `IdentityRiskyUser.Read.All` / `IdentityRiskyServicePrincipal.Read.All` entries — the only remaining code change per the build plan.

- `tsc --noEmit` (api-server): 76 errors, identical to the pre-existing baseline, 0 in the touched file.
- No other files touched (endpoint fix already landed in #492).

**Remaining Shane action (unchanged, not attempted here):** re-run admin consent on every tenant — scope changes force re-consent per existing policy. The code change alone does not grant anything live; `identity:risky-signins` will keep 403ing until that consent re-run happens.

Commits: `12bba68a` (IN FLIGHT bookend), `59c6c00c` (scope addition), `72940ead` (DONE bookend).
