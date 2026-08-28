import { describe, expect, it, vi } from "vitest";
import { downgradeToFree, getSubscription, mockPay } from "./api";

describe("billing api", () => {
  it("getSubscription GETs the workspace billing endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ plan: "free" });
    await getSubscription(apiFetch, "ws-1");

    expect(apiFetch).toHaveBeenCalledWith("/api/workspaces/ws-1/billing");
  });

  it("mockPay POSTs to the mock-pay endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ plan: "pro" });
    await mockPay(apiFetch, "ws-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/billing/mock-pay",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("downgradeToFree POSTs to the downgrade endpoint", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ plan: "free" });
    await downgradeToFree(apiFetch, "ws-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/billing/downgrade",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
