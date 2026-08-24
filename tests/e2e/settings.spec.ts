import { expect, test } from "@playwright/test";
import { seedCompletedOnboarding } from "./onboarding-state.js";

test.beforeEach(async ({ page }) => {
  await seedCompletedOnboarding(page);
});

test("keeps macOS window controls clear of the settings back button", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      openbotDesktop: {
        platform: "mac",
        controlOrigin: window.location.origin,
        openExternal: async () => undefined,
        authStatus: async () => ({
          authenticated: true,
          user: { subject: "e2e-owner", name: "E2E Owner" },
        }),
        signIn: async () => undefined,
        signOut: async () => undefined,
      },
    });
  });

  await page.goto("/settings");

  const back = page.getByRole("button", { name: "Back to workspace" });
  await expect(back).toBeVisible();
  const bounds = await back.boundingBox();
  expect(bounds?.y).toBeGreaterThanOrEqual(42);
});
