import { expect, test } from "@playwright/test";

test("requires a Tilde owner session", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:14173",
    extraHTTPHeaders: { authorization: "" },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to OpenBot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Tilde" })).toBeVisible();
  await context.close();
});

test("loads the bare workspace without setup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What should OpenBot do?" })).toBeVisible();
  await expect(page.locator(".rail")).toHaveCSS("width", "280px");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "0px");
  await page.getByRole("button", { name: "Toggle Computer pane" }).click();
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "320px");
  await expect(page.locator(".chat-pane > header")).toHaveCSS("height", "38px");
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByText("Agent activity")).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "88px");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "280px");

  const sidebarHandle = await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox();
  if (!sidebarHandle) throw new Error("Sidebar resize handle is not visible");
  const sidebarHandleX = sidebarHandle.x + sidebarHandle.width / 2;
  await page.mouse.move(sidebarHandleX, sidebarHandle.y + 120);
  await page.mouse.down();
  await page.mouse.move(sidebarHandleX + 60, sidebarHandle.y + 120);
  await page.mouse.up();
  await expect(page.locator(".rail")).toHaveCSS("width", "340px");

  const workspaceHandle = await page
    .getByRole("separator", { name: "Resize Computer pane" })
    .boundingBox();
  if (!workspaceHandle) throw new Error("Computer resize handle is not visible");
  const workspaceHandleX = workspaceHandle.x + workspaceHandle.width / 2;
  await page.mouse.move(workspaceHandleX, workspaceHandle.y + 120);
  await page.mouse.down();
  await page.mouse.move(workspaceHandleX - 40, workspaceHandle.y + 120);
  await page.mouse.up();
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "360px");

  await page.reload();
  await expect(page.locator(".rail")).toHaveCSS("width", "340px");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "360px");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "88px");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "340px");
  await page.keyboard.press("Control+Alt+b");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "0px");
  await page.keyboard.press("Control+Alt+b");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "360px");
  await expect(page.getByLabel("Setup code")).toHaveCount(0);

  await page.setViewportSize({ width: 960, height: 720 });
  await expect(page.locator(".rail")).toHaveCSS("width", "88px");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("display", "grid");
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "360px");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 960);

  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("position", "fixed");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 820);

  await page.goto("/api/setup/unlock");
  await expect(page.getByRole("heading", { name: "What should OpenBot do?" })).toBeVisible();
});

test("keeps the chat composition inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator(".rail")).toBeHidden();
  const chat = await page.locator(".chat-pane").boundingBox();
  const conversation = await page.locator(".conversation").boundingBox();
  const composer = await page.locator(".composer").boundingBox();
  if (!chat || !conversation || !composer)
    throw new Error("Mobile chat composition is not visible");

  expect(chat.x).toBe(0);
  expect(chat.width).toBe(390);
  expect(conversation.x).toBeGreaterThanOrEqual(0);
  expect(conversation.x + conversation.width).toBeLessThanOrEqual(390);
  expect(composer.x).toBeGreaterThanOrEqual(0);
  expect(composer.x + composer.width).toBeLessThanOrEqual(390);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("streams rich messages and uploads a file through Tilde ChatKit", async ({ page }) => {
  const now = new Date().toISOString();
  let computerPreviewRequests = 0;
  let releaseComputerPreview = () => {};
  let computerPreviewUnavailable = true;
  const computerPreviewReady = new Promise<void>((resolve) => {
    releaseComputerPreview = resolve;
  });
  let messages: Array<Record<string, unknown>> = [
    {
      id: "message-one",
      type: "ui",
      role: "assistant",
      session_id: "session-one",
      user_display_name: "Hello World",
      created_at: now,
      parts: [{ type: "text", text: "Ready when you are." }],
    },
  ];

  await page.route("**/api/computer/**", async (route) => {
    computerPreviewRequests += 1;
    await computerPreviewReady;
    if (computerPreviewUnavailable) {
      await route.fulfill({ json: { error: "Computer preview is unavailable" }, status: 503 });
      return;
    }
    await route.fulfill({ contentType: "text/html", body: "<main>Agent desktop</main>" });
  });

  await page.route("**/media/**", async (route) => {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
  });

  await page.route("**/api/chat/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/mission-control/sidebar")) {
      await route.fulfill({
        json: {
          items: [
            {
              id: "hello-world",
              display_name: "Hello World",
              provider_id: "chatkit.http-vercel-ai-sdk",
              status: "enabled",
              sessions: {
                items: [
                  {
                    id: "session-one",
                    title: "Working session",
                    created_at: now,
                    updated_at: now,
                    unread: true,
                  },
                ],
              },
            },
            {
              id: "researcher",
              display_name: "Researcher",
              provider_id: "chatkit.http-vercel-ai-sdk",
              status: "enabled",
              sessions: { items: [] },
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/observe")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body:
          'id: turn-working\nevent: agent_turn_status\ndata: {"status":"working"}\n\n' +
          'id: shell-running\nevent: shell_started\ndata: {"id":"shell-one","status":"running","label":"Build workspace","summary":"pnpm build"}\n\n' +
          'id: stream-preview\nevent: message_streaming\ndata: {"kind":{"message_streaming":{"session_id":"session-one","message_id":"stream-one","delta":{"type":"text-delta","delta":"Streaming preview"}}}}\n\n' +
          'id: turn-idle\nevent: agent_turn_status\ndata: {"status":"idle"}\n\n',
      });
      return;
    }
    if (path.endsWith("/agent-turn-queue")) {
      await route.fulfill({
        json: {
          items: [
            {
              id: "queue-one",
              session_id: "session-one",
              queue_position: 1,
              status: "pending",
              chat_request: {
                messages: [{ role: "user", content: [{ type: "text", text: "Queued follow-up" }] }],
              },
              created_at: now,
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/agent-turn-queue/queue-one") && request.method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (path.endsWith("/messages") && request.method() === "GET") {
      await route.fulfill({ json: { items: messages } });
      return;
    }
    if (path.endsWith("/attachment/upload")) {
      await route.fulfill({
        json: {
          attachment: { id: "attachment-one", media_type: "text/plain", status: "pending" },
          upload_url:
            "https://api.trytilde.ai/api/v1/team/e2e-team/chatkit/session/session-one/attachment/attachment-one/content",
          upload_headers: { "content-type": "text/plain" },
        },
      });
      return;
    }
    if (path.endsWith("/attachment/attachment-one/content")) {
      await route.fulfill({ json: { status: "uploaded" } });
      return;
    }
    if (path.endsWith("/attachment/attachment-one/complete")) {
      await route.fulfill({
        json: { id: "attachment-one", media_type: "text/plain", status: "uploaded" },
      });
      return;
    }
    if (path.endsWith("/messages") && request.method() === "POST") {
      messages = [
        ...messages,
        {
          id: "message-user",
          type: "ui",
          role: "user",
          session_id: "session-one",
          user_display_name: "You",
          created_at: now,
          parts: [
            { type: "text", text: "Read this file" },
            {
              type: "file",
              filename: "brief.txt",
              media_type: "text/plain",
              url: "https://files.test/brief.txt",
            },
          ],
        },
        {
          id: "message-two",
          type: "ui",
          role: "assistant",
          session_id: "session-one",
          user_display_name: "Hello World",
          created_at: now,
          parts: [
            { type: "reasoning", text: "Inspecting the attachment", state: "done" },
            {
              type: "tool",
              tool_name: "read_file",
              tool_invocation_id: "tool-one",
              state: "output-available",
              input: { path: "brief.txt" },
              output: { bytes: 12 },
            },
            { type: "text", text: "The file is **clear** and complete." },
            {
              type: "source-url",
              source_id: "source-one",
              title: "Reference",
              url: "https://example.com",
            },
            {
              type: "file",
              filename: "screenshot.png",
              media_type: "image/png",
              url: "/media/screenshot.png",
            },
            {
              type: "connector",
              connector: "GitHub",
              variant: "connect",
              reason: "Authorize GitHub so I can work with repositories.",
              authorizationUrl: "https://github.com/login/oauth/authorize?client_id=openbot-test",
            },
          ],
        },
      ];
      await route.fulfill({ json: { items: messages } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled ${request.method()} ${path}` } });
  });

  await page.goto("/");
  await expect(page.locator(".agent-row")).toHaveCount(2);
  await expect(page.locator(".agent-workspace-pane iframe")).toHaveCount(0);
  expect(computerPreviewRequests).toBe(0);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(252, 252, 252)");
  await expect(page.locator(".rail")).toHaveCSS("background-color", "rgb(247, 247, 247)");
  await expect(page.locator(".agent-row").first()).toHaveCSS("height", "54px");
  await expect(page.locator(".agent-row").first()).toHaveCSS("border-radius", "10px");
  await expect(page.locator(".agent-row .avatar").first()).toHaveCSS("width", "36px");
  await expect(page.locator(".agent-row .agent-avatar-mark").first()).toBeVisible();
  await expect(page.locator(".agent-row .avatar").first()).toHaveAttribute(
    "data-avatar-shape",
    "teardrop",
  );
  await expect(page.locator(".agent-row .agent-avatar-body").first()).toHaveCSS(
    "fill",
    "rgb(0, 201, 114)",
  );
  await expect(page.locator(".agent-row .avatar").first()).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".agent-row .avatar").first()).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".agent-row").first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".agent-row").first()).toContainText("Streaming preview");
  await expect(page.locator(".agent-row").first()).not.toContainText("enabled");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCSS(
    "line-height",
    "20px",
  );
  await expect(page.locator(".agent-row strong").first()).toHaveCSS("font-size", "14px");
  await expect(page.locator(".agent-row strong").first()).toHaveCSS("line-height", "20px");
  await expect(page.locator(".agent-row small").first()).toHaveCSS("font-size", "13px");
  await expect(page.locator(".agent-row small").first()).toHaveCSS("line-height", "18px");
  await expect(page.locator(".agent-row").first().locator(".agent-row-marker")).toBeVisible();
  await expect(page.locator(".agent-row").first().locator(".agent-row-marker > i")).toHaveCSS(
    "background-color",
    "rgb(16, 132, 254)",
  );
  await page.locator(".agent-row").nth(1).hover();
  await expect(page.locator(".agent-row").nth(1)).toHaveCSS(
    "background-color",
    "rgba(119, 119, 119, 0.09)",
  );
  const accountButton = page.getByRole("button", { name: "Open account menu for Daniel Adams" });
  await expect(accountButton).toBeVisible();
  await expect(page.getByText("OpenBot", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);
  await accountButton.click();
  const accountMenu = page.getByRole("menu", { name: "Account" });
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("menuitem")).toHaveText([
    "Settings",
    "About",
    "Help Center",
    "Send Feedback",
    "Log out",
  ]);
  await expect(accountMenu.getByText("Plugins", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(accountMenu).toBeHidden();
  await expect(page.locator(".workspace-shell")).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0.22, 1, 0.36, 1)",
  );
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "88px");
  await expect(page.locator(".agent-row").first()).toHaveCSS("width", "54px");
  await expect(page.locator(".agent-row-body").first()).toBeHidden();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeHidden();
  await expect(page.locator(".rail-footer")).toHaveCSS("width", "44px");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".rail")).toHaveCSS("width", "280px");
  await expect(page.locator(".agent-row-body").first()).toBeVisible();
  await expect(page.getByText("Working session")).toHaveCount(0);
  await expect(page.getByText("Ready when you are.")).toBeVisible();
  await page.getByRole("button", { name: "Toggle full conversation" }).click();
  const outlinePanel = page.getByRole("dialog", { name: "Full conversation: Hello World" });
  await expect(outlinePanel).toBeVisible();
  await expect(outlinePanel).toHaveCSS("width", "360px");
  await expect(outlinePanel).toHaveCSS("top", "56px");
  await expect(outlinePanel).toHaveCSS("border-radius", "14px");
  await expect(outlinePanel).toHaveCSS("animation-duration", "0.16s");
  await outlinePanel.getByRole("button", { name: /Agent/ }).first().click();
  await expect(outlinePanel.locator(".outline-item-detail-text").first()).toHaveText(
    "Ready when you are.",
  );
  await outlinePanel.getByRole("button", { name: "Close full conversation" }).click();
  await page.getByRole("button", { name: "Toggle async tasks" }).click();
  const asyncTasksPanel = page.getByRole("dialog", { name: "Async tasks: Hello World" });
  await expect(asyncTasksPanel).toBeVisible();
  await expect(asyncTasksPanel).toHaveCSS("width", "340px");
  await expect(asyncTasksPanel.getByText("Build workspace")).toBeVisible();
  await expect(asyncTasksPanel.getByText("Shell · pnpm build")).toBeVisible();
  await asyncTasksPanel.getByRole("button", { name: "Close async tasks" }).click();
  await expect(page.locator(".message.assistant .message-bubble").first()).toHaveCSS(
    "background-color",
    "rgb(238, 238, 238)",
  );
  await expect(page.locator(".message.assistant .message-bubble").first()).toHaveCSS(
    "border-radius",
    "18px 18px 18px 6px",
  );
  await expect(page.locator(".composer")).toHaveCSS("background-color", "rgb(247, 247, 247)");
  await expect(page.locator(".composer")).toHaveCSS("border-radius", "16px");
  await page.getByRole("button", { name: "Toggle Computer pane" }).click();
  await expect(page.locator(".agent-workspace-pane iframe")).toHaveCount(1);
  await expect.poll(() => computerPreviewRequests).toBe(1);
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS(
    "transition-duration",
    "0.24s, 0.09s, 0.2s, 0s",
  );
  await expect(page.getByText("Booting up the computer")).toBeVisible();
  await expect(page.locator(".computer-stage-progress")).toHaveCSS("width", "237px");
  await expect(page.locator(".computer-stage-progress > .indeterminate")).toHaveCSS(
    "animation-duration",
    "1.4s",
  );
  releaseComputerPreview();
  const reconnectBanner = page.getByRole("status", { name: "Reconnecting" });
  await expect(reconnectBanner).toBeVisible();
  await expect(reconnectBanner).toHaveCSS("border-radius", "10px");
  computerPreviewUnavailable = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(reconnectBanner).toHaveCount(0);
  await expect(page.getByTitle("Hello World Computer")).toBeVisible();
  await expect(
    page.getByTitle("Hello World Computer").contentFrame().getByText("Agent desktop"),
  ).toBeVisible();
  const monitorStrip = page.getByRole("group", { name: "Computer screens" });
  await expect(monitorStrip).toBeVisible();
  await expect(monitorStrip).toHaveCSS("height", "122px");
  const researcherMonitor = monitorStrip.getByRole("button", { name: "Switch to Researcher" });
  await expect(researcherMonitor).toBeVisible();
  await researcherMonitor.click();
  await expect(page.getByTitle("Researcher Computer")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hello World" })).toBeVisible();
  await page.getByRole("button", { name: "Enter full screen" }).click();
  await expect(page.locator(".agent-workspace-pane")).toHaveClass(/fullscreen/);
  await expect(page.locator(".agent-workspace-pane")).toHaveCSS("width", "1280px");
  await page.keyboard.press("Escape");
  await expect(page.locator(".agent-workspace-pane")).not.toHaveClass(/fullscreen/);
  await page.getByRole("button", { name: /Click to take over/ }).click();
  await expect(page.getByRole("button", { name: "Release" })).toBeVisible();
  await page.getByRole("button", { name: /Activity/ }).click();
  await expect(page.locator(".activity-surface")).toHaveCSS(
    "background-color",
    "rgb(252, 252, 252)",
  );
  await expect(page.locator(".queue-panel")).toHaveCSS("background-color", "rgb(252, 252, 252)");
  await expect(
    page.locator(".message-list").getByText("Streaming preview", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".message-list").getByText("Streaming preview", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("Queued follow-up")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Queued follow-up",
  );
  await page.getByLabel("Attach files").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("OpenBot brief"),
  });
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Read this file");
  await page.getByLabel("Send message").click();

  await expect(
    page.locator(".message-list").getByText("The file is clear and complete.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message.user .message-bubble")).toHaveCSS(
    "background-color",
    "rgb(7, 7, 7)",
  );
  await expect(page.getByText("read_file")).toBeVisible();
  await expect(page.getByRole("button", { name: /brief.txt/ })).toBeVisible();
  await page.getByRole("button", { name: /brief.txt/ }).click();
  await expect(page.getByRole("dialog", { name: "Preview brief.txt" })).toBeVisible();
  await expect(page.locator(".file-viewer")).toHaveCSS(
    "background-color",
    "rgba(20, 20, 20, 0.898)",
  );
  await expect(page.locator(".file-viewer-panel")).toHaveCSS("max-width", "1100px");
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.getByRole("dialog", { name: "Preview brief.txt" })).toHaveCount(0);
  await page.getByRole("button", { name: /screenshot.png/ }).click();
  const mediaViewer = page.getByRole("dialog", { name: "Media preview" });
  await expect(mediaViewer).toBeVisible();
  await expect(mediaViewer).toHaveCSS("background-color", "rgba(20, 20, 20, 0.898)");
  await expect(mediaViewer.getByRole("img", { name: "screenshot.png" })).toBeVisible();
  await page.getByRole("button", { name: "Close media preview" }).click();
  await expect(mediaViewer).toHaveCount(0);
  await expect(page.locator(".connection-card")).toHaveCSS(
    "background-color",
    "rgb(247, 247, 247)",
  );
  await expect(page.locator(".connection-card")).toHaveCSS("border-radius", "9px");
  await expect(page.getByRole("link", { name: "Authorize" })).toHaveAttribute(
    "href",
    "https://github.com/login/oauth/authorize?client_id=openbot-test",
  );
  await page.getByLabel("Agent message").first().hover();
  await page.getByLabel("Reply").first().click();
  await expect(page.getByText("Replying to Hello World")).toBeVisible();
  await page.getByLabel("Cancel reply").click();
  await expect(page.getByText("Agent Turn Status").first()).toBeVisible();
  await page.getByLabel("Agent message").first().hover();
  await page.getByLabel("More message actions").first().click();
  await page.getByRole("menuitem", { name: "Start a thread" }).click();
  const exchange = page.getByRole("dialog", { name: "Agent exchange" });
  await expect(exchange).toBeVisible();
  await expect(
    exchange.getByRole("paragraph").filter({ hasText: "Ready when you are." }),
  ).toBeVisible();
  await expect(exchange.getByText("Replying to Hello World")).toBeVisible();
  await expect(exchange.locator(".thread-overlay-sheet")).toHaveCSS(
    "animation-timing-function",
    "linear(0 0%, 0.01588 2%, 0.05618 4%, 0.11201 6%, 0.1768 8%, 0.2458 10%, 0.31562 12%, 0.38392 14%, 0.44914 16%, 0.51029 18%, 0.56683 20%, 0.61852 22%, 0.66534 24%, 0.70743 26%, 0.74501 28%, 0.77838 30%, 0.80788 32%, 0.83383 34%, 0.85658 36%, 0.87645 38%, 0.89376 40%, 0.92183 44%, 0.94282 48%, 0.95838 52%, 0.96984 56%, 0.97823 60%, 0.98435 64%, 0.98878 68%, 0.99198 72%, 0.99594 80%, 0.99829 90%, 1 100%)",
  );
  await page.keyboard.press("Escape");
  await expect(exchange).toHaveCount(0);

  await page.getByRole("button", { name: "Toggle Computer pane" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of [".message-list", ".reasoning-part", ".connection-card", ".composer"]) {
    const bounds = await page.locator(selector).first().boundingBox();
    if (!bounds) throw new Error(`${selector} is not visible in the mobile chat`);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("queues another turn while the agent is busy", async ({ page }) => {
  const now = new Date().toISOString();
  let queued = false;
  let postedText = "";

  await page.route("**/api/computer/**", async (route) => {
    await route.fulfill({ contentType: "text/html", body: "<main>Busy agent desktop</main>" });
  });

  await page.route("**/api/chat/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/mission-control/sidebar")) {
      await route.fulfill({
        json: {
          items: [
            {
              id: "busy-agent",
              display_name: "Busy Agent",
              provider_id: "chatkit.http-vercel-ai-sdk",
              status: "enabled",
              sessions: {
                items: [
                  { id: "busy-session", title: "Busy session", created_at: now, updated_at: now },
                ],
              },
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/observe")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'event: agent_turn_status\ndata: {"status":"working"}\n\n',
      });
      return;
    }
    if (path.endsWith("/agent-turn-queue")) {
      await route.fulfill({
        json: {
          items: queued
            ? [
                {
                  id: "queued-two",
                  session_id: "busy-session",
                  queue_position: 1,
                  status: "pending",
                  chat_request: {
                    messages: [{ role: "user", content: [{ type: "text", text: postedText }] }],
                  },
                  created_at: now,
                },
              ]
            : [],
        },
      });
      return;
    }
    if (path.endsWith("/messages") && request.method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path.endsWith("/messages") && request.method() === "POST") {
      const body = request.postDataJSON() as { text: string };
      postedText = body.text;
      queued = true;
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await expect(page.getByLabel("Queue message")).toBeVisible();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Do this next");
  await page.getByLabel("Queue message").click();
  await page.getByRole("button", { name: "Toggle Computer pane" }).click();
  await page.getByRole("button", { name: /Activity/ }).click();
  await expect(page.getByText("Do this next")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Search agents" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search agents" }).fill("Busy");
  await expect(page.getByRole("dialog").getByRole("button", { name: /Busy Agent/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search agents" })).toHaveCount(0);
});

test("keeps the server healthy", async ({ request }) => {
  const health = await request.get("/healthz");
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toEqual({ ok: true, service: "openbot" });
});
