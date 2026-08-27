import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { LoginForm } from "@/features/auth/LoginForm";

export const metadata: Metadata = {
  title: "Log in - Collab Docs",
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner label="Loading" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
