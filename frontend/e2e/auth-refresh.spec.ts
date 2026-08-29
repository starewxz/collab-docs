import { test, expect, type Page } from "@playwright/test";

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://localhost:4000";

async function registerAndLogin(page: Page, email: string) {
  await page.goto("/register", { waitUntil: "networkidle" });
  await page.fill("#firstName", "E2E");
  await page.fill("#lastName", "Auth");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/, { timeout: 15_000 });
}

function trackRefreshStatuses(page: Page): number[] {
  const statuses: number[] = [];
  page.on("requestfinished", (req) => {
    if (!req.url().includes("/auth/refresh")) return;
    void req.response().then((res) => {
      if (res) statuses.push(res.status());
    });
  });
  return statuses;
}

test("bootstrap refresh survives a browser reload with exactly one call", async ({
  page,
}) => {
  await registerAndLogin(page, `pw-${Date.now()}@example.com`);

  const statuses = trackRefreshStatuses(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  expect(statuses).toEqual([200]);
  await expect(page).toHaveURL(/\/workspace/);
});

test("reloading twice in a row still authenticates each time", async ({
  page,
}) => {
  await registerAndLogin(page, `pw-${Date.now()}@example.com`);

  for (let i = 0; i < 2; i++) {
    const statuses = trackRefreshStatuses(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    expect(statuses).toEqual([200]);
    await expect(page).toHaveURL(/\/workspace/);
  }
});

test("logout then login again then reload still authenticates", async ({
  page,
}) => {
  const email = `pw-${Date.now()}@example.com`;
  await registerAndLogin(page, email);

  await page.evaluate(
    async (backendUrl) => {
      await fetch(`${backendUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    },
    BACKEND_URL,
  );
  await page.goto("/login", { waitUntil: "networkidle" });

  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/workspace/, { timeout: 15_000 });

  const statuses = trackRefreshStatuses(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  expect(statuses).toEqual([200]);
  await expect(page).toHaveURL(/\/workspace/);
});
