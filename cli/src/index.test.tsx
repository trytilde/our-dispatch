import { describe, expect, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { parseInvocation } from "./commands/index.js";
import { CommandMenu, Help } from "./ui.js";

describe("OpenBot CLI", () => {
  it("parses commands after pnpm's separator", () =>
    expect(parseInvocation(["--", "deploy", "--dry-run"])).toEqual({
      command: "deploy",
      rest: ["--dry-run"],
    }));
  it("defaults to help", () => expect(parseInvocation([])).toEqual({ command: "help", rest: [] }));
  it("supports the help alias", () =>
    expect(parseInvocation(["-h"])).toEqual({ command: "help", rest: [] }));
  it("renders discoverable command help", () => {
    const { lastFrame } = render(<Help />);
    expect(lastFrame()).toContain("Fork it. Configure it. Run it.");
    expect(lastFrame()).toContain("init");
    expect(lastFrame()).toContain("deploy --yes");
    expect(lastFrame()).not.toContain("Run the built OpenBot app");
  });
  it("supports keyboard navigation in the launcher", () => {
    let selected = "";
    const { stdin } = render(
      <CommandMenu
        onSelect={(command) => {
          selected = command;
        }}
      />,
    );
    stdin.write("j");
    stdin.write("\r");
    expect(selected).toBe("dev");
  });
  it("lists every public top-level command in the launcher", () => {
    const { lastFrame } = render(<CommandMenu onSelect={() => undefined} />);
    const frame = lastFrame();

    for (const command of [
      "init",
      "new-agent",
      "dev",
      "orchestrate",
      "deploy",
      "secrets",
      "env",
      "auth",
      "state",
      "tunnel",
      "plugin",
      "sdk",
      "check",
      "build",
      "test",
      "e2e",
      "desktop",
      "mobile",
      "connect",
      "remote",
      "help",
    ]) {
      expect(frame).toMatch(new RegExp(`(?:^|\\n)\\s*(?:❯\\s*)?${command}\\s`));
    }
  });
});
