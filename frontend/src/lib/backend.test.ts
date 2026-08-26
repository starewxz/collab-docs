import { afterEach, describe, expect, it, vi } from "vitest";
import { getBackendStatus } from "./backend";

describe("getBackendStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports reachable when the backend responds ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      }),
    );

    await expect(getBackendStatus()).resolves.toEqual({
      reachable: true,
      status: "ok",
    });
  });

  it("reports unreachable on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(getBackendStatus()).resolves.toEqual({ reachable: false });
  });

  it("reports unreachable when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    await expect(getBackendStatus()).resolves.toEqual({ reachable: false });
  });
});
