import { describe, expect, it } from "vite-plus/test";
import {
  artifactKind,
  mergeManifest,
  platformEntry,
  publicationGuard,
  resolveSigning,
  resolveAppId,
  resolveTarget,
} from "./release.js";

const officialBucket = "tilde-app-updates-prod";

describe("resolveTarget", () => {
  it("defaults to the official bucket and nests the channel under the prefix", () => {
    const target = resolveTarget("latest");
    expect(target.bucket).toBe(officialBucket);
    expect(target.prefix).toBe("desktop/openbot/latest");
    expect(target.baseUrl).toBe(
      `https://${officialBucket}.s3.us-east-1.amazonaws.com/desktop/openbot/latest`,
    );
  });

  // An unset `vars.DESKTOP_UPDATES_S3_BUCKET` arrives as "", which `??` would accept
  // and resolve the bucket to an empty string.
  it("falls back to the official bucket when the override is set but empty", () => {
    process.env.OPENBOT_DESKTOP_UPDATES_BUCKET = "";
    process.env.OPENBOT_DESKTOP_UPDATES_PREFIX = "";
    process.env.OPENBOT_DESKTOP_UPDATES_BASE_URL = "";
    try {
      const target = resolveTarget("latest");
      expect(target.bucket).toBe(officialBucket);
      expect(target.prefix).toBe("desktop/openbot/latest");
      expect(target.baseUrl).toContain(officialBucket);
    } finally {
      delete process.env.OPENBOT_DESKTOP_UPDATES_BUCKET;
      delete process.env.OPENBOT_DESKTOP_UPDATES_PREFIX;
      delete process.env.OPENBOT_DESKTOP_UPDATES_BASE_URL;
    }
  });

  it("lets a fork redirect the bucket, prefix, and public base url", () => {
    process.env.OPENBOT_DESKTOP_UPDATES_BUCKET = "a-fork-bucket";
    process.env.OPENBOT_DESKTOP_UPDATES_PREFIX = "/builds/";
    process.env.OPENBOT_DESKTOP_UPDATES_BASE_URL = "https://downloads.example.test/";
    try {
      const target = resolveTarget("beta");
      expect(target.bucket).toBe("a-fork-bucket");
      expect(target.prefix).toBe("builds/beta");
      expect(target.baseUrl).toBe("https://downloads.example.test/builds/beta");
    } finally {
      delete process.env.OPENBOT_DESKTOP_UPDATES_BUCKET;
      delete process.env.OPENBOT_DESKTOP_UPDATES_PREFIX;
      delete process.env.OPENBOT_DESKTOP_UPDATES_BASE_URL;
    }
  });
});

describe("resolveAppId", () => {
  it("defaults to the publisher's identifier", () => {
    expect(resolveAppId()).toBe("ai.trytilde.openbot");
  });

  it("honours the OPENBOT_APP_ID a fork sets for desktop", () => {
    process.env.OPENBOT_APP_ID = "com.example.fork";
    try {
      expect(resolveAppId()).toBe("com.example.fork");
    } finally {
      delete process.env.OPENBOT_APP_ID;
    }
  });

  it("falls back when the override is set but empty", () => {
    process.env.OPENBOT_APP_ID = "";
    try {
      expect(resolveAppId()).toBe("ai.trytilde.openbot");
    } finally {
      delete process.env.OPENBOT_APP_ID;
    }
  });
});

describe("publicationGuard", () => {
  // The bucket name is tracked, so a fork inherits it. Refusing here is the boundary;
  // IAM is the backstop, not the other way round.
  it("refuses the official bucket from a fork and names the override", () => {
    const message = publicationGuard(forkCheckout(), officialBucket);
    expect(message).toContain("Refusing to publish");
    expect(message).toContain("OPENBOT_DESKTOP_UPDATES_BUCKET");
  });

  it("allows a fork that publishes to its own bucket", () => {
    expect(publicationGuard(forkCheckout(), "a-fork-bucket")).toBeUndefined();
  });
});

describe("artifactKind", () => {
  it("recognises the installable artifacts and ignores builder debris", () => {
    expect(artifactKind("OpenBot-0.2.0-mac-arm64.dmg")).toBe("dmg");
    expect(artifactKind("OpenBot-0.2.0-mac-arm64.zip")).toBe("zip");
    expect(artifactKind("OpenBot-0.2.0-linux-x86_64.AppImage")).toBe("appimage");
    expect(artifactKind("OpenBot-0.2.0-linux-amd64.deb")).toBe("deb");
    expect(artifactKind("OpenBot-0.2.0-mac-arm64.zip.blockmap")).toBeUndefined();
    expect(artifactKind("latest-mac.yml")).toBeUndefined();
    expect(artifactKind(".openbot-release-state.json")).toBeUndefined();
  });
});

describe("platformEntry", () => {
  it("builds absolute urls and drops anything that is not an artifact", () => {
    const entry = platformEntry({
      version: "0.2.0",
      releasedAt: "2026-08-19T09:00:00.000Z",
      signed: true,
      notarized: true,
      baseUrl: "https://downloads.example.test/desktop/openbot/latest",
      files: [
        { name: "OpenBot-0.2.0-mac-arm64.dmg", size: 10, sha512: "aaa" },
        { name: "OpenBot-0.2.0-mac-arm64.zip.blockmap", size: 1, sha512: "bbb" },
      ],
    });
    expect(entry.artifacts).toHaveLength(1);
    expect(entry.artifacts[0]?.url).toBe(
      "https://downloads.example.test/desktop/openbot/latest/OpenBot-0.2.0-mac-arm64.dmg",
    );
    expect(entry.notarized).toBe(true);
  });
});

describe("mergeManifest", () => {
  const mac = entryFor("0.2.0");
  const linux = entryFor("0.1.0");

  it("keys platforms separately so a partial release reports honestly", () => {
    const manifest = mergeManifest({
      channel: "latest",
      generatedAt: "2026-08-19T09:00:00.000Z",
      entries: [
        ["darwin-arm64", mac],
        ["linux-x64", linux],
      ],
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.platforms["darwin-arm64"]?.version).toBe("0.2.0");
    expect(manifest.platforms["linux-x64"]?.version).toBe("0.1.0");
  });

  // A mac-only re-run must not erase linux, which is why `manifest` reads every entry
  // back out of the bucket instead of assembling from one job's state.
  it("preserves an untouched platform when another is republished", () => {
    const republished = mergeManifest({
      channel: "latest",
      generatedAt: "2026-08-19T10:00:00.000Z",
      entries: [
        ["darwin-arm64", entryFor("0.3.0")],
        ["linux-x64", linux],
      ],
    });
    expect(republished.platforms["darwin-arm64"]?.version).toBe("0.3.0");
    expect(republished.platforms["linux-x64"]?.version).toBe("0.1.0");
  });
});

describe("resolveSigning", () => {
  it("degrades to an unsigned build and warns when no certificate is present", () => {
    const signing = resolveSigning({});
    expect(signing.signed).toBe(false);
    expect(signing.notarized).toBe(false);
    expect(signing.environment.CSC_IDENTITY_AUTO_DISCOVERY).toBe("false");
    expect(signing.warnings.join(" ")).toContain("UNSIGNED");
  });

  it("signs without notarizing when the App Store Connect key is missing", () => {
    const signing = resolveSigning({
      MACOS_CERTIFICATE: Buffer.from("certificate").toString("base64"),
      MACOS_CERTIFICATE_PASSWORD: "password",
    });
    expect(signing.signed).toBe(true);
    expect(signing.notarized).toBe(false);
    expect(signing.warnings.join(" ")).toContain("notariz");
  });

  it("signs and notarizes when every credential is present", () => {
    const signing = resolveSigning({
      MACOS_CERTIFICATE: Buffer.from("certificate").toString("base64"),
      MACOS_CERTIFICATE_PASSWORD: "password",
      APPLE_API_KEY: Buffer.from("key").toString("base64"),
      APPLE_API_KEY_ID: "KEYID",
      APPLE_API_ISSUER: "issuer",
    });
    expect(signing.signed).toBe(true);
    expect(signing.notarized).toBe(true);
    expect(signing.warnings).toHaveLength(0);
    expect(signing.environment.APPLE_API_KEY).toMatch(/AuthKey\.p8$/);
  });
});

function entryFor(version: string) {
  return {
    version,
    releasedAt: "2026-08-19T09:00:00.000Z",
    signed: true,
    notarized: true,
    artifacts: [],
  };
}

/** A checkout whose `origin` is not the upstream repository. */
function forkCheckout(): string {
  return "/nonexistent-openbot-fork-checkout";
}
