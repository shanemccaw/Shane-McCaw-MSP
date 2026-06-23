import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  address?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  role: "admin" | "client";
  impersonatedBy?: number;
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
  register: (email: string, password: string, name?: string) => Promise<AuthUser>;
  setupPassword: (token: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  getAuthHeader: () => Record<string, string>;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  completeMfaLogin: (accessToken: string, user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    const params = new URLSearchParams(window.location.search);
    const impersonationToken = params.get("impersonation_token");

    if (impersonationToken) {
      fetch("/api/auth/impersonate-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: impersonationToken }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json() as { accessToken: string; user: AuthUser };
            setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
            accessTokenRef.current = data.accessToken;
            const url = new URL(window.location.href);
            url.searchParams.delete("impersonation_token");
            window.history.replaceState({}, "", url.toString());
          } else {
            setState(s => ({ ...s, isLoading: false }));
          }
        })
        .catch(() => {
          setState(s => ({ ...s, isLoading: false }));
        });
      return;
    }

    refresh().then((token) => {
      if (!token) {
        setState(s => ({ ...s, isLoading: false }));
      }
    }).catch(() => {
      setState(s => ({ ...s, isLoading: false }));
    });
  }, [refresh]);

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

    if (data.accessToken && data.user) {
      setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
      accessTokenRef.current = data.accessToken;
      return data.user;
    }

    throw new Error("Unexpected login response");
  };

  const completeMfaLogin = (accessToken: string, user: AuthUser) => {
    setState({ user, accessToken, isLoading: false });
    accessTokenRef.current = accessToken;
  };

  // register is kept for API compatibility but the server returns 403
  const register = async (email: string, password: string, name?: string): Promise<AuthUser> => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error ?? "Registration failed");
    }
    const data = await res.json() as { accessToken: string; user: AuthUser };
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
    accessTokenRef.current = data.accessToken;
    return data.user;
  };

  const setupPassword = async (token: string, password: string): Promise<AuthUser> => {
    const res = await fetch("/api/auth/setup-password", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error ?? "Password setup failed");
    }
    const data = await res.json() as { accessToken: string; user: AuthUser };
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
    accessTokenRef.current = data.accessToken;
    return data.user;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState({ user: null, accessToken: null, isLoading: false });
    accessTokenRef.current = null;
  };

  const getAuthHeader = (): Record<string, string> => {
    if (!accessTokenRef.current) return {};
    return { Authorization: `Bearer ${accessTokenRef.current}` };
  };

  const fetchWithAuth = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (accessTokenRef.current) {
      headers.set("Authorization", `Bearer ${accessTokenRef.current}`);
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
    return fetch(input, { ...init, credentials: "include", headers: retryHeaders });
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, setupPassword, logout, getAuthHeader, fetchWithAuth, completeMfaLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isMfaChallenge(result: AuthUser | MfaChallenge): result is MfaChallenge {
  return "mfaToken" in result;
}
