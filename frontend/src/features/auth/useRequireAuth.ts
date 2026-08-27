"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
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

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  return { status, user };
}
