"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useAuth } from "./AuthProvider";

export function LogoutButton() {
  const { logout } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await logout();
    } finally {
      router.push("/login");
    }
  }

  return (
    <Button variant="ghost" onClick={handleClick} disabled={loading}>
      {loading ? "Logging out…" : "Log out"}
    </Button>
  );
}
