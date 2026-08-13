import React from "react";
import { ShieldAlert } from "lucide-react";
import { reportClientEvent } from "@/lib/report-client-event";
import { getCurrentAccessToken } from "@/lib/auth-context";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level render-crash catcher wrapping the router/page tree. A class
 * component (React error boundaries require the class API — there is no
 * hook equivalent), so it reads the access token via getCurrentAccessToken()
 * rather than useAuth(). /api/client-events requires auth, so a crash with
 * no session yet (e.g. during the boot refresh) won't be reported — same as
 * any other unauthenticated caller of that endpoint.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    reportClientEvent(
      getCurrentAccessToken(),
      error.name || "UncaughtRenderError",
      error.message || "Unknown render error",
      "client.frontend",
      { source: "ErrorBoundary" },
      error.stack,
    );
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-full bg-sidebar flex items-center justify-center p-4">
          <div className="w-full max-w-sm text-center text-sidebar-foreground space-y-4">
            <ShieldAlert className="mx-auto size-10 text-sidebar-primary" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-sm text-sidebar-foreground/60 mt-1">
                We've logged the problem. Try reloading, or head back to login.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground underline"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground underline"
                onClick={() => {
                  window.location.href = "/login";
                }}
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
