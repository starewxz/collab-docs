"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-6)",
        textAlign: "center",
        background: "var(--color-bg)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-xl)",
          fontWeight: 560,
          color: "var(--color-text)",
        }}
      >
        Something went wrong
      </p>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-sm)", maxWidth: "36ch" }}>
        We hit an unexpected error loading this page. Try again, or head back to your workspace.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
