import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  it("coalesces concurrent callers into exactly one underlying call", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return "token";
    });
    const wrapped = singleFlight(fn);

    const [a, b, c] = await Promise.all([wrapped(), wrapped(), wrapped()]);

    expect(calls).toBe(1);
    expect(a).toBe("token");
    expect(b).toBe("token");
    expect(c).toBe("token");
  });

  it("starts a fresh call once the in-flight one has settled", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return calls;
    });
    const wrapped = singleFlight(fn);

    const first = await wrapped();
    const second = await wrapped();

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("propagates a rejection to every concurrent waiter, then allows a retry", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce("token-after-retry");
    const wrapped = singleFlight(fn);

    const results = await Promise.allSettled([wrapped(), wrapped(), wrapped()]);
    expect(fn).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe("rejected");
    }

    // A subsequent call after the shared failure starts a new attempt
    // rather than being stuck replaying the same rejection forever.
    await expect(wrapped()).resolves.toBe("token-after-retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
