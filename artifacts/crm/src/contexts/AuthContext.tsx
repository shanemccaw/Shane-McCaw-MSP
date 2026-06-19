import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "client";
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAuthHeader: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json() as { accessToken: string; user: AuthUser };
      setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
      return data.accessToken;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().then((token) => {
      if (!token) {
        setState(s => ({ ...s, isLoading: false }));
      }
    }).catch(() => {
      setState(s => ({ ...s, isLoading: false }));
    });
  }, [refresh]);

  const login = async (email: string, password: string) => {
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
    const data = await res.json() as { accessToken: string; user: AuthUser };
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState({ user: null, accessToken: null, isLoading: false });
  };

  const getAuthHeader = (): Record<string, string> => {
    if (!state.accessToken) return {};
    return { Authorization: `Bearer ${state.accessToken}` };
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, getAuthHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
