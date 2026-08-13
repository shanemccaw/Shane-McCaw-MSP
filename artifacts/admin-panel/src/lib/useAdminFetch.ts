/**
 * useAdminFetch — thin wrapper around AuthContext.fetchWithAuth for admin panel pages.
 * Returns { adminFetch } which forwards to the platform-admin authenticated fetch.
 */

import { useAuth } from "@/contexts/AuthContext";

export function useAdminFetch() {
  const { fetchWithAuth } = useAuth();
  return { adminFetch: fetchWithAuth };
}
