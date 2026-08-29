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
import { singleFlight } from "@/lib/single-flight";
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
  /** Raw in-memory access token, for callers that can't go through
   * `apiFetch` (e.g. a WebSocket handshake's `auth` payload). Same token,
   * same in-memory-only lifetime - never persisted anywhere new. */
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  // In-memory only, by design - never persisted to localStorage. Lost on
  // full page reload, at which point the effect below silently restores
  // it from the httpOnly refresh cookie.
  const accessTokenRef = useRef<string | null>(null);

  // Coalesces every concurrent refresh attempt (bootstrap + any number of
  // apiFetch 401 retries) into a single in-flight `/auth/refresh` call -
  // see single-flight.ts for why firing one per caller is unsafe. Built
  // once via useState's lazy initializer (not a ref read during render).
  const [refreshOnce] = useState(() => singleFlight(refreshRequest));

  useEffect(() => {
    let cancelled = false;
    refreshOnce()
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
  }, [refreshOnce]);

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
          // Goes through the shared single-flight wrapper, not a raw
          // refreshRequest() call: several apiFetch callers can each see a
          // 401 around the same time (e.g. a page firing multiple queries
          // at once), and each independently calling refresh would race
          // the backend's rotation - see refreshOnce above and
          // single-flight.ts.
          const refreshed = await refreshOnce();
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
    [refreshOnce],
  );

  const getAccessToken = useCallback(() => accessTokenRef.current, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout, apiFetch, getAccessToken }),
    [status, user, login, register, logout, apiFetch, getAccessToken],
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
