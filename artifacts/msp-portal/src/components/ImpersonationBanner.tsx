import React from "react";
import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

/**
 * Git #797 — persistent "viewing as" indicator, visible whenever
 * isImpersonating is true regardless of how the session got there (the
 * URL-token new-tab flow OR TenantSwitcherFloaty's in-place switch). Exit
 * restores the real admin session in place via #796's returnToAdmin() — no
 * tab-close, no hard navigate, so it works the same for both entry paths.
 *
 * Known gap: returnToAdmin() only restores a session it stashed itself (the
 * FIRST switchToTenant() call in a given tab). A tab opened purely via the
 * URL-token boot flow (e.g. admin-panel's ViewAsSwitcher window.open, which
 * never calls switchToTenant()) has nothing stashed, so Exit no-ops there —
 * unchanged from that entry point's pre-existing behavior of never having a
 * working in-place return either. Not fixed here; out of this phase's scope.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  const { accessToken, returnToAdmin } = useAuth();

  const handleExit = () => {
    reportClientEvent(
      accessToken,
      "ImpersonationBannerExit",
      "Exited impersonation via banner",
      "auth.impersonation",
    );
    void returnToAdmin();
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-white flex items-center justify-between px-4 py-2 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        Admin Preview Mode — Viewing as <span className="underline underline-offset-2">{email}</span>
        <span className="text-amber-200 font-normal">(read-only · session expires in 30 min)</span>
      </div>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Exit Preview
      </button>
    </div>
  );
}
