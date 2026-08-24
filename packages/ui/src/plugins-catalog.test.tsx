import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PluginsCatalog, type PluginsCatalogProps } from "./plugins-catalog.js";

const baseProps: PluginsCatalogProps = {
  agents: [{ id: "factory", name: "Factory" }],
  toolProviders: [],
  skillProviders: [],
  onAddToolAccount: () => undefined,
  onSetSkill: () => undefined,
  onSetToolAccount: () => undefined,
};

describe("PluginsCatalog loading and avatars", () => {
  it("renders row-shaped skeletons while the catalog loads", () => {
    const markup = renderToStaticMarkup(
      createElement(PluginsCatalog, { ...baseProps, loading: true }),
    );

    expect(markup).toContain('aria-label="Loading tools"');
    expect(markup.match(/animate-pulse/g)).toHaveLength(6);
    expect(markup).not.toContain("Loading tools…");
  });

  it("fits assigned bot characters to the centered shadcn avatar slot", () => {
    const markup = renderToStaticMarkup(
      createElement(PluginsCatalog, {
        ...baseProps,
        toolProviders: [
          {
            id: "github",
            name: "GitHub",
            description: "Repositories",
            categories: ["Development"],
            accounts: [
              { id: "github-work", accountName: "Work", assignedAgentIds: ["factory"] },
              { id: "github-personal", accountName: "Personal", assignedAgentIds: [] },
            ],
          },
        ],
      }),
    );

    expect(markup).toContain("items-center justify-center overflow-hidden");
    expect(markup).toContain("!size-full");
    expect(markup).toContain("bg-surface");
    expect(markup).not.toContain("Work");
    expect(markup).not.toContain("Personal");
    expect(markup).not.toContain("Remove from Factory");
  });

  it("resolves Tilde icon keys for tool providers", () => {
    const toolsMarkup = renderToStaticMarkup(
      createElement(PluginsCatalog, {
        ...baseProps,
        toolProviders: [
          {
            id: "google_mail",
            name: "Google Mail",
            description: "Email",
            categories: ["Productivity"],
            iconKey: "google-mail",
            accounts: [],
          },
          {
            id: "modal-sandbox",
            name: "Modal",
            description: "Sandboxes",
            categories: ["Development"],
            iconKey: "modal sandbox",
            accounts: [],
          },
          {
            id: "e2b",
            name: "E2B",
            description: "Sandboxes",
            categories: ["Development"],
            iconKey: "e2b",
            accounts: [],
          },
        ],
      }),
    );
    expect(toolsMarkup).toContain("https://thesvg.org/icons/google-mail/default.svg");
    expect(toolsMarkup).toContain(
      "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/modal/default.svg",
    );
    expect(toolsMarkup).toContain(
      "https://raw.githubusercontent.com/e2b-dev/E2B/main/readme-assets/logo-circle.png",
    );
    expect(toolsMarkup).toContain("size-[45px]");
    expect(toolsMarkup).toContain("h-auto max-h-8 w-auto max-w-8");
    expect(toolsMarkup).not.toContain("gap-[22px] border-b border-line");
  });

  it("does not offer toolkit account creation for a proxied MCP URL group", () => {
    const markup = renderToStaticMarkup(
      createElement(PluginsCatalog, {
        ...baseProps,
        toolProviders: [
          {
            id: "proxied-mcp:https://mcp.vercel.com",
            name: "Vercel",
            description: "https://mcp.vercel.com",
            categories: ["other"],
            iconKey: "vercel",
            canAddAccount: false,
            accounts: [
              {
                id: "vercel-factory",
                accountName: "OpenBot factory Vercel",
                assignedAgentIds: ["factory"],
              },
            ],
          },
        ],
      }),
    );

    expect(markup).toContain("Vercel");
    expect(markup).not.toContain("Add new account");
    expect(markup).not.toContain("Add account");
  });

  it("renders the Other tool group after catalog categories", () => {
    const markup = renderToStaticMarkup(
      createElement(PluginsCatalog, {
        ...baseProps,
        toolProviders: [
          {
            id: "proxied-mcp:https://mcp.vercel.com",
            name: "Vercel",
            description: "https://mcp.vercel.com",
            categories: ["other"],
            accounts: [],
          },
          {
            id: "github",
            name: "GitHub",
            description: "Repositories",
            categories: ["Development"],
            accounts: [],
          },
        ],
      }),
    );

    expect(markup.indexOf("Development")).toBeLessThan(markup.indexOf("Other"));
  });
});
