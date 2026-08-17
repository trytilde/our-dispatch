import { chmod, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { cliFailureDetails, createCliRunLog } from "./logging.js";

describe("CLI run logging", () => {
  it("creates a private random run log and removes logs older than three days", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "openbot-cli-log-"));
    const directory = join(homeDirectory, ".openbot", "logs");
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o755);
    const oldLog = join(directory, "old.log");
    const recentLog = join(directory, "recent.log");
    await writeFile(oldLog, "old");
    await writeFile(recentLog, "recent");
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    await utimes(
      oldLog,
      new Date(now - 4 * 24 * 60 * 60 * 1_000),
      new Date(now - 4 * 24 * 60 * 60 * 1_000),
    );
    await utimes(
      recentLog,
      new Date(now - 2 * 24 * 60 * 60 * 1_000),
      new Date(now - 2 * 24 * 60 * 60 * 1_000),
    );

    const log = await createCliRunLog({ homeDirectory, now, randomId: "random-run" });
    log.writeError(new Error("complete stack required"), "Test failure");
    log.close();

    await expect(stat(oldLog)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(recentLog, "utf8")).resolves.toBe("recent");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(log.path)).mode & 0o777).toBe(0o600);
    const contents = await readFile(log.path, "utf8");
    expect(contents).toContain("OpenBot CLI run started");
    expect(contents).toContain("Test failure Error: complete stack required");
    expect(contents).toContain("logging.test.ts");
  });

  it("redacts sensitive values from complete error stacks", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "openbot-cli-log-redact-"));
    const secret = "do-not-record-this-token";
    const log = await createCliRunLog({
      homeDirectory,
      randomId: "redacted-run",
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    log.writeError(new Error(`request failed with ${secret}`));
    log.close();

    const contents = await readFile(log.path, "utf8");
    expect(contents).not.toContain(secret);
    expect(contents).toContain("request failed with [REDACTED]");
  });

  it("adds a stack even when non-Error values are thrown", async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "openbot-cli-log-string-error-"));
    const log = await createCliRunLog({ homeDirectory, randomId: "string-error-run" });
    log.writeError("plain failure");
    log.close();

    const contents = await readFile(log.path, "utf8");
    expect(contents).toContain("Error: plain failure");
    expect(contents).toContain("logging.test.ts");
  });

  it("renders a redacted complete stack and cause chain for CLI failures", () => {
    const secret = "private-api-key";
    const cause = new Error(`authentication failed with ${secret}`);
    const error = new Error("provider reconciliation failed", { cause });

    const failure = cliFailureDetails(error, (value) => value.replaceAll(secret, "[REDACTED]"));

    expect(failure.message).toBe("provider reconciliation failed");
    expect(failure.stack).toContain("Error: provider reconciliation failed");
    expect(failure.stack).toContain("Caused by:\nError: authentication failed with [REDACTED]");
    expect(failure.stack).not.toContain(secret);
  });
});
