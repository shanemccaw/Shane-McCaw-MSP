/**
 * Hands `aiPromptsStore` a live `adminFetch` and warms the prompt list once.
 *
 * Always mounted (see `AdminV2.tsx`), the same reason `EnginesFetchBridge` is:
 * the Home tab's "Open a prompt" gallery lists the real prompts with their
 * real category/state, and that list is built from store state at ribbon
 * render time — so it has to be loaded whether or not `/ai-prompts` has ever
 * been the active screen. Renders nothing.
 */

import { useEffect } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { configureAiPromptsFetch, warmAiPrompts } from "./aiPromptsStore";

export function AiPromptsFetchBridge() {
  const { adminFetch } = useAdminFetch();

  useEffect(() => {
    configureAiPromptsFetch(adminFetch);
    warmAiPrompts();
  }, [adminFetch]);

  return null;
}
