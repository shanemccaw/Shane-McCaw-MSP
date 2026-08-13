/**
 * SessionExpiryModal
 *
 * Shows an "Are you still there?" dialog 30 seconds before the access token
 * expires. User can extend the session (triggers a refresh) or sign out.
 * Uses Radix AlertDialog so it traps focus and is keyboard-accessible.
 */

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth-context";

export function SessionExpiryModal() {
  const { isExpiringSoon, extendSession, logout } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(30);

  useEffect(() => {
    if (!isExpiringSoon) {
      setSecondsLeft(30);
      return;
    }

    setSecondsLeft(30);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          void logout();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isExpiringSoon, logout]);

  return (
    <AlertDialog open={isExpiringSoon}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            Your session will expire in{" "}
            <span className="font-semibold text-foreground">{secondsLeft}s</span>
            . Stay signed in?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void logout()}>
            Sign out
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => void extendSession()}>
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
