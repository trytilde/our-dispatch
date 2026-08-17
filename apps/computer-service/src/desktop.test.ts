import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(async () => {
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
    await mkdir(binaryDirectory);
    for (const command of ["Xvnc", "xdpyinfo", "dbus-launch", "google-chrome-stable"])
      await symlink("/usr/bin/true", join(binaryDirectory, command));

    process.env.PATH = `${binaryDirectory}:${originalEnvironment.PATH ?? ""}`;
    process.env.COMPUTER_DESKTOP_ROOT = desktopRoot;
    process.env.COMPUTER_VNC_TOKEN_FILE = tokenFile;
    vi.resetModules();
    const { ensureAgentDesktop } = await import("./desktop.js");

    const [first, second] = await Promise.all([
      ensureAgentDesktop("first-agent", "a".repeat(32)),
      ensureAgentDesktop("second-agent", "b".repeat(32)),
    ]);

    expect(first).toEqual({ display: ":10", vncPort: 5910 });
    expect(second).toEqual({ display: ":11", vncPort: 5911 });
    await expect(ensureAgentDesktop("first-agent", "a".repeat(32))).resolves.toEqual(first);
    expect((await readFile(tokenFile, "utf8")).trim().split("\n").sort()).toEqual(
      [`${"a".repeat(32)}: localhost:5910`, `${"b".repeat(32)}: localhost:5911`].sort(),
    );
  });

  it("rejects an unsafe agent identifier before touching the filesystem", async () => {
    const { ensureAgentDesktop } = await import("./desktop.js");
    await expect(ensureAgentDesktop("../other-agent")).rejects.toThrow("valid agent_id");
  });
});
