import { expect, test } from "@playwright/test";
import { seedCompletedOnboarding } from "./onboarding-state.js";

test.beforeEach(async ({ page }) => {
  await seedCompletedOnboarding(page);
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/mission-control/sidebar")) {
      const now = new Date().toISOString();
      await route.fulfill({
        json: {
          items: [
            {
              id: "hello-world",
              display_name: "Hello World",
              provider_id: "chatkit.http-vercel-ai-sdk",
              status: "enabled",
              sessions: { items: [], next_page_token: null },
              created_at: now,
              updated_at: now,
            },
            {
              id: "researcher",
              display_name: "Researcher",
              provider_id: "chatkit.http-vercel-ai-sdk",
              status: "enabled",
              sessions: { items: [], next_page_token: null },
              created_at: now,
              updated_at: now,
            },
          ],
          next_page_token: null,
        },
      });
      return;
    }
    await route.fulfill({ status: 204 });
  });
});

test("manages tools and skills by bot", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Plugins" }).click();

  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await expect(page.getByRole("heading", { name: "Plugins" })).toHaveCount(0);
  await expect(page.locator('[data-settings-width="wide"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Plugins" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "General" }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("heading", { name: "General" })).toHaveCount(0);
  await expect(page.locator('[data-settings-width="constrained"]')).toBeVisible();
  await page.getByRole("button", { name: "Plugins" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await expect(page.getByPlaceholder("Search tools")).toBeVisible();
  await expect(page.getByText("GitHub (Work)", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub (Personal)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add new account" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Skills" }).click();
  await expect(page.getByPlaceholder("Search skills")).toBeVisible();
  await expect(page.getByText("Code review", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Show all" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Hello World/ }).click();
  await expect(page.getByLabel("Filtered by Hello World")).toBeVisible();
  await expect(page.getByText("GitHub (Work)", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub (Personal)", { exact: true })).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Show all" }).click();
  const workCard = page.getByRole("article").filter({ hasText: "GitHub (Work)" });
  await workCard.getByRole("button", { name: "Add to bot" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Researcher/ })
    .click();
  const removeResearcher = workCard.getByRole("button", { name: "Remove from Researcher" });
  await removeResearcher.hover();
  await expect(page.getByRole("tooltip", { name: "Researcher" })).toBeVisible();
  await removeResearcher.click();
  await expect(removeResearcher).toHaveCount(0);

  await page.getByPlaceholder("Search tools").fill("Sentry");
  await expect(page.getByText("Sentry", { exact: true })).toBeVisible();
  await expect(page.getByText("GitHub (Work)", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 820);
  await expect(page.getByText("Sentry", { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator(".plugin-library")).toHaveCSS("background-color", "rgb(7, 7, 7)");
  expect(consoleErrors).toEqual([]);
});
