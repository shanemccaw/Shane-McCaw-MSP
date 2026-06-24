import AsyncStorage from "@react-native-async-storage/async-storage";
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
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchWithAuth: (path: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const KEY_EMAIL = "auth_email";
const KEY_PASSWORD = "auth_password";
const KEY_TOKEN = "auth_token";

async function storeGet(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

async function storeSet(key: string, value: string): Promise<void> {
  return AsyncStorage.setItem(key, value);
}

async function storeDel(key: string): Promise<void> {
  return AsyncStorage.removeItem(key);
}

async function doLogin(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Login failed" }))) as { error?: string };
    throw new Error(err.error ?? "Login failed");
  }
  const data = await res.json() as { accessToken?: string; user?: AuthUser; mfaRequired?: boolean };
  if (data.mfaRequired || !data.accessToken || !data.user) {
    throw new Error("Login requires additional verification. Please use the web portal.");
  }
  return data as { accessToken: string; user: AuthUser };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null, isLoading: true });
  const tokenRef = useRef<string | null>(null);
  const credRef = useRef<{ email: string; password: string } | null>(null);
  tokenRef.current = state.accessToken;

  useEffect(() => {
    (async () => {
      try {
        const email = await storeGet(KEY_EMAIL);
        const password = await storeGet(KEY_PASSWORD);
        if (email && password) {
          credRef.current = { email, password };
          const data = await doLogin(email, password);
          if (data.user.role !== "admin") throw new Error("Not an admin");
          tokenRef.current = data.accessToken;
          await storeSet(KEY_TOKEN, data.accessToken);
          setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
        } else {
          setState({ user: null, accessToken: null, isLoading: false });
        }
      } catch {
        setState({ user: null, accessToken: null, isLoading: false });
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await doLogin(email, password);
    if (data.user.role !== "admin") throw new Error("Admin credentials required");
    credRef.current = { email, password };
    tokenRef.current = data.accessToken;
    await storeSet(KEY_EMAIL, email);
    await storeSet(KEY_PASSWORD, password);
    await storeSet(KEY_TOKEN, data.accessToken);
    setState({ user: data.user, accessToken: data.accessToken, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    credRef.current = null;
    tokenRef.current = null;
    await Promise.allSettled([
      storeDel(KEY_EMAIL),
      storeDel(KEY_PASSWORD),
      storeDel(KEY_TOKEN),
    ]);
    setState({ user: null, accessToken: null, isLoading: false });
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

    if (res.status === 401 && credRef.current) {
      try {
        const data = await doLogin(credRef.current.email, credRef.current.password);
        tokenRef.current = data.accessToken;
        await storeSet(KEY_TOKEN, data.accessToken);
        setState((s) => ({ ...s, accessToken: data.accessToken, user: data.user }));
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${data.accessToken}`);
        if (typeof init?.body === "string" && !retryHeaders.has("Content-Type")) {
          retryHeaders.set("Content-Type", "application/json");
        }
        res = await fetch(`${BASE_URL}${path}`, { ...init, headers: retryHeaders });
      } catch {
        setState({ user: null, accessToken: null, isLoading: false });
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
