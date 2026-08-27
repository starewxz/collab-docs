"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { publicEnv } from "@/config/env";
import { ApiError, type ApiErrorBody } from "@/lib/api-error";
import {
  loginRequest,
  logoutRequest,
  refreshRequest,
  registerRequest,
  type LoginInput,
  type RegisterInput,
} from "./api";
import type { AuthUser } from "./types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Authenticated fetch: attaches the access token and retries once via
   * silent refresh on a 401 before giving up. */
  apiFetch: <T>(path: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  // In-memory only, by design - never persisted to localStorage. Lost on
  // full page reload, at which point the effect below silently restores
  // it from the httpOnly refresh cookie.
  const accessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshRequest()
      .then((res) => {
        if (cancelled) return;
        accessTokenRef.current = res.accessToken;
        setUser(res.user);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!cancelled) setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await loginRequest(input);
    accessTokenRef.current = res.accessToken;
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await registerRequest(input);
    accessTokenRef.current = res.accessToken;
    setUser(res.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      accessTokenRef.current = null;
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const apiFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const doFetch = () =>
        fetch(`${publicEnv.apiUrl}${path}`, {
          ...options,
          credentials: "include",
          headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(accessTokenRef.current
              ? { Authorization: `Bearer ${accessTokenRef.current}` }
              : {}),
            ...options.headers,
          },
        });

      let response = await doFetch();

      if (response.status === 401) {
        try {
          const refreshed = await refreshRequest();
          accessTokenRef.current = refreshed.accessToken;
          setUser(refreshed.user);
          response = await doFetch();
        } catch {
          accessTokenRef.current = null;
          setUser(null);
          setStatus("unauthenticated");
        }
      }

      const text = await response.text();
      const data: unknown = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        throw new ApiError(response.status, data as ApiErrorBody | undefined);
      }

      return data as T;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, apiFetch }),
    [status, user, login, register, logout, apiFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
