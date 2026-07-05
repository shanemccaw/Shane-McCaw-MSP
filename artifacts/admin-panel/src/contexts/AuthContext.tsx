import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "client";
}

export interface MfaChallenge {
  mfaToken: string;
  methods: string[];
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<AuthUser | MfaChallenge>;
  completeMfaLogin: (accessToken: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function isMfaChallenge(result: AuthUser | MfaChallenge): result is MfaChallenge {
  return "mfaToken" in result;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = state.accessToken;

  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setState({ user: null, accessToken: null, isLoading: false });
        return null;
      }
      const data = await res.json() as { accessToken: string; user: AuthUser };
      if (data.user.role !== "admin") {
        setState({ user: null, accessToken: null, isLoading: false });
        return null;
      }
      setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
      accessTokenRef.current = data.accessToken;
      return data.accessToken;
    } catch {
      setState({ user: null, accessToken: null, isLoading: false });
      return null;
    }
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const p = doRefresh().finally(() => { refreshInFlight.current = null; });
    refreshInFlight.current = p;
    return p;
  }, [doRefresh]);

  useEffect(() => {
    setAuthTokenGetter(() => accessTokenRef.current);
    return () => { setAuthTokenGetter(null); };
  }, []);

  useEffect(() => {
    refresh().then((token) => {
      if (!token) setState(s => ({ ...s, isLoading: false }));
    }).catch(() => {
      setState(s => ({ ...s, isLoading: false }));
    });
  }, [refresh]);

  // Proactively refresh the access token 5 minutes before it expires so the
  // user never hits a 401 mid-session.
  useEffect(() => {
    if (!state.accessToken) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = JSON.parse(atob(state.accessToken.split(".")[1])) as { exp?: number };
      if (typeof payload.exp === "number") {
        const msUntilRefresh = payload.exp * 1000 - Date.now() - 5 * 60 * 1000;
        if (msUntilRefresh <= 0) {
          void refresh();
        } else {
          timer = setTimeout(() => { void refresh(); }, msUntilRefresh);
        }
      }
    } catch { /* ignore malformed token */ }
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [state.accessToken, refresh]);

  const login = async (email: string, password: string): Promise<AuthUser | MfaChallenge> => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json() as { accessToken?: string; user?: AuthUser; mfaRequired?: boolean; mfaToken?: string; methods?: string[] };

    if (data.mfaRequired && data.mfaToken && data.methods) {
      return { mfaToken: data.mfaToken, methods: data.methods } as MfaChallenge;
    }

    if (!data.user || !data.accessToken) {
      throw new Error("Unexpected login response");
    }
    if (data.user.role !== "admin") {
      throw new Error("Access denied: admin credentials required");
    }
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
    accessTokenRef.current = data.accessToken;
    return data.user;
  };

  const completeMfaLogin = (accessToken: string, user: AuthUser) => {
    setState({ user, accessToken, isLoading: false });
    accessTokenRef.current = accessToken;
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Ignore network errors — always clear local session
    }
    setState({ user: null, accessToken: null, isLoading: false });
    accessTokenRef.current = null;
    // Hard redirect: kills all in-flight requests / SSE connections and
    // ensures no background refresh can race back in before the router updates.
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.replace(`${base}/login`);
  };

  const fetchWithAuth = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (accessTokenRef.current) {
      headers.set("Authorization", `Bearer ${accessTokenRef.current}`);
    }
    if (typeof init?.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(input, { ...init, credentials: "include", headers });

    if (res.status !== 401) return res;

    const newToken = await refresh();
    if (!newToken) {
      setState({ user: null, accessToken: null, isLoading: false });
      return res;
    }

    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("Authorization", `Bearer ${newToken}`);
    if (typeof init?.body === "string" && !retryHeaders.has("Content-Type")) {
      retryHeaders.set("Content-Type", "application/json");
    }
    return fetch(input, { ...init, credentials: "include", headers: retryHeaders });
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, login, completeMfaLogin, logout, fetchWithAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
