import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "client";
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  sessionExpired: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchWithAuth: (path: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const KEY_REFRESH_TOKEN = "auth_refresh_token";
const KEY_USER = "auth_user";

async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value);
}

async function secureDel(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}

async function doLogin(
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; user: AuthUser }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Login failed" }))) as { error?: string };
    throw new Error(err.error ?? "Login failed");
  }
  const data = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
    user?: AuthUser;
    mfaRequired?: boolean;
  };
  if (data.mfaRequired || !data.accessToken || !data.refreshToken || !data.user) {
    throw new Error("Login requires additional verification. Please use the web portal.");
  }
  return data as { accessToken: string; refreshToken: string; user: AuthUser };
}

async function doRefresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; user: AuthUser }> {
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new Error("Refresh failed");
  }
  const data = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
    user?: AuthUser;
  };
  if (!data.accessToken || !data.refreshToken || !data.user) {
    throw new Error("Invalid refresh response");
  }
  return data as { accessToken: string; refreshToken: string; user: AuthUser };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    sessionExpired: false,
  });
  const tokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);
  tokenRef.current = state.accessToken;

  useEffect(() => {
    (async () => {
      try {
        const storedRefresh = await secureGet(KEY_REFRESH_TOKEN);
        if (storedRefresh) {
          const data = await doRefresh(storedRefresh);
          if (data.user.role !== "admin") throw new Error("Not an admin");
          tokenRef.current = data.accessToken;
          refreshTokenRef.current = data.refreshToken;
          await secureSet(KEY_REFRESH_TOKEN, data.refreshToken);
          await secureSet(KEY_USER, JSON.stringify(data.user));
          setState({ user: data.user, accessToken: data.accessToken, isLoading: false, sessionExpired: false });
        } else {
          setState({ user: null, accessToken: null, isLoading: false, sessionExpired: false });
        }
      } catch {
        await secureDel(KEY_REFRESH_TOKEN).catch(() => null);
        await secureDel(KEY_USER).catch(() => null);
        setState({ user: null, accessToken: null, isLoading: false, sessionExpired: false });
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await doLogin(email, password);
    if (data.user.role !== "admin") throw new Error("Admin credentials required");
    tokenRef.current = data.accessToken;
    refreshTokenRef.current = data.refreshToken;
    await secureSet(KEY_REFRESH_TOKEN, data.refreshToken);
    await secureSet(KEY_USER, JSON.stringify(data.user));
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false, sessionExpired: false });
  }, []);

  const logout = useCallback(async () => {
    tokenRef.current = null;
    refreshTokenRef.current = null;
    refreshingRef.current = false;
    await Promise.allSettled([
      secureDel(KEY_REFRESH_TOKEN),
      secureDel(KEY_USER),
    ]);
    setState({ user: null, accessToken: null, isLoading: false, sessionExpired: false });
  }, []);

  const fetchWithAuth = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (tokenRef.current) {
      headers.set("Authorization", `Bearer ${tokenRef.current}`);
    }
    if (typeof init?.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

    if (res.status === 401 && refreshTokenRef.current && !refreshingRef.current) {
      refreshingRef.current = true;
      try {
        const data = await doRefresh(refreshTokenRef.current);
        tokenRef.current = data.accessToken;
        refreshTokenRef.current = data.refreshToken;
        await secureSet(KEY_REFRESH_TOKEN, data.refreshToken);
        await secureSet(KEY_USER, JSON.stringify(data.user));
        setState((s) => ({ ...s, accessToken: data.accessToken, user: data.user, sessionExpired: false }));

        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${data.accessToken}`);
        if (typeof init?.body === "string" && !retryHeaders.has("Content-Type")) {
          retryHeaders.set("Content-Type", "application/json");
        }
        res = await fetch(`${BASE_URL}${path}`, { ...init, headers: retryHeaders });
      } catch {
        tokenRef.current = null;
        refreshTokenRef.current = null;
        await Promise.allSettled([secureDel(KEY_REFRESH_TOKEN), secureDel(KEY_USER)]);
        setState({ user: null, accessToken: null, isLoading: false, sessionExpired: true });
      } finally {
        refreshingRef.current = false;
      }
    }

    return res;
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, fetchWithAuth, baseUrl: BASE_URL }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
