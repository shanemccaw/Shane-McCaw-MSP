import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEmailBadge } from "@/contexts/EmailBadgeContext";

interface UseAssignEmailResult {
  assignEmail: (emailId: number, userId: number | null) => Promise<void>;
  assigningId: number | null;
}

export function useAssignEmail(): UseAssignEmailResult {
  const { fetchWithAuth } = useAuth();
  const { refreshUnreadCount } = useEmailBadge();
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const assignEmail = useCallback(
    async (emailId: number, userId: number | null) => {
      setAssigningId(emailId);
      try {
        const res = await fetchWithAuth(`/api/admin/emails/${emailId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        refreshUnreadCount();
      } finally {
        setAssigningId(null);
      }
    },
    [fetchWithAuth, refreshUnreadCount]
  );

  return { assignEmail, assigningId };
}
