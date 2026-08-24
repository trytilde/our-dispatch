import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("agent desktops", () => {
  it("allocates stable, separate displays when agents start concurrently", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "openbot-desktop-test-"));
    temporaryDirectories.push(temporaryDirectory);
    const binaryDirectory = join(temporaryDirectory, "bin");
    const desktopRoot = join(temporaryDirectory, "desktops");
    const tokenFile = join(temporaryDirectory, "novnc.tokens");
    const desktopSession = join(temporaryDirectory, "desktop-session.sh");
    await mkdir(binaryDirectory);
    for (const command of ["Xvnc", "xdpyinfo", "dbus-send", "dbus-daemon"])
      await symlink("/usr/bin/true", join(binaryDirectory, command));
    await writeFile(desktopSession, '#!/bin/sh\ntouch "$XDG_RUNTIME_DIR/desktop-ready"\n', {
      mode: 0o755,
    });

    process.env.PATH = `${binaryDirectory}:${originalEnvironment.PATH ?? ""}`;
    process.env.COMPUTER_DESKTOP_ROOT = desktopRoot;
    process.env.COMPUTER_VNC_TOKEN_FILE = tokenFile;
    process.env.COMPUTER_DESKTOP_SESSION = desktopSession;
    vi.resetModules();
    const { agentDesktopEnvironment, ensureAgentDesktop } = await import("./desktop.js");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const [first, second] = await Promise.all([
      ensureAgentDesktop("first-agent", "a".repeat(32), undefined, "preview-one"),
      ensureAgentDesktop("second-agent", "b".repeat(32)),
    ]);

    expect(new Set([first.display, second.display])).toEqual(new Set([":10", ":11"]));
    expect(new Set([first.vncPort, second.vncPort])).toEqual(new Set([5910, 5911]));
    expect(first).not.toEqual(second);
    expect(agentDesktopEnvironment("first-agent", first)).toMatchObject({
      DISPLAY: first.display,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(desktopRoot, "first-agent", "runtime", "bus")}`,
    });
    await expect(ensureAgentDesktop("first-agent", "a".repeat(32))).resolves.toEqual(first);
    expect((await readFile(tokenFile, "utf8")).trim().split("\n").sort()).toEqual(
      [
        `${"a".repeat(32)}: localhost:${first.vncPort}`,
        `${"b".repeat(32)}: localhost:${second.vncPort}`,
      ].sort(),
    );
    expect(info).toHaveBeenCalledWith(
      "[openbot-vnc] started desktop",
      expect.objectContaining({
        agentId: "first-agent",
        display: first.display,
        requestId: "preview-one",
        vncPort: first.vncPort,
      }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("a".repeat(32));
  });

  it("rejects an unsafe agent identifier before touching the filesystem", async () => {
    const { ensureAgentDesktop } = await import("./desktop.js");
    await expect(ensureAgentDesktop("../other-agent")).rejects.toThrow("valid agent_id");
  });
});
