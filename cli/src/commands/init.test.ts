import { describe, expect, it } from "vite-plus/test";
import {
  createNonInteractivePrompts,
  initializationJsonSchema,
  interactiveQuestionRenderOptions,
  runInitialization,
  validateNonInteractiveCoreAnswers,
} from "./init.js";

describe("non-interactive initialization prompts", () => {
  it("renders each interactive question in a clean full-screen terminal", () => {
    expect(interactiveQuestionRenderOptions).toEqual({
      alternateScreen: true,
      patchConsole: false,
    });
  });

  it("answers stable input and selection IDs", async () => {
    const prompts = createNonInteractivePrompts({
      "repository-name": "agent-openbot",
      "repository-visibility": "private",
    });

    await expect(
      prompts.input("GitHub repository name", { id: "repository-name", required: true }),
    ).resolves.toBe("agent-openbot");
    await expect(
      prompts.select(
        "GitHub repository visibility",
        [
          { value: "private", label: "Private" },
          { value: "public", label: "Public" },
        ],
        { id: "repository-visibility" },
      ),
    ).resolves.toBe("private");
  });

  it("reports a missing answer by stable ID", async () => {
    const prompts = createNonInteractivePrompts({});
    await expect(
      prompts.input("AWS KMS key ARN", { id: "aws-kms-key-arn", required: true }),
    ).rejects.toThrow("Missing non-interactive answer: aws-kms-key-arn");
  });

  it("uses stored defaults when non-interactive rerun answers are omitted", async () => {
    const prompts = createNonInteractivePrompts({ "tilde-org-id": "updated-org" });

    await expect(
      prompts.input("Tilde API key", {
        id: "tilde-api-key",
        required: true,
        secret: true,
        initialValue: "stored-secret",
      }),
    ).resolves.toBe("stored-secret");
    await expect(
      prompts.input("Tilde organization", {
        id: "tilde-org-id",
        required: true,
        initialValue: "stored-org",
      }),
    ).resolves.toBe("updated-org");
    await expect(
      prompts.select(
        "Runtime",
        [
          { value: "local", label: "Local" },
          { value: "vercel", label: "Vercel" },
        ],
        { id: "runtime", initialValue: "vercel" },
      ),
    ).resolves.toBe("vercel");
  });

  it("rejects invalid select values with allowed values", async () => {
    const prompts = createNonInteractivePrompts({ runtime: "cloud" });
    await expect(
      prompts.select(
        "Runtime",
        [
          { value: "local", label: "Local" },
          { value: "vercel", label: "Vercel" },
        ],
        { id: "runtime" },
      ),
    ).rejects.toThrow("expected one of local, vercel");
  });

  it("validates all Vercel inputs before repository bootstrap can mutate", () => {
    expect(() =>
      validateNonInteractiveCoreAnswers({
        "repository-name": "agent-openbot",
        "repository-visibility": "private",
        "owner-identity": "aws-kms",
        "aws-kms-key-arn": "arn:aws:kms:us-east-1:123:key/test",
        "aws-profile": "admin",
        runtime: "vercel",
      }),
    ).toThrow("Missing required non-interactive answer: vercel-token");
  });

  it("publishes a described JSON schema with provider-defined questions", () => {
    const schema = initializationJsonSchema() as {
      properties: Record<string, Record<string, unknown>>;
      allOf: unknown[];
    };

    expect(schema.properties["repository-name"]?.description).toContain("GitHub repository");
    expect(schema.properties["owner-identity"]?.description).toContain("SOPS");
    expect(schema.properties["vercel-token"]?.description).toContain("Required for Vercel");
    expect(schema.properties["vercel-token"]?.["x-openbot-provider"]).toBe("Vercel");
    expect(schema.properties["vercel-token"]?.["x-openbot-runtimes"]).toEqual(["local", "vercel"]);
    expect(schema.properties["vercel-token"]?.writeOnly).toBe(true);
    expect(schema.properties["vercel-agent-project"]?.description).toBeTruthy();
    expect(schema.properties["tilde-api-key"]?.["x-openbot-provider"]).toBe("Tilde");
    expect(schema.properties["tilde-api-key"]?.["x-openbot-runtimes"]).toEqual(["local", "vercel"]);
    for (const [field, definition] of Object.entries(schema.properties))
      expect(definition.description, `${field} must have a description`).toEqual(
        expect.any(String),
      );
    const vercelRule = schema.allOf.find(
      (rule) =>
        (rule as { if?: { properties?: { runtime?: { const?: string } } } }).if?.properties?.runtime
          ?.const === "vercel",
    ) as { then?: { required?: string[] } } | undefined;
    expect(vercelRule?.then?.required).toEqual([
      "vercel-token",
      "vercel-control-project",
      "vercel-agent-project",
      "tilde-api-key",
      "tilde-org-id",
      "tilde-team-id",
      "openbot-deployment-name",
      "vercel-ai-gateway-api-key-name",
    ]);
  });

  it("returns the schema for init help without requiring a terminal", async () => {
    await expect(runInitialization(["--help"])).resolves.toMatchObject({
      kind: "help",
      schema: { type: "object" },
    });
  });
});
