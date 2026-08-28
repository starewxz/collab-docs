import { describe, expect, it } from "vitest";
import { ApiError, formatPlanLimitMessage, isPlanLimitError } from "./api-error";

describe("isPlanLimitError", () => {
  it("recognizes a PLAN_LIMIT_EXCEEDED error body", () => {
    const err = new ApiError(403, {
      statusCode: 403,
      message: "This workspace has reached its FREE plan limit of 50 documents",
      error: "ForbiddenException",
      code: "PLAN_LIMIT_EXCEEDED",
      limitType: "documents",
      limit: 50,
      current: 50,
      plan: "free",
    });

    expect(isPlanLimitError(err)).toBe(true);
  });

  it("returns false for an ordinary 403 without the plan-limit code", () => {
    const err = new ApiError(403, {
      statusCode: 403,
      message: "Forbidden",
      error: "ForbiddenException",
    });

    expect(isPlanLimitError(err)).toBe(false);
  });

  it("returns false for a non-ApiError value", () => {
    expect(isPlanLimitError(new Error("boom"))).toBe(false);
  });
});

describe("formatPlanLimitMessage", () => {
  it("includes usage and the provided next step when limit/current are present", () => {
    const err = new ApiError(403, {
      statusCode: 403,
      message: "This workspace has reached its FREE plan limit of 50 documents",
      error: "ForbiddenException",
      code: "PLAN_LIMIT_EXCEEDED",
      limitType: "documents",
      limit: 50,
      current: 50,
      plan: "free",
    });

    if (!isPlanLimitError(err)) throw new Error("expected a plan-limit error");
    expect(
      formatPlanLimitMessage(err, "Upgrade to PRO from the workspace settings page."),
    ).toBe(
      "This workspace has reached its FREE plan limit of 50 documents (50/50 used on the FREE plan). Upgrade to PRO from the workspace settings page.",
    );
  });

  it("falls back to just the message + next step when usage fields are absent", () => {
    const err = new ApiError(403, {
      statusCode: 403,
      message: "This workspace has reached its plan limit.",
      error: "ForbiddenException",
      code: "PLAN_LIMIT_EXCEEDED",
    });

    if (!isPlanLimitError(err)) throw new Error("expected a plan-limit error");
    expect(formatPlanLimitMessage(err, "Ask the owner to upgrade.")).toBe(
      "This workspace has reached its plan limit. Ask the owner to upgrade.",
    );
  });
});
