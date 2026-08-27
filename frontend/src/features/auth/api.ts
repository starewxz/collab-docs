import { backendFetch } from "@/lib/backend-fetch";
import type { AuthResponse, AuthUser } from "./types";

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function registerRequest(input: RegisterInput): Promise<AuthResponse> {
  return backendFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginRequest(input: LoginInput): Promise<AuthResponse> {
  return backendFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function refreshRequest(): Promise<AuthResponse> {
  return backendFetch<AuthResponse>("/api/auth/refresh", { method: "POST" });
}

export function logoutRequest(): Promise<{ success: true }> {
  return backendFetch<{ success: true }>("/api/auth/logout", {
    method: "POST",
  });
}

export function meRequest(accessToken: string): Promise<AuthUser> {
  return backendFetch<AuthUser>("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
