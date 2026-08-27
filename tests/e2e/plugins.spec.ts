import { expect, test } from "@playwright/test";
import { seedCompletedOnboarding } from "./onboarding-state.js";

function chatKitActivity(activity: { items: unknown[]; next_page_token?: string | null }) {
  return { activity, active_session_id: null, active_conversation: null };
}

test.beforeEach(async ({ page }) => {
  await seedCompletedOnboarding(page);
  await page.route("https://thesvg.org/icons/**", async (route) => {
    await route.fulfill({
      body: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='#4285f4'/></svg>",
      contentType: "image/svg+xml",
    });
  });
  await page.route("https://www.apollo.io/icon.svg", async (route) => {
    await route.fulfill({
      body: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='16' fill='#f8ff2c'/></svg>",
      contentType: "image/svg+xml",
    });
  });
  await page.route(
    "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/modal/default.svg",
    async (route) => {
      await route.fulfill({
        body: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='16'/></svg>",
        contentType: "image/svg+xml",
      });
    },
  );
  await page.route(
    "https://raw.githubusercontent.com/e2b-dev/E2B/main/readme-assets/logo-circle.png",
    async (route) => {
      await route.fulfill({
        body: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32'/></svg>",
        contentType: "image/svg+xml",
      });
    },
  );
  const toolAssignments: Record<string, string[]> = {
    "github-work": ["hello-world"],
    "github-personal": ["researcher"],
  };
  const skillAssignments: Record<string, string[]> = {
    "code-review": ["hello-world"],
    "research-brief-primary": ["hello-world"],
    "research-brief-secondary": ["researcher"],
  };
  const deletedToolAccountIds = new Set<string>();
  await page.route("**/api/connectors/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/api/connectors/accounts") && request.method() === "DELETE") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const body = request.postDataJSON() as { account_ids: string[] };
      for (const accountId of body.account_ids) deletedToolAccountIds.add(accountId);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (path.endsWith("/api/connectors/accounts") && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        json: {
          status: "authorize",
          account: {
            id: "google-mail-work",
            display_name: "Work Gmail",
            status: "pending",
            provider_type_id: "google_mail",
            credential_source_type_id: "google_mail_managed_oauth",
          },
          authorization_url: "about:blank",
        },
      });
      return;
    }
    if (
      path.endsWith("/api/connectors/accounts/google-mail-work/wait") &&
      request.method() === "GET"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        json: {
          id: "google-mail-work",
          display_name: "Work Gmail",
          status: "active",
          provider_type_id: "google_mail",
          credential_source_type_id: "google_mail_managed_oauth",
        },
      });
      return;
    }
    if (path.endsWith("/api/connectors/accounts") && request.method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        json: {
          items: [
            {
              id: "google-mail-work",
              display_name: "Work Gmail",
              status: "active",
              provider_type_id: "google_mail",
              credential_source_type_id: "google_mail_managed_oauth",
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled ${request.method()} ${path}` } });
  });
  await page.route("**/api/signals/**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(/\/api\/plugins(?:\/|\?|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const toolMutation = /\/api\/plugins\/tools\/([^/]+)\/agents\/([^/]+)$/.exec(path);
    const skillMutation = /\/api\/plugins\/skills\/([^/]+)\/agents\/([^/]+)$/.exec(path);
    if (toolMutation) {
      const [, accountId, agentId] = toolMutation;
      await new Promise((resolve) => setTimeout(resolve, 400));
      toolAssignments[accountId] =
        request.method() === "POST"
          ? [...new Set([...(toolAssignments[accountId] ?? []), agentId])]
          : (toolAssignments[accountId] ?? []).filter((candidate) => candidate !== agentId);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (skillMutation) {
      const [, skillId, agentId] = skillMutation;
      await new Promise((resolve) => setTimeout(resolve, 400));
      skillAssignments[skillId] =
        request.method() === "POST"
          ? [...new Set([...(skillAssignments[skillId] ?? []), agentId])]
          : (skillAssignments[skillId] ?? []).filter((candidate) => candidate !== agentId);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: {
        tools: [
          {
            provider: {
              type_id: "github",
              name: "GitHub",
              documentation: "Issues, pull requests, repositories, and code search.",
              icon_url:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 32'%3E%3Crect width='64' height='32' rx='8' fill='%23181717'/%3E%3C/svg%3E",
              categories: ["Development"],
              credential_sources: [],
            },
            accounts: [
              {
                id: "github-work",
                display_name: "Work",
                status: "active",
                provider_type_id: "github",
                assigned_agent_ids: toolAssignments["github-work"],
              },
              {
                id: "github-personal",
                display_name: "Personal",
                status: "active",
                provider_type_id: "github",
                assigned_agent_ids: toolAssignments["github-personal"],
              },
            ].filter((account) => !deletedToolAccountIds.has(account.id)),
          },
          {
            provider: {
              type_id: "google_mail",
              name: "Google Mail",
              documentation: "Search and manage mail.",
              icon_url:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23fff'/%3E%3Cpath d='M5 9l11 8 11-8v14H5z' fill='%234285f4'/%3E%3C/svg%3E",
              categories: ["Productivity"],
              credential_sources: [
                {
                  type_id: "google_mail_managed_oauth",
                  name: "Sign in with your browser",
                  documentation: "Platform-managed OAuth 2.0 — sign in with your provider account.",
                  requires_brokering: true,
                  supports_auto_display_name: true,
                  resource_server_schema: null,
                  user_credential_schema: null,
                },
              ],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "managed_mcp:apollo",
              name: "Apollo.io",
              documentation: "Search and enrich sales intelligence.",
              icon_slug: "apollo",
              categories: ["sales", "productivity"],
              credential_sources: [
                {
                  type_id: "managed_mcp_oauth",
                  name: "Sign in with your browser",
                  documentation: "Sign in with your provider account.",
                  requires_brokering: true,
                  supports_auto_display_name: false,
                  resource_server_schema: {
                    type: "object",
                    properties: {
                      api_base_url: {
                        type: "string",
                        title: "Api base url",
                        description: "Base URL for your workspace.",
                      },
                    },
                    required: ["api_base_url"],
                  },
                  user_credential_schema: null,
                },
              ],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "sentry",
              name: "Sentry",
              documentation: "Inspect production errors, traces, and releases.",
              icon_slug: "sentry",
              categories: ["Observability"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "modal-sandbox",
              name: "Modal",
              documentation: "Run workloads in Modal sandboxes.",
              icon_slug: "modal sandbox",
              categories: ["Development"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "e2b",
              name: "E2B",
              documentation: "Run workloads in E2B sandboxes.",
              icon_slug: "e2b",
              categories: ["Development"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "proxied-mcp:https://mcp.vercel.com",
              name: "Vercel",
              documentation: "https://mcp.vercel.com",
              icon_slug: "vercel",
              categories: ["other"],
              credential_sources: [],
              can_add_account: false,
            },
            accounts: [
              {
                id: "vercel-hello-world",
                display_name: "OpenBot hello-world Vercel",
                status: "active",
                provider_type_id: "proxied-mcp:https://mcp.vercel.com",
                assigned_agent_ids: ["hello-world"],
              },
              {
                id: "vercel-researcher",
                display_name: "OpenBot researcher Vercel",
                status: "active",
                provider_type_id: "proxied-mcp:https://mcp.vercel.com",
                assigned_agent_ids: ["researcher"],
              },
            ],
          },
          {
            provider: {
              type_id: "tilde_control_plane",
              name: "Tilde Control Plane",
              categories: ["system"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "tilde_skill_registry",
              name: "Tilde Skill Registry",
              categories: ["system"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "tilde_wallet",
              name: "Tilde Pay",
              categories: ["system"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "tilde_browser",
              name: "Tilde Browser",
              categories: ["system"],
              credential_sources: [],
            },
            accounts: [],
          },
          {
            provider: {
              type_id: "chatkit_internal_agent",
              name: "Message internal agent",
              categories: ["system"],
              credential_sources: [],
            },
            accounts: [],
          },
        ],
        skills: [
          {
            id: "development",
            name: "Development",
            description: "Software delivery skills.",
            categories: ["developer_tools"],
            icon_key: "github",
            skills: [
              {
                id: "code-review",
                name: "Code review",
                description: "Review changes for correctness, clarity, and risk.",
                assigned_agent_ids: skillAssignments["code-review"],
              },
            ],
          },
          {
            id: "research",
            name: "Research",
            description: "Research and synthesis skills.",
            categories: ["productivity"],
            skills: [
              {
                id: "research-brief-primary",
                name: "Research brief",
                description: "Gather and synthesize source material.",
                assigned_agent_ids: skillAssignments["research-brief-primary"],
              },
              {
                id: "research-brief-secondary",
                name: "Research brief",
                description: "Gather and synthesize source material.",
                assigned_agent_ids: skillAssignments["research-brief-secondary"],
              },
              ...Array.from({ length: 48 }, (_, index) => ({
                id: `research-helper-${index + 1}`,
                name: `Research helper ${index + 1}`,
                description: "A focused research workflow.",
                assigned_agent_ids: [],
              })),
            ],
          },
          {
            id: "provider-cloudflare",
            name: "Cloudflare",
            description: "Cloudflare hosted skills.",
            categories: ["infrastructure", "developer_tools"],
            icon_key: "cloudflare",
            skills: [
              {
                id: 'trusted:["provider-cloudflare","cloudflare-workers"]',
                name: "Workers",
                description: "Build and deploy Cloudflare Workers.",
                assigned_agent_ids: [],
              },
            ],
          },
          {
            id: "provider-aws",
            name: "AWS",
            description: "Official AWS agent skills.",
            categories: ["cloud_infrastructure", "developer_tools"],
            icon_key: "aws",
            skills: [
              {
                id: 'trusted:["provider-aws","aws-cdk"]',
                name: "AWS CDK",
                description: "Build cloud infrastructure with CDK.",
                assigned_agent_ids: [],
              },
            ],
          },
        ],
      },
    });
  });
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/chat/activity") {
      const now = new Date().toISOString();
      await route.fulfill({
        json: chatKitActivity({
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
        }),
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
  await page.getByRole("button", { name: "Open account menu for Daniel Blignaut" }).hover();
  await page
    .getByRole("menu", { name: "Account" })
    .getByRole("menuitem", {
      name: "Plugins",
    })
    .click();

  await expect(page).toHaveURL(/\/settings\/plugins\/tools$/);
  const settingsSidebar = page.locator("aside");
  await expect(settingsSidebar.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(settingsSidebar.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(page.locator('[data-settings-width="wide"]')).toBeVisible();
  await expect(settingsSidebar.getByRole("button", { name: "Tools" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(settingsSidebar.getByRole("button", { name: "Skills" })).toBeVisible();
  await expect(settingsSidebar.getByRole("button", { name: "Routines" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Plugin type" })).toHaveCount(0);
  await settingsSidebar.getByRole("button", { name: "General" }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("heading", { name: "General" })).toHaveCount(0);
  await expect(page.locator('[data-settings-width="constrained"]')).toBeVisible();
  await settingsSidebar.getByRole("button", { name: "Routines" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/routines$/);
  await expect(settingsSidebar.getByRole("button", { name: "Routines" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await settingsSidebar.getByRole("button", { name: "Tools" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/tools$/);
  await expect(page.getByPlaceholder("Search tools")).toBeVisible();
  const catalog = page.getByRole("region", { name: "Plugins" });
  await expect(catalog.getByRole("heading", { name: "All tools", exact: true })).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Development", exact: true })).toBeVisible();
  await expect(catalog.getByRole("heading", { name: "Observability", exact: true })).toBeVisible();
  await expect(catalog.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  await expect(catalog.getByRole("heading", { name: "Proxied MCP", exact: true })).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Payments", exact: true })).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Browser", exact: true })).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Chat", exact: true })).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Other", exact: true })).toBeVisible();
  const githubSummary = catalog.getByRole("button", { name: /^GitHub/ });
  await expect(githubSummary).toBeVisible();
  await expect(page.getByText("GitHub (Work)", { exact: true })).toHaveCount(0);
  await expect(page.getByText("GitHub (Personal)", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Vercel", { exact: true })).toHaveCount(1);
  const apolloSummary = catalog.getByRole("button", { name: /^Apollo\.io/ });
  await expect(apolloSummary).toBeVisible();
  await expect(apolloSummary.locator('img[src="https://www.apollo.io/icon.svg"]')).toBeVisible();
  await expect(page.getByText("Tilde Control Plane", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tilde Skill Registry", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tilde Pay", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tilde Browser", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Message internal agent", { exact: true })).toHaveCount(0);
  await expect(githubSummary.locator('img[src^="data:image"]')).toHaveCount(1);
  const githubIcon = githubSummary.locator('img[src^="data:image"]');
  const githubIconFrame = githubIcon.locator("..");
  await expect(githubIconFrame).toHaveCSS("width", "45px");
  await expect(githubIconFrame).toHaveCSS("height", "45px");
  await expect(githubIcon).toHaveCSS("width", "32px");
  await expect(githubIcon).toHaveCSS("height", "16px");
  await expect(githubSummary).toHaveCSS("border-radius", "16px");
  await expect(githubSummary).toHaveCSS("padding", "9.5px 12px");
  expect((await githubSummary.boundingBox())?.height).toBe(64);
  await expect(
    catalog.locator(
      'img[src="https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/modal/default.svg"]',
    ),
  ).toBeVisible();
  await expect(
    catalog.locator(
      'img[src="https://raw.githubusercontent.com/e2b-dev/E2B/main/readme-assets/logo-circle.png"]',
    ),
  ).toBeVisible();
  await expect(catalog.getByRole("button", { name: /^Remove from/ })).toHaveCount(0);

  await apolloSummary.click();
  let detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByRole("heading", { name: "Apollo.io" })).toBeVisible();
  const apolloDetailIcon = detailDialog.locator('[data-slot="provider-icon"]');
  await expect(apolloDetailIcon.locator('img[src="https://www.apollo.io/icon.svg"]')).toBeVisible();
  await expect(apolloDetailIcon).toHaveCSS("width", "45px");
  await expect(apolloDetailIcon).toHaveCSS("height", "45px");
  await detailDialog.getByRole("button", { name: "Add account" }).click();
  const apolloSetup = page.getByRole("dialog", { name: "Add an Apollo.io account" });
  await expect(apolloSetup).toBeVisible();
  const apolloSetupIcon = apolloSetup.locator('[data-slot="provider-icon"]');
  await expect(apolloSetupIcon.locator('img[src="https://www.apollo.io/icon.svg"]')).toBeVisible();
  await expect(apolloSetupIcon).toHaveCSS("width", "45px");
  await expect(apolloSetupIcon).toHaveCSS("height", "45px");
  await expect(apolloSetupIcon.locator("img")).toHaveCSS("width", "32px");
  await expect(apolloSetupIcon.locator("img")).toHaveCSS("height", "32px");
  const apolloAccountName = apolloSetup.getByLabel("Account name");
  await expect(apolloAccountName).toBeVisible();
  await expect(apolloAccountName).not.toHaveAttribute("placeholder");
  await expect(
    apolloSetup.getByText("Used to identify this account when choosing it for a bot."),
  ).toBeVisible();
  await expect(
    apolloSetup.getByText("Name this account and provide the information required to connect it."),
  ).toHaveCount(0);
  const apiBaseUrl = apolloSetup.getByLabel("Api base url");
  await expect(apiBaseUrl).toBeVisible();
  await expect(apiBaseUrl).not.toHaveAttribute("placeholder");
  await expect(
    apolloSetup.getByText("Base URL for your workspace.", { exact: true }),
  ).toBeVisible();
  await expect(
    apolloSetup.getByText("Secure provider authorization managed by Tilde."),
  ).toHaveCount(0);
  await apolloSetup.getByRole("button", { name: "Cancel" }).click();

  await githubSummary.click();
  detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(detailDialog.getByText("Work", { exact: true })).toBeVisible();
  await expect(detailDialog.getByText("Personal", { exact: true })).toBeVisible();
  const workAccountRow = detailDialog.getByRole("listitem").filter({ hasText: "Work" });
  await expect(workAccountRow.locator('[data-slot="provider-icon"]')).toHaveCount(0);
  await expect(detailDialog.getByText("Connected account", { exact: true })).toHaveCount(0);
  await expect(detailDialog.getByRole("button", { name: "Add new account" })).toBeVisible();
  const removeHelloWorld = detailDialog.getByRole("button", { name: "Remove from Hello World" });
  await expect(removeHelloWorld).toBeVisible();
  await expect(removeHelloWorld.locator('[data-slot="avatar"]')).toHaveCSS(
    "background-color",
    "rgb(252, 252, 252)",
  );
  await removeHelloWorld.hover();
  await expect(removeHelloWorld.locator('[data-slot="avatar"]')).toHaveCSS("visibility", "hidden");
  await expect(removeHelloWorld.locator("svg.lucide-trash-2")).toBeVisible();
  await expect(removeHelloWorld.locator("span.bg-red")).toHaveCSS(
    "background-color",
    "rgb(255, 86, 103)",
  );
  await detailDialog.getByRole("button", { name: "Close" }).click();

  const googleSummary = catalog.getByRole("button", { name: /^Google Mail/ });
  await googleSummary.click();
  detailDialog = page.getByRole("dialog");
  await detailDialog.getByRole("button", { name: "Add account" }).click();
  const setupDialog = page.getByRole("dialog", { name: "Add a Google Mail account" });
  await expect(setupDialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add account to bot" })).toHaveCount(0);
  await expect(
    setupDialog.getByText("Platform-managed OAuth 2.0 — sign in with your provider account."),
  ).toHaveCount(0);
  await expect(
    setupDialog.getByText("Secure provider authorization managed by Tilde."),
  ).toHaveCount(0);
  await expect(setupDialog.locator('[data-slot="provider-icon"] img')).toBeVisible();
  await expect(setupDialog.locator("svg.lucide-user-round")).toBeVisible();
  const accountName = setupDialog.getByLabel("Account name");
  await expect(accountName).toHaveAttribute("required", "");
  const continueButton = setupDialog.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await expect(continueButton).toHaveCSS("background-color", "rgb(20, 20, 20)");
  await accountName.fill("Work Gmail");
  await expect(continueButton).toBeEnabled();
  await page.evaluate(() => {
    window.open = () => null;
  });
  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/connectors/accounts"),
  );
  await continueButton.click();
  expect((await createRequest).postDataJSON()).toMatchObject({ display_name: "Work Gmail" });
  await expect(setupDialog.getByText(/Waiting for Google Mail authorization/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add account to bot" })).toHaveCount(0);
  const createdAccountBotDialog = page.getByRole("dialog", { name: "Add account to bot" });
  await expect(createdAccountBotDialog).toBeVisible();
  await createdAccountBotDialog.getByRole("button", { name: "Researcher" }).click();
  await expect(createdAccountBotDialog).toBeVisible();
  await expect(
    createdAccountBotDialog.getByRole("button", { name: "Adding to Researcher" }),
  ).toBeVisible();
  await expect(createdAccountBotDialog.getByRole("status", { name: "Loading" })).toBeVisible();
  await expect(createdAccountBotDialog).toHaveCount(0);

  await catalog.getByRole("button", { name: /^Vercel/ }).click();
  detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByText("OpenBot hello-world Vercel", { exact: true })).toBeVisible();
  await expect(detailDialog.getByText("OpenBot researcher Vercel", { exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Add new account" })).toHaveCount(0);
  await detailDialog.getByRole("button", { name: "Close" }).click();

  await settingsSidebar.getByRole("button", { name: "Skills" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/skills$/);
  await expect(page.getByPlaceholder("Search skills")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Developer tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Productivity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Infrastructure", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cloud infrastructure", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Development", { exact: true })).toBeVisible();
  await expect(page.getByText("Research", { exact: true })).toBeVisible();
  await expect(page.getByText("Cloudflare", { exact: true })).toBeVisible();
  await expect(page.getByText("AWS", { exact: true })).toBeVisible();
  await expect(page.getByText("Code review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workers", { exact: true })).toHaveCount(0);
  await expect(page.getByText("AWS CDK", { exact: true })).toHaveCount(0);
  await expect(
    catalog.locator('img[src="https://thesvg.org/icons/github/default.svg"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Category", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Productivity" }).click();
  await expect(page.getByText("Research", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Development", { exact: true })).toHaveCount(0);
  await catalog.getByRole("button", { name: /^Research/ }).click();
  detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByRole("heading", { level: 2, name: "Research" })).toBeVisible();
  const viewport = page.viewportSize();
  await expect
    .poll(async () => (await detailDialog.boundingBox())?.width ?? 0)
    .toBeGreaterThan((viewport?.width ?? 0) - 40);
  expect((await detailDialog.boundingBox())?.height).toBeLessThanOrEqual(
    (viewport?.height ?? 0) - 30,
  );
  const skillGrid = detailDialog.locator("ul");
  await expect(skillGrid).toHaveCSS("overflow-y", "auto");
  await expect(skillGrid.getByRole("listitem").locator('[data-slot="provider-icon"]')).toHaveCount(
    0,
  );
  await expect(
    skillGrid.getByText("Research helper 1", { exact: true }).locator("..").locator("p"),
  ).toHaveClass(/line-clamp-3/);
  expect(
    await skillGrid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
    ),
  ).toBe(4);
  await page.setViewportSize({ width: 800, height: 720 });
  await expect
    .poll(() =>
      skillGrid.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      ),
    )
    .toBe(2);
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await skillGrid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await skillGrid.getByText("Research helper 48", { exact: true }).scrollIntoViewIfNeeded();
  await expect(skillGrid.getByText("Research helper 48", { exact: true })).toBeVisible();
  await expect(detailDialog.getByText("Research brief", { exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Remove from Hello World" })).toBeVisible();
  const removeResearchSkill = detailDialog.getByRole("button", { name: "Remove from Researcher" });
  await expect(removeResearchSkill).toBeVisible();
  await removeResearchSkill.click();
  await expect(removeResearchSkill).toHaveCount(0, { timeout: 150 });
  await expect(detailDialog.getByRole("button", { name: "Remove from Hello World" })).toBeVisible();
  await skillGrid
    .getByRole("listitem")
    .filter({ hasText: "Research brief" })
    .getByRole("button", { name: "Add to bot" })
    .click();
  const skillBotDialog = page.getByRole("dialog");
  const skillHelloBot = skillBotDialog.getByRole("button", { name: /Hello World/ });
  const skillResearchBot = skillBotDialog.getByRole("button", { name: /Researcher/ });
  const skillHelloBox = await skillHelloBot.boundingBox();
  const skillResearchBox = await skillResearchBot.boundingBox();
  expect(Math.abs((skillHelloBox?.y ?? 0) - (skillResearchBox?.y ?? 0))).toBeLessThan(1);
  expect(skillHelloBox?.x).not.toBe(skillResearchBox?.x);
  await skillResearchBot.click();
  detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByRole("heading", { name: "Research", exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Adding to Researcher" })).toBeVisible();
  await expect(detailDialog.getByRole("status", { name: "Loading" })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Remove from Researcher" })).toBeVisible();
  await detailDialog.getByRole("button", { name: "Close" }).click();

  await settingsSidebar.getByRole("button", { name: "Tools" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/tools$/);
  await page.getByRole("button", { name: "Enabled for bot" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Hello World/ }).click();
  await expect(page.getByLabel("Filtered by Hello World")).toBeVisible();
  await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
  await expect(page.getByText("Sentry", { exact: true })).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Enabled for bot" }).click();
  await githubSummary.click();
  detailDialog = page.getByRole("dialog");
  let workItem = detailDialog.getByRole("listitem").filter({
    has: page.getByText("Work", { exact: true }),
  });
  await workItem.getByRole("button", { name: "Add to bot" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Researcher/ })
    .click();
  detailDialog = page.getByRole("dialog");
  await expect(detailDialog.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Adding to Researcher" })).toBeVisible();
  await expect(detailDialog.getByRole("status", { name: "Loading" })).toBeVisible();
  workItem = detailDialog.getByRole("listitem").filter({
    has: page.getByText("Work", { exact: true }),
  });
  const removeResearcher = workItem.getByRole("button", { name: "Remove from Researcher" });
  await removeResearcher.hover();
  await expect(page.getByRole("tooltip", { name: "Researcher" })).toBeVisible();
  await removeResearcher.click();
  await expect(removeResearcher).toHaveCount(0, { timeout: 150 });
  await detailDialog.getByRole("button", { name: "Close" }).click();

  await page.getByPlaceholder("Search tools").fill("Sentry");
  await expect(page.getByText("Sentry", { exact: true })).toBeVisible();
  await expect(
    catalog.locator('img[src="https://thesvg.org/icons/sentry/default.svg"]'),
  ).toBeVisible();
  await expect(githubSummary).toHaveCount(0);

  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 820);
  await expect(page.getByText("Sentry", { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.getByRole("region", { name: "Plugins" })).toHaveCSS(
    "background-color",
    "rgb(7, 7, 7)",
  );

  await page.getByPlaceholder("Search tools").clear();
  await githubSummary.click();
  detailDialog = page.getByRole("dialog", { name: "GitHub" });
  const workRow = detailDialog.getByRole("listitem").filter({ hasText: "Work" });
  const personalRow = detailDialog.getByRole("listitem").filter({ hasText: "Personal" });
  await expect(workRow.getByRole("button", { name: "Remove Work account" })).toBeVisible();
  await expect(workRow.locator('h3 + [data-slot="avatar-group"]')).toBeVisible();
  await expect(workRow.locator(":scope > button")).toHaveAccessibleName("Remove Work account");
  await expect(personalRow.getByRole("button", { name: "Remove Personal account" })).toBeVisible();
  await workRow.getByRole("button", { name: "Remove Work account" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Remove Work account?" });
  await expect(deleteDialog).toBeVisible();
  await expect(
    deleteDialog.getByText(
      "This permanently removes this configured account from Tilde and every bot. This can't be undone.",
    ),
  ).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "GitHub" })).toBeVisible();

  await workRow.getByRole("button", { name: "Remove Work account" }).click();
  const accountDelete = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      new URL(request.url()).pathname.endsWith("/api/connectors/accounts"),
  );
  await deleteDialog.getByRole("button", { name: "Remove account", exact: true }).click();
  await expect(deleteDialog.getByRole("button", { name: "Removing…" })).toBeVisible();
  expect((await accountDelete).postDataJSON()).toEqual({
    account_ids: ["github-work"],
  });
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "GitHub" })).toBeVisible();
  await expect(detailDialog.getByText("Work", { exact: true })).toHaveCount(0);
  await expect(detailDialog.getByText("Personal", { exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "Remove Personal account" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("loads plugin settings without hydrating agent messages", async ({ page }) => {
  const messageRequests: string[] = [];
  let sidebarRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/messages")) messageRequests.push(path);
    if (path === "/api/chat/activity") sidebarRequests += 1;
  });

  await page.goto("/settings/plugins/tools");

  await expect(page.getByPlaceholder("Search tools")).toBeVisible();
  await expect(page.getByText("GitHub", { exact: true })).toBeVisible();
  expect(messageRequests).toEqual([]);
  expect(sidebarRequests).toBe(1);

  await page.getByRole("button", { name: "Back to workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => sidebarRequests).toBeGreaterThan(1);
});
