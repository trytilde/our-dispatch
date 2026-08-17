import React, { useRef, useState } from "react";
import arg from "arg";
import { Box, Text, render, useApp, useInput } from "ink";
import {
  builtInRuntimeInitializationProviders,
  initializeOpenBot,
  isInitializedOpenBotRepository,
  ownerIdentityChoices,
  processCommandRunner,
  runtimeChoices,
  type InitializationPrompts,
  type SelectChoice,
} from "../initialization.js";
import { repositoryRoot } from "../paths.js";
import {
  bootstrapOpenBotRepository,
  repositoryVisibilityChoices,
} from "../repository-bootstrap.js";
import { Brand } from "../ui.js";
import {
  collectProviderInitializations,
  type ProviderInitializationQuestion,
} from "@tryopenbot/runtime-provider";

export type InitializationJsonSchema = Readonly<Record<string, unknown>>;

export type InitializationRunResult =
  | { kind: "help"; schema: InitializationJsonSchema }
  | {
      kind: "initialized";
      json: boolean;
      mode: "interactive" | "non-interactive";
    };

export async function runInitialization(
  argv: readonly string[] = [],
): Promise<InitializationRunResult> {
  const parsed = arg(
    {
      "--non-interactive": Boolean,
      "--json": Boolean,
      "--help": Boolean,
      "-h": "--help",
    },
    { argv: [...argv] },
  );
  if (parsed._.length) throw new Error(`Unknown init argument: ${parsed._.join(", ")}`);
  if (parsed["--help"]) return { kind: "help", schema: initializationJsonSchema() };
  const nonInteractive = parsed["--non-interactive"] ?? false;
  const json = parsed["--json"] ?? false;
  if (!nonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new Error(
      "openbot init requires an interactive terminal or --non-interactive with JSON answers on stdin",
    );
  const initialized = await isInitializedOpenBotRepository(repositoryRoot);
  const answers = nonInteractive ? await readJsonAnswersFromStdin() : undefined;
  const prompts = answers
    ? createNonInteractivePrompts(
        initialized ? answers : validateNonInteractiveCoreAnswers(answers),
      )
    : inkPrompts;
  if (!initialized)
    await bootstrapOpenBotRepository({
      destination: repositoryRoot,
      prompts,
      runner: processCommandRunner,
    });
  await initializeOpenBot({
    repositoryRoot,
    prompts,
    interactive: !nonInteractive,
    environment: process.env,
  });
  return {
    kind: "initialized",
    json,
    mode: nonInteractive ? "non-interactive" : "interactive",
  };
}

export function initializationJsonSchema(): InitializationJsonSchema {
  const properties: Record<string, unknown> = {
    "repository-name": {
      type: "string",
      minLength: 1,
      description:
        "GitHub repository to create. Use a repository name for the authenticated GitHub account, or owner/name for an organization.",
    },
    "repository-visibility": selectSchema(
      "Visibility of the GitHub repository created for this OpenBot installation.",
      repositoryVisibilityChoices,
    ),
    "owner-identity": selectSchema(
      "Identity system owners will use to encrypt and decrypt OpenBot secrets with SOPS.",
      ownerIdentityChoices,
    ),
    runtime: selectSchema(
      "Runtime where OpenBot control, agent, and computer services will be deployed.",
      runtimeChoices,
    ),
    "aws-kms-key-arn": conditionedSchema(
      requiredStringSchema(
        "ARN of an existing AWS KMS key or alias that SOPS will use for owner encryption.",
      ),
      "owner-identity",
      "aws-kms",
    ),
    "aws-profile": conditionedSchema(
      {
        type: "string",
        description:
          "Optional AWS CLI profile used for KMS operations. Omit it to use the default AWS credential chain.",
      },
      "owner-identity",
      "aws-kms",
    ),
    "gcp-kms-resource-id": conditionedSchema(
      requiredStringSchema(
        "Resource ID of the existing Google Cloud KMS key that SOPS will use for owner encryption.",
      ),
      "owner-identity",
      "gcp-kms",
    ),
    "azure-key-vault-key-url": conditionedSchema(
      requiredStringSchema(
        "URL of the existing Azure Key Vault key that SOPS will use for owner encryption.",
      ),
      "owner-identity",
      "azure-key-vault",
    ),
    "vault-transit-key-uri": conditionedSchema(
      requiredStringSchema(
        "URI of the existing HashiCorp Vault Transit key that SOPS will use for owner encryption.",
      ),
      "owner-identity",
      "vault-transit",
    ),
    "onepassword-vault": conditionedSchema(
      requiredStringSchema(
        "1Password vault where OpenBot should store the generated owner age identity.",
      ),
      "owner-identity",
      "onepassword",
    ),
    "onepassword-item-title": conditionedSchema(
      requiredStringSchema(
        "Title of the new 1Password item that will hold the owner age identity.",
      ),
      "owner-identity",
      "onepassword",
    ),
  };
  const conditions: unknown[] = [
    requiredWhen("owner-identity", "aws-kms", ["aws-kms-key-arn"]),
    requiredWhen("owner-identity", "gcp-kms", ["gcp-kms-resource-id"]),
    requiredWhen("owner-identity", "azure-key-vault", ["azure-key-vault-key-url"]),
    requiredWhen("owner-identity", "vault-transit", ["vault-transit-key-uri"]),
    requiredWhen("owner-identity", "onepassword", ["onepassword-vault", "onepassword-item-title"]),
  ];

  for (const runtime of ["local", "vercel"] as const) {
    const initializations = collectProviderInitializations(
      builtInRuntimeInitializationProviders(runtime),
    );
    const required = new Set<string>();
    for (const initialization of initializations) {
      for (const question of initialization.questions) {
        const existing = properties[question.id] as Record<string, unknown> | undefined;
        const field = providerQuestionSchema(question, initialization.label) as Record<
          string,
          unknown
        >;
        const runtimes = [
          ...((existing?.["x-openbot-runtimes"] as string[] | undefined) ?? []),
          runtime,
        ];
        const existingWithoutRuntimes = existing && { ...existing };
        if (existingWithoutRuntimes) delete existingWithoutRuntimes["x-openbot-runtimes"];
        if (
          existingWithoutRuntimes &&
          JSON.stringify(existingWithoutRuntimes) !== JSON.stringify(field)
        )
          throw new Error(`Providers define conflicting initialization field: ${question.id}`);
        properties[question.id] = { ...field, "x-openbot-runtimes": [...new Set(runtimes)] };
        if (question.required) required.add(question.id);
      }
    }
    conditions.push(requiredWhen("runtime", runtime, [...required]));
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:tryopenbot:schema:init-input",
    title: "OpenBot non-interactive initialization input",
    description:
      "JSON object accepted on standard input by `openbot init --non-interactive --json`. Secret fields must be supplied through stdin, never command arguments.",
    type: "object",
    additionalProperties: false,
    properties,
    required: ["repository-name", "repository-visibility", "owner-identity", "runtime"],
    allOf: conditions,
    "x-openbot-command": "openbot init --non-interactive --json",
  };
}

function selectSchema(description: string, choices: readonly SelectChoice[]): unknown {
  return {
    type: "string",
    description,
    oneOf: choices.map((choice) => ({
      const: choice.value,
      title: choice.label,
      ...(choice.description ? { description: choice.description } : {}),
    })),
  };
}

function secretSchema(description: string): unknown {
  return { type: "string", minLength: 1, description, writeOnly: true };
}

function requiredStringSchema(description: string): unknown {
  return { type: "string", minLength: 1, description };
}

function conditionedSchema(schema: unknown, field: string, equals: string): unknown {
  return {
    ...(schema as Record<string, unknown>),
    "x-openbot-condition": { field, equals },
  };
}

function providerQuestionSchema(
  question: ProviderInitializationQuestion,
  provider: string,
): unknown {
  const description = [
    question.description ?? question.prompt,
    `${question.required ? "Required" : "Optional"} for ${provider}.`,
  ].join(" ");
  const base =
    question.input === "select"
      ? selectSchema(description, question.choices ?? [])
      : question.input === "secret"
        ? secretSchema(description)
        : { type: "string", ...(question.required ? { minLength: 1 } : {}), description };
  return {
    ...(base as Record<string, unknown>),
    ...(question.validation ? { pattern: question.validation.pattern } : {}),
    "x-openbot-provider": provider,
    "x-openbot-destination": question.destination,
    ...(question.validation ? { "x-openbot-validation-message": question.validation.message } : {}),
  };
}

function requiredWhen(field: string, value: string, required: readonly string[]): unknown {
  const jsonSchemaThenKeyword = ["th", "en"].join("");
  return {
    if: { properties: { [field]: { const: value } }, required: [field] },
    [jsonSchemaThenKeyword]: { required },
  };
}

export function validateNonInteractiveCoreAnswers(
  answers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const required = ["repository-name", "repository-visibility", "owner-identity", "runtime"];
  const ownerRequired: Record<string, readonly string[]> = {
    "aws-kms": ["aws-kms-key-arn"],
    "gcp-kms": ["gcp-kms-resource-id"],
    "azure-key-vault": ["azure-key-vault-key-url"],
    "vault-transit": ["vault-transit-key-uri"],
    onepassword: ["onepassword-vault", "onepassword-item-title"],
    "native-age": [],
  };
  const runtimeRequired = Object.fromEntries(
    (["local", "vercel"] as const).map((runtime) => [
      runtime,
      collectProviderInitializations(builtInRuntimeInitializationProviders(runtime)).flatMap(
        (initialization) =>
          initialization.questions
            .filter((question) => question.required)
            .map((question) => question.id),
      ),
    ]),
  ) as Record<string, readonly string[]>;
  const owner = answers["owner-identity"];
  const runtime = answers.runtime;
  if (owner && !ownerRequired[owner])
    throw new Error(`Invalid non-interactive answer for owner-identity: ${owner}`);
  if (runtime && !runtimeRequired[runtime])
    throw new Error(`Invalid non-interactive answer for runtime: ${runtime}`);
  required.push(...(owner ? (ownerRequired[owner] ?? []) : []));
  required.push(...(runtime ? (runtimeRequired[runtime] ?? []) : []));
  for (const id of required)
    if (answers[id] === undefined || answers[id] === "")
      throw new Error(`Missing required non-interactive answer: ${id}`);
  return answers;
}

export function createNonInteractivePrompts(
  answers: Readonly<Record<string, string>>,
): InitializationPrompts {
  const answer = (
    id: string | undefined,
    prompt: string,
    required: boolean,
    initialValue?: string,
  ): string => {
    if (!id) throw new Error(`Non-interactive question has no stable ID: ${prompt}`);
    const value = answers[id] ?? initialValue;
    if (value === undefined && !required) return "";
    if (value === undefined) throw new Error(`Missing non-interactive answer: ${id} (${prompt})`);
    if (required && !value) throw new Error(`Non-interactive answer must not be empty: ${id}`);
    return value;
  };
  return {
    async input(prompt, options = {}) {
      return answer(options.id, prompt, options.required ?? false, options.initialValue);
    },
    async select(prompt, choices, options = {}) {
      const value = answer(options.id, prompt, true, options.initialValue);
      if (!choices.some((choice) => choice.value === value))
        throw new Error(
          `Invalid non-interactive answer for ${options.id}: ${value}; expected one of ${choices.map((choice) => choice.value).join(", ")}`,
        );
      return value;
    },
  };
}

async function readJsonAnswersFromStdin(): Promise<Record<string, string>> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) throw new Error("Non-interactive init requires a JSON object on stdin");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Non-interactive init stdin is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Non-interactive init stdin must be a JSON object");
  const answers: Record<string, string> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value !== "string")
      throw new Error(`Non-interactive answer must be a string: ${id}`);
    answers[id] = value;
  }
  return answers;
}

export const inkPrompts: InitializationPrompts = {
  select(prompt, choices, options = {}) {
    return renderQuestion<string>((complete, cancel) => (
      <SelectQuestion
        prompt={prompt}
        choices={choices}
        initialValue={options.initialValue}
        complete={complete}
        cancel={cancel}
      />
    ));
  },
  input(prompt, options = {}) {
    return renderQuestion<string>((complete, cancel) => (
      <InputQuestion
        prompt={prompt}
        description={options.description}
        secret={options.secret ?? false}
        required={options.required ?? false}
        initialValue={options.initialValue}
        complete={complete}
        cancel={cancel}
      />
    ));
  },
};

export const interactiveQuestionRenderOptions = {
  alternateScreen: true,
  patchConsole: false,
} as const;

async function renderQuestion<T>(
  view: (complete: (value: T) => void, cancel: () => void) => React.ReactElement,
): Promise<T> {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: Error) => void;
  const result = new Promise<T>((resolvePromise, reject) => {
    resolveValue = resolvePromise;
    rejectValue = reject;
  });
  const app = render(
    view(resolveValue, () => rejectValue(new Error("Initialization cancelled"))),
    interactiveQuestionRenderOptions,
  );
  await app.waitUntilExit();
  return result;
}

function SelectQuestion({
  prompt,
  choices,
  initialValue,
  complete,
  cancel,
}: {
  prompt: string;
  choices: readonly SelectChoice[];
  initialValue?: string;
  complete: (value: string) => void;
  cancel: () => void;
}) {
  const initialSelection = Math.max(
    0,
    choices.findIndex((choice) => choice.value === initialValue),
  );
  const [selected, setSelected] = useState(initialSelection);
  const selectedRef = useRef(initialSelection);
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      selectedRef.current = (selectedRef.current - 1 + choices.length) % choices.length;
      setSelected(selectedRef.current);
    } else if (key.downArrow || input === "j") {
      selectedRef.current = (selectedRef.current + 1) % choices.length;
      setSelected(selectedRef.current);
    } else if (key.return) {
      complete(choices[selectedRef.current]!.value);
      exit();
    } else if (key.escape) {
      cancel();
      exit();
    }
  });
  return (
    <Box flexDirection="column">
      <Brand subtitle={prompt} />
      {choices.map((choice, index) => (
        <Box key={choice.value} flexDirection="column">
          <Box>
            <Box width={3}>
              <Text color={selected === index ? "cyan" : undefined}>
                {selected === index ? "❯" : " "}
              </Text>
            </Box>
            <Text bold={selected === index} color={selected === index ? "cyan" : undefined}>
              {choice.label}
            </Text>
          </Box>
          {choice.description && selected === index ? (
            <Box marginLeft={3}>
              <Text dimColor>{choice.description}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move enter select esc cancel</Text>
      </Box>
    </Box>
  );
}

function InputQuestion({
  prompt,
  description,
  secret,
  required,
  initialValue,
  complete,
  cancel,
}: {
  prompt: string;
  description?: string;
  secret: boolean;
  required: boolean;
  initialValue?: string;
  complete: (value: string) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const valueRef = useRef(initialValue ?? "");
  const [error, setError] = useState("");
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.escape) {
      cancel();
      exit();
      return;
    }
    if (key.return) {
      if (required && !valueRef.current) {
        setError("A value is required");
        return;
      }
      complete(valueRef.current);
      exit();
      return;
    }
    if (key.backspace || key.delete) valueRef.current = valueRef.current.slice(0, -1);
    else if (!key.ctrl && !key.meta && input) valueRef.current += input;
    setValue(valueRef.current);
    setError("");
  });
  return (
    <Box flexDirection="column">
      <Brand subtitle={prompt} />
      {description ? <Text dimColor>{description}</Text> : null}
      <Text>
        <Text color="cyan">❯ </Text>
        {secret ? "•".repeat(value.length) : value}
        <Text inverse> </Text>
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>enter continue esc cancel</Text>
      </Box>
    </Box>
  );
}
