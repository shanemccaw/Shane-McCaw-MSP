/**
 * JourneyPrimitives.tsx — re-export shim.
 *
 * The real module lives in the shared `@workspace/copilot-scan-scene` package
 * (Git #1357). The Copilot Readiness journey keeps importing `./JourneyPrimitives.tsx` by its
 * existing path; this forwards to the single source of truth so nothing changed
 * for the ~50 other journey files that use it.
 */
export * from "@workspace/copilot-scan-scene/JourneyPrimitives";
