import { createContext, useContext } from "react";

interface EmailBadgeContextValue {
  refreshUnreadCount: () => void;
}

export const EmailBadgeContext = createContext<EmailBadgeContextValue>({
  refreshUnreadCount: () => {},
});

export function useEmailBadge() {
  return useContext(EmailBadgeContext);
}
