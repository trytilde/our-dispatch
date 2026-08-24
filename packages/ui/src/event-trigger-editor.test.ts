import { describe, expect, it } from "vite-plus/test";
import type { SignalProvider } from "@tryopenbot/client-runtime";
import {
  eventEditorConfig,
  fieldValuesFromFilters,
  fieldValuesValid,
  filtersFromFieldValues,
  unmodeledFilters,
} from "./event-trigger-editor.js";

const github: SignalProvider = {
  type_id: "github",
  name: "GitHub",
  requires_signing_key: true,
  signal_types: [],
};

const other: SignalProvider = {
  type_id: "acme",
  name: "Acme",
  requires_signing_key: false,
  signal_types: [{ type_id: "acme.thing.happened", name: "Thing happened" }],
};

describe("eventEditorConfig", () => {
  it("curates GitHub events with one signal type per option", () => {
    const config = eventEditorConfig(github);
    const values = config.groups.flatMap((group) => group.options.map((option) => option.value));
    expect(values).toContain("github.pull_request.synchronized");
    expect(values).toContain("github.ci_check.failed");
    expect(config.fields.map((field) => field.path)).toEqual([
      "repository.full_name",
      "sender.login",
    ]);
  });

  it("falls back to catalog signal types for unknown providers", () => {
    const config = eventEditorConfig(other);
    expect(config.eventLabel).toBe("Acme event");
    expect(config.groups[0]?.options).toEqual([
      { label: "Thing happened", value: "acme.thing.happened" },
    ]);
    expect(config.fields).toEqual([]);
  });
});

describe("filtersFromFieldValues", () => {
  const fields = eventEditorConfig(github).fields;

  it("maps values to {path, value} and strips the leading @", () => {
    expect(
      filtersFromFieldValues(fields, "github.pull_request.opened", {
        "repository.full_name": "acme/web",
        "sender.login": "@octocat",
      }),
    ).toEqual([
      { path: "repository.full_name", value: "acme/web" },
      { path: "sender.login", value: "octocat" },
    ]);
  });

  it("drops blanks and the user filter on check events", () => {
    expect(
      filtersFromFieldValues(fields, "github.ci_check.failed", {
        "repository.full_name": "",
        "sender.login": "octocat",
      }),
    ).toEqual([]);
  });
});

describe("fieldValuesValid", () => {
  const fields = eventEditorConfig(github).fields;

  it("validates the owner/repo shape only when present", () => {
    expect(fieldValuesValid(fields, "github.issue.opened", {})).toBe(true);
    expect(
      fieldValuesValid(fields, "github.issue.opened", { "repository.full_name": "acme/web" }),
    ).toBe(true);
    expect(
      fieldValuesValid(fields, "github.issue.opened", { "repository.full_name": "not a repo" }),
    ).toBe(false);
  });
});

describe("fieldValuesFromFilters", () => {
  it("recovers string filter values by path", () => {
    expect(
      fieldValuesFromFilters([
        { path: "event.channel", value: "C0123456789" },
        { path: "ignored.number", value: 4 },
      ]),
    ).toEqual({ "event.channel": "C0123456789" });
  });
});

describe("unmodeledFilters", () => {
  const fields = eventEditorConfig(github).fields;

  it("keeps filters the curated editor does not model", () => {
    expect(
      unmodeledFilters(fields, [
        { path: "repository.full_name", value: "acme/web" },
        { path: "pull_request.draft", value: false },
      ]),
    ).toEqual([{ path: "pull_request.draft", value: false }]);
  });

  it("survives a round trip through an event-type change", () => {
    const stored = [
      { path: "repository.full_name", value: "acme/web" },
      { path: "pull_request.draft", value: false },
    ];
    const values = fieldValuesFromFilters(stored);
    const passThrough = unmodeledFilters(fields, stored);
    expect(
      filtersFromFieldValues(fields, "github.pull_request.reopened", values, passThrough),
    ).toEqual([
      { path: "repository.full_name", value: "acme/web" },
      { path: "pull_request.draft", value: false },
    ]);
  });
});
