import { useState } from "react";
import type {
  RoutineTriggerFilter,
  SignalInstance,
  SignalProvider,
} from "@tryopenbot/client-runtime";
import { SelectField, type SelectOption } from "./primitive-components.js";

/**
 * Event trigger fields: one signal type per trigger plus provider-specific
 * exact-equality filters mapped to `[{ path, value }]`. The mapping helpers
 * are pure and exported for tests.
 */

export interface EventFilterField {
  path: string;
  /** Inline connector word rendered before the input ("in", "from"). */
  connector: string;
  ariaLabel: string;
  placeholder: string;
  helper?: string;
  pattern?: RegExp;
  normalize?: (value: string) => string;
  appliesTo?: (signalType: string) => boolean;
}

export interface EventOptionGroup {
  label?: string;
  options: SelectOption[];
}

export interface EventEditorConfig {
  eventLabel: string;
  groups: EventOptionGroup[];
  fields: EventFilterField[];
}

const githubConfig: EventEditorConfig = {
  eventLabel: "GitHub event",
  groups: [
    {
      label: "Issue",
      options: [
        { label: "Opened", value: "github.issue.opened" },
        { label: "Reopened", value: "github.issue.reopened" },
        { label: "Closed", value: "github.issue.closed" },
        { label: "Edited", value: "github.issue.edited" },
        { label: "Labeled", value: "github.issue.labeled" },
      ],
    },
    {
      label: "Pull request",
      options: [
        { label: "Opened", value: "github.pull_request.opened" },
        { label: "Reopened", value: "github.pull_request.reopened" },
        { label: "Merged", value: "github.pull_request.merged" },
        { label: "Closed", value: "github.pull_request.closed" },
        { label: "Updated", value: "github.pull_request.synchronized" },
        { label: "Ready for review", value: "github.pull_request.ready_for_review" },
        { label: "Converted to draft", value: "github.pull_request.converted_to_draft" },
      ],
    },
    {
      label: "Checks",
      options: [
        { label: "CI passed", value: "github.ci_check.passed" },
        { label: "CI failed", value: "github.ci_check.failed" },
      ],
    },
  ],
  fields: [
    {
      path: "repository.full_name",
      connector: "in",
      ariaLabel: "Repository",
      placeholder: "owner/repo",
      pattern: /^[^\s/]+\/[^\s/]+$/,
    },
    {
      path: "sender.login",
      connector: "from",
      ariaLabel: "User",
      placeholder: "Anyone",
      normalize: (value) => value.replace(/^@/, ""),
      appliesTo: (signalType) => !signalType.startsWith("github.ci_check."),
    },
  ],
};

const slackConfig: EventEditorConfig = {
  eventLabel: "Slack event",
  groups: [
    {
      options: [
        { label: "Bot is mentioned", value: "slack.app_mention" },
        { label: "New messages", value: "slack.message.posted" },
      ],
    },
  ],
  fields: [
    {
      path: "event.channel",
      connector: "in",
      ariaLabel: "Slack channel",
      placeholder: "Channel ID",
      helper: "The channel ID, like C0123456789",
    },
  ],
};

const sentryConfig: EventEditorConfig = {
  eventLabel: "Sentry event",
  groups: [
    {
      options: [
        { label: "Created", value: "sentry.issue.created" },
        { label: "Assigned", value: "sentry.issue.assigned" },
        { label: "Resolved", value: "sentry.issue.resolved" },
        { label: "Unresolved", value: "sentry.issue.unresolved" },
        { label: "Archived", value: "sentry.issue.ignored" },
      ],
    },
  ],
  fields: [
    {
      path: "data.project.slug",
      connector: "in project",
      ariaLabel: "Project slug",
      placeholder: "All projects",
    },
  ],
};

const firecrawlConfig: EventEditorConfig = {
  eventLabel: "Firecrawl event",
  groups: [
    {
      options: [
        { label: "Page changed", value: "firecrawl.monitor.page.changed" },
        { label: "Page added", value: "firecrawl.monitor.page.new" },
        { label: "Page removed", value: "firecrawl.monitor.page.removed" },
        { label: "Page unchanged", value: "firecrawl.monitor.page.same" },
        { label: "Page error", value: "firecrawl.monitor.page.error" },
        { label: "Check completed", value: "firecrawl.monitor.check.completed" },
      ],
    },
  ],
  fields: [
    {
      path: "monitor.id",
      connector: "for monitor",
      ariaLabel: "Monitor ID",
      placeholder: "All monitors",
    },
  ],
};

/** Editor configuration for a provider: known providers get curated events and filters. */
export function eventEditorConfig(provider: SignalProvider): EventEditorConfig {
  switch (provider.type_id) {
    case "github":
      return githubConfig;
    case "slack":
      return slackConfig;
    case "sentry":
      return sentryConfig;
    case "firecrawl":
      return firecrawlConfig;
    default:
      return {
        eventLabel: `${provider.name} event`,
        groups: [
          {
            options: provider.signal_types.map((signalType) => ({
              label: signalType.name,
              value: signalType.type_id,
            })),
          },
        ],
        fields: [],
      };
  }
}

/**
 * Keep a signal type that the curated lists omit selectable, so a rule authored
 * against any upstream event stays editable.
 */
export function configWithSignalType(
  config: EventEditorConfig,
  provider: SignalProvider,
  signalType: string,
): EventEditorConfig {
  if (!signalType) return config;
  const known = config.groups.some((group) =>
    group.options.some((option) => option.value === signalType),
  );
  if (known) return config;
  const label =
    provider.signal_types.find((candidate) => candidate.type_id === signalType)?.name ?? signalType;
  return {
    ...config,
    groups: [...config.groups, { label: "Other", options: [{ label, value: signalType }] }],
  };
}

/** Fields that apply to a signal type (checks events drop the user filter). */
export function applicableFilterFields(
  fields: readonly EventFilterField[],
  signalType: string,
): EventFilterField[] {
  return fields.filter((field) => field.appliesTo?.(signalType) ?? true);
}

/**
 * Map field input values to exact-equality trigger filters, dropping blanks.
 * `passThrough` filters are appended unchanged so an edit never deletes a
 * filter this editor does not model.
 */
export function filtersFromFieldValues(
  fields: readonly EventFilterField[],
  signalType: string,
  values: Record<string, string>,
  passThrough: readonly RoutineTriggerFilter[] = [],
): RoutineTriggerFilter[] {
  const curated = applicableFilterFields(fields, signalType).flatMap((field) => {
    const raw = (values[field.path] ?? "").trim();
    const value = field.normalize ? field.normalize(raw) : raw;
    if (!value) return [];
    return [{ path: field.path, value }];
  });
  return [...curated, ...passThrough];
}

/** Stored filters the curated fields do not model, preserved verbatim across edits. */
export function unmodeledFilters(
  fields: readonly EventFilterField[],
  filters: readonly RoutineTriggerFilter[] | undefined,
): RoutineTriggerFilter[] {
  const modeled = new Set(fields.map((field) => field.path));
  return (filters ?? []).filter(
    (filter) => !(modeled.has(filter.path) && typeof filter.value === "string"),
  );
}

/** Recover field input values from stored trigger filters. */
export function fieldValuesFromFilters(
  filters: readonly RoutineTriggerFilter[] | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const filter of filters ?? []) {
    if (typeof filter.value === "string") values[filter.path] = filter.value;
  }
  return values;
}

/** True when every non-empty field value passes its validation pattern. */
export function fieldValuesValid(
  fields: readonly EventFilterField[],
  signalType: string,
  values: Record<string, string>,
): boolean {
  return applicableFilterFields(fields, signalType).every((field) => {
    const raw = (values[field.path] ?? "").trim();
    const value = field.normalize ? field.normalize(raw) : raw;
    return !value || !field.pattern || field.pattern.test(value);
  });
}

export interface EventTriggerValue {
  instanceId: string;
  signalType: string;
  filters: RoutineTriggerFilter[];
}

export interface EventTriggerEditorProps {
  provider: SignalProvider;
  /** Enabled instances for this provider. */
  instances: readonly SignalInstance[];
  value: EventTriggerValue;
  onChange: (value: EventTriggerValue, valid: boolean) => void;
}

export function EventTriggerEditor({
  provider,
  instances,
  value,
  onChange,
}: EventTriggerEditorProps) {
  const config = configWithSignalType(eventEditorConfig(provider), provider, value.signalType);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    fieldValuesFromFilters(value.filters),
  );
  const [passThrough] = useState<RoutineTriggerFilter[]>(() =>
    unmodeledFilters(config.fields, value.filters),
  );

  function emit(signalType: string, instanceId: string, values: Record<string, string>): void {
    onChange(
      {
        instanceId,
        signalType,
        filters: filtersFromFieldValues(config.fields, signalType, values, passThrough),
      },
      fieldValuesValid(config.fields, signalType, values),
    );
  }

  const activeFields = applicableFilterFields(config.fields, value.signalType);
  const helpers = activeFields.map((field) => field.helper).filter(Boolean);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="ob-select-label">
          <span className="ob-select-trigger">
            <select
              aria-label={config.eventLabel}
              onChange={(event) => emit(event.target.value, value.instanceId, fieldValues)}
              value={value.signalType}
            >
              {config.groups.map((group, index) =>
                group.label ? (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  group.options.map((option) => (
                    <option key={`${index}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))
                ),
              )}
            </select>
            <span aria-hidden="true" className="ob-select-icon">
              ⌄
            </span>
          </span>
        </label>
        {activeFields.map((field) => {
          const raw = fieldValues[field.path] ?? "";
          const normalized = field.normalize ? field.normalize(raw.trim()) : raw.trim();
          const invalid = Boolean(normalized && field.pattern && !field.pattern.test(normalized));
          return (
            <span className="flex items-center gap-2" key={field.path}>
              <span className="text-[12.5px] text-ink-3">{field.connector}</span>
              <input
                aria-invalid={invalid || undefined}
                aria-label={field.ariaLabel}
                className="h-8 w-[150px] rounded-control border border-line-strong bg-transparent px-2.5
                  text-[12.5px] text-ink outline-none placeholder:text-ink-3
                  focus-visible:border-accent aria-invalid:border-red"
                onChange={(event) => {
                  const values = { ...fieldValues, [field.path]: event.target.value };
                  setFieldValues(values);
                  emit(value.signalType, value.instanceId, values);
                }}
                placeholder={field.placeholder}
                spellCheck={false}
                value={raw}
              />
            </span>
          );
        })}
        {instances.length > 1 ? (
          <>
            <span className="text-[12.5px] text-ink-3">via</span>
            <SelectField
              ariaLabel="Connection"
              onChange={(event) => emit(value.signalType, event.target.value, fieldValues)}
              options={instances.map((instance) => ({
                label: instance.display_name,
                value: instance.id,
              }))}
              value={value.instanceId}
            />
          </>
        ) : null}
      </div>
      {helpers.map((helper) => (
        <p className="text-[11.5px] text-ink-3" key={helper}>
          {helper}
        </p>
      ))}
    </div>
  );
}
