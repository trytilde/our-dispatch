import type { Page } from "@playwright/test";

// Onboarding is persisted client-runtime state (ADR-0017), so a test that wants the
// workspace seeds it rather than clicking through first-run. The key and shape are the
// runtime's; keeping them in one helper means a contract change breaks one file.
const storageKey = "openbot.onboarding";
const workspaceStorageKey = "openbot.workspaces.v1";

const completed = {
  completed: true,
  result: { name: "E2E Bot", color: "#2a92fe", shape: "blob", tools: [] },
};

/** Marks onboarding complete before any page script runs. */
export async function seedCompletedOnboarding(page: Page): Promise<void> {
  await page.addInitScript(
    ([onboardingKey, onboardingValue, workspacesKey]) => {
      window.localStorage.setItem(onboardingKey as string, onboardingValue as string);
      const origin = window.location.origin;
      window.localStorage.setItem(
        workspacesKey as string,
        JSON.stringify({
          version: 1,
          active_workspace_id: "e2e-workspace",
          workspaces: [
            {
              id: "e2e-workspace",
              name: "E2E workspace",
              control_origin: origin,
              client_origin: origin,
              color: "#607d8b",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
    },
    [storageKey, JSON.stringify(completed), workspaceStorageKey] as const,
  );
}
