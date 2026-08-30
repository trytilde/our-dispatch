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

test("uses a pull-up settings drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  await expect(page.locator("main > aside")).toBeHidden();
  await page.getByRole("button", { name: "Open settings navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings navigation" });
  await expect(drawer).toBeVisible();
  const bounds = await drawer.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(390);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeCloseTo(844, 0);
  await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeVisible();

  await drawer.getByRole("button", { name: "Tools" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/tools$/);
  await expect(drawer).toBeHidden();
});
