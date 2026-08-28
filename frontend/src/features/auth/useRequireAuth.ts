"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "./AuthProvider";

/**
 * Client-side fallback for proxy.ts's optimistic redirect: covers the case
 * where a refresh cookie is present but no longer valid (expired/revoked).
 * The backend remains the actual authority - this only decides what the
 * browser shows.
 */
export function useRequireAuth() {
  const { status, user } = useAuth();
  const router = useRouter();
  // Distinguishes "was logged in, then the session died" from "never
  // logged in to begin with" - only the former is worth explaining to the
  // user on the login page, so this is only set once `authenticated` is
  // actually observed.
  const wasAuthenticated = useRef(false);

  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticated.current = true;
    }
    if (status === "unauthenticated") {
      const reason = wasAuthenticated.current ? "&reason=session-expired" : "";
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}${reason}`);
    }
  }, [status, router]);

  return { status, user };
}
