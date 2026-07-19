/**
 * Theme preference — account-level (not browser-local), persisted via
 * GET/PUT /api/portal/theme-preference. Not wired into the live app yet
 * (main.tsx still hardcodes the "dark" class); this provider is currently
 * only consumed by the /dev/style-guide preview page for visual QA of the
 * Portal Foundation Redesign token/component system. Wiring this into the
 * real profile menu is a separate follow-up task.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAuth } from "./auth-context";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function osPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { fetchWithAuth, user } = useAuth();
  const [theme, setThemeState] = useState<Theme>(() => (osPrefersDark() ? "dark" : "light"));

  // Load the account's stored preference as soon as we have a session, and
  // apply it immediately to avoid a flash of the wrong theme. No preference
  // stored -> keep the OS-derived default and write nothing.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void fetchWithAuth("/api/portal/theme-preference")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { theme: Theme | null } | null) => {
        if (cancelled || !data?.theme) return;
        setThemeState(data.theme);
        applyThemeClass(data.theme);
      })
      .catch(() => {
        // No stored preference reachable — keep the OS-derived default.
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth]);

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      // Apply immediately — never make the user wait on the network round-trip.
      setThemeState(next);

      void fetchWithAuth("/api/portal/theme-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      }).then((res) => {
        if (!res.ok) {
          // Keep the visual change — losing the toggle's effect after the
          // user just clicked it would be worse than a failed background save.
          toast.error("Couldn't save your theme preference — it'll reset next time you sign in.");
        }
      });
    },
    [fetchWithAuth],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
