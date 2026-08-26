import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useStore } from "zustand";
import { errorMessage, type SignalInstance } from "@tryopenbot/client-runtime";
import {
  connectorAuthorizedReturnUrl,
  waitForConnectorAccountActive,
  type ChatAgent,
  type PluginsCatalog as PluginsCatalogSnapshot,
} from "@tryopenbot/client-runtime";
import {
  BackIcon,
  BotSelectionDialog,
  ClockIcon,
  ConnectorSetupDialog,
  getThemePreference,
  PluginsIcon,
  PluginsCatalog,
  resolvePluginIconUrl,
  SettingsIcon,
  setThemePreference,
  type ConnectorSetupSubmit,
  SignalsIcon,
  SignalsSettings,
  type ThemePreference,
} from "@tryopenbot/ui";
import { openBotRuntime } from "../runtime.js";
import { SignalConnectContainer } from "./agent-details.js";

const settingsSections = [
  { id: "general", label: "General", icon: SettingsIcon, to: "/settings/general" },
] as const;

const pluginSections = [
  { id: "tools", label: "Tools", icon: PluginsIcon, to: "/settings/plugins/tools" },
  { id: "skills", label: "Skills", icon: SignalsIcon, to: "/settings/plugins/skills" },
  { id: "routines", label: "Routines", icon: ClockIcon, to: "/settings/plugins/routines" },
] as const;

const sections = [...settingsSections, ...pluginSections] as const;

const themeOptions: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const pageTransition = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;

export interface SettingsAppProps {
  section?: (typeof sections)[number]["id"];
}

interface SettingsContentProps {
  children: ReactNode;
  width: "constrained" | "wide";
}

function SettingsContent({ children, width }: SettingsContentProps) {
  const maxWidth = width === "wide" ? "max-w-[1280px]" : "max-w-[640px]";
  return (
    <div
      className={`${maxWidth} mx-auto w-full px-8 py-10 max-[720px]:px-[18px] max-[720px]:pt-11
        max-[720px]:pb-9`}
      data-settings-width={width}
    >
      {children}
    </div>
  );
}

function assignmentIds(current: readonly string[], agentId: string, enabled: boolean): string[] {
  return enabled ? [...new Set([...current, agentId])] : current.filter((id) => id !== agentId);
}

function updateToolAssignment(
  catalog: PluginsCatalogSnapshot,
  accountId: string,
  agentId: string,
  enabled: boolean,
): PluginsCatalogSnapshot {
  return {
    ...catalog,
    tools: catalog.tools.map((entry) => ({
      ...entry,
      accounts: entry.accounts.map((account) =>
        account.id === accountId
          ? {
              ...account,
              assigned_agent_ids: assignmentIds(account.assigned_agent_ids, agentId, enabled),
            }
          : account,
      ),
    })),
  };
}

function updateSkillAssignment(
  catalog: PluginsCatalogSnapshot,
  skillId: string,
  agentId: string,
  enabled: boolean,
): PluginsCatalogSnapshot {
  return {
    ...catalog,
    skills: catalog.skills.map((provider) => ({
      ...provider,
      skills: provider.skills.map((skill) =>
        skill.id === skillId
          ? {
              ...skill,
              assigned_agent_ids: assignmentIds(skill.assigned_agent_ids, agentId, enabled),
            }
          : skill,
      ),
    })),
  };
}

function PluginsSettings({
  agents,
  kind,
}: {
  agents: readonly ChatAgent[];
  kind: "tools" | "skills";
}) {
  const [catalog, setCatalog] = useState<PluginsCatalogSnapshot>({ tools: [], skills: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<{
    providerId: string;
    submitting: boolean;
    error?: string;
    authorizationUrl?: string;
  } | null>(null);
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  const [createdAccountPendingAgentId, setCreatedAccountPendingAgentId] = useState<string | null>(
    null,
  );
  const setupWatcher = useRef<AbortController | null>(null);
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const agentIdsKey = agentIds.join("\0");

  async function refresh(): Promise<void> {
    setError("");
    try {
      setCatalog(await openBotRuntime.client.getPluginsCatalog(agentIds));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load plugins");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void refresh();
    // Bot identity, not array identity, controls the remote snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIdsKey]);

  useEffect(
    () => () => {
      setupWatcher.current?.abort();
    },
    [],
  );

  function closeSetup(): void {
    setupWatcher.current?.abort();
    setupWatcher.current = null;
    setSetup(null);
  }

  async function mutateToolAssignment(
    accountId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const previouslyEnabled = catalog.tools.some((entry) =>
      entry.accounts.some(
        (account) => account.id === accountId && account.assigned_agent_ids.includes(agentId),
      ),
    );
    setError("");
    setCatalog((current) => updateToolAssignment(current, accountId, agentId, enabled));
    try {
      await openBotRuntime.client.setToolAccountForAgent(accountId, agentId, enabled);
      return true;
    } catch (reason) {
      setCatalog((current) => updateToolAssignment(current, accountId, agentId, previouslyEnabled));
      setError(reason instanceof Error ? reason.message : "Could not update tool");
      return false;
    }
  }

  async function updateTool(accountId: string, agentId: string, enabled: boolean): Promise<void> {
    await mutateToolAssignment(accountId, agentId, enabled);
  }

  async function deleteToolAccounts(accountIds: readonly string[]): Promise<void> {
    setError("");
    try {
      await openBotRuntime.client.deleteConnectorAccounts(accountIds);
      setCatalog((current) => ({
        ...current,
        tools: current.tools.map((entry) => ({
          ...entry,
          accounts: entry.accounts.filter((account) => !accountIds.includes(account.id)),
        })),
      }));
    } catch (reason) {
      await refresh();
      const message = reason instanceof Error ? reason.message : "Could not delete tool account";
      setError(message);
      throw new Error(message);
    }
  }

  async function assignCreatedAccount(agentId: string): Promise<void> {
    if (!createdAccountId || createdAccountPendingAgentId) return;
    setCreatedAccountPendingAgentId(agentId);
    const added = await mutateToolAssignment(createdAccountId, agentId, true);
    setCreatedAccountPendingAgentId(null);
    if (added) setCreatedAccountId(null);
  }

  async function updateSkill(skillId: string, agentId: string, enabled: boolean) {
    const previouslyEnabled = catalog.skills.some((provider) =>
      provider.skills.some(
        (skill) => skill.id === skillId && skill.assigned_agent_ids.includes(agentId),
      ),
    );
    setError("");
    setCatalog((current) => updateSkillAssignment(current, skillId, agentId, enabled));
    try {
      await openBotRuntime.client.setSkillForAgent(skillId, agentId, enabled);
    } catch (reason) {
      setCatalog((current) => updateSkillAssignment(current, skillId, agentId, previouslyEnabled));
      setError(reason instanceof Error ? reason.message : "Could not update skill");
    }
  }

  async function submitSetup(input: ConnectorSetupSubmit): Promise<void> {
    if (!setup) return;
    const current = setup;
    setSetup({ ...current, submitting: true, error: undefined });
    try {
      const result = await openBotRuntime.client.createConnectorAccount({
        providerTypeId: current.providerId,
        credentialSourceTypeId: input.credentialSourceTypeId,
        displayName: input.displayName,
        ...(input.resourceServerValues ? { resourceServerValues: input.resourceServerValues } : {}),
        ...(input.userCredentialValues ? { userCredentialValues: input.userCredentialValues } : {}),
        returnUrl: connectorAuthorizedReturnUrl(
          window.location.origin,
          navigator.userAgent.includes("Electron") ? "electron" : "web",
        ),
      });
      if (result.status === "authorize" && result.authorization_url) {
        window.open(result.authorization_url, "_blank", "noopener");
        setSetup({ ...current, submitting: false, authorizationUrl: result.authorization_url });
        setupWatcher.current?.abort();
        const watcher = new AbortController();
        setupWatcher.current = watcher;
        const active = await waitForConnectorAccountActive(openBotRuntime.client, {
          providerTypeId: current.providerId,
          accountId: result.account.id,
          signal: watcher.signal,
        });
        if (!active) return;
      }
      closeSetup();
      setCreatedAccountId(result.account.id);
      void refresh();
    } catch (reason) {
      setSetup((value) =>
        value
          ? {
              ...value,
              submitting: false,
              error: reason instanceof Error ? reason.message : "Could not add account",
            }
          : value,
      );
    }
  }

  const setupProvider = setup
    ? catalog.tools.find(({ provider }) => provider.type_id === setup.providerId)?.provider
    : undefined;
  const setupProviderIconUrl = setupProvider
    ? resolvePluginIconUrl(
        setupProvider.icon_url,
        setupProvider.icon_slug,
        setupProvider.type_id,
        setupProvider.name,
      )
    : undefined;

  return (
    <>
      <PluginsCatalog
        agents={agents.map((agent) => ({ id: agent.id, name: agent.display_name }))}
        kind={kind}
        toolProviders={catalog.tools
          .filter(({ provider }) => !provider.categories?.includes("system"))
          .map(({ provider, accounts }) => ({
            id: provider.type_id,
            name: provider.name,
            description: provider.documentation ?? "",
            categories: provider.categories ?? [],
            ...(provider.icon_url ? { iconUrl: provider.icon_url } : {}),
            ...(provider.icon_slug ? { iconKey: provider.icon_slug } : {}),
            canAddAccount: provider.can_add_account ?? true,
            accounts: accounts.map((account) => ({
              id: account.id,
              accountName: account.display_name,
              assignedAgentIds: account.assigned_agent_ids,
            })),
          }))}
        skillProviders={catalog.skills.map((provider) => ({
          id: provider.id,
          name: provider.name,
          description: provider.description,
          categories: provider.categories,
          ...(provider.icon_url ? { iconUrl: provider.icon_url } : {}),
          ...(provider.icon_key ? { iconKey: provider.icon_key } : {}),
          skills: provider.skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            assignedAgentIds: skill.assigned_agent_ids,
          })),
        }))}
        loading={loading}
        {...(error ? { error } : {})}
        onAddToolAccount={(providerId) => setSetup({ providerId, submitting: false })}
        onDeleteToolAccounts={deleteToolAccounts}
        onSetSkill={updateSkill}
        onSetToolAccount={updateTool}
      />
      {setup && setupProvider ? (
        <ConnectorSetupDialog
          providerName={setupProvider.name}
          {...(setupProviderIconUrl ? { providerIconUrl: setupProviderIconUrl } : {})}
          credentialSources={setupProvider.credential_sources.map((source) => ({
            typeId: source.type_id,
            name: source.name,
            requiresBrokering: source.requires_brokering,
            ...(source.documentation ? { documentation: source.documentation } : {}),
            supportsAutoDisplayName: source.supports_auto_display_name ?? false,
            ...(source.display_name_description
              ? { displayNameDescription: source.display_name_description }
              : {}),
            resourceServerSchema: source.resource_server_schema,
            userCredentialSchema: source.user_credential_schema,
          }))}
          submitting={setup.submitting}
          {...(setup.error ? { error: setup.error } : {})}
          {...(setup.authorizationUrl ? { authorizationUrl: setup.authorizationUrl } : {})}
          onClose={closeSetup}
          onReopenAuthorization={() => {
            if (setup.authorizationUrl) window.open(setup.authorizationUrl, "_blank", "noopener");
          }}
          onSubmit={(input) => void submitSetup(input)}
        />
      ) : null}
      <BotSelectionDialog
        agents={agents.map((agent) => ({ id: agent.id, name: agent.display_name }))}
        onClose={() => {
          if (!createdAccountPendingAgentId) setCreatedAccountId(null);
        }}
        onSelect={(agentId) => void assignCreatedAccount(agentId)}
        open={createdAccountId !== null}
        pendingAgentIds={createdAccountPendingAgentId ? [createdAccountPendingAgentId] : []}
        title="Add account to bot"
      />
    </>
  );
}

export function SettingsApp({ section = "general" }: SettingsAppProps = {}) {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const agents = useStore(openBotRuntime.store, (state) => state.sidebar.agents);
  const macDesktop = window.openbotDesktop?.platform === "mac";

  return (
    <motion.main
      animate={{ opacity: 1 }}
      className="flex h-screen w-full bg-page text-ink"
      initial={{ opacity: 0 }}
      transition={pageTransition}
    >
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-[3] h-8"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      />
      <aside
        className={`flex w-[248px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-3
          pb-3 ${macDesktop ? "pt-[42px]" : "pt-3"}`}
      >
        <button
          aria-label="Back to workspace"
          className="relative z-[4] mb-2 flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left
            text-[12.5px] font-medium text-ink-2 transition-[background-color,color] duration-150
            hover:bg-hover hover:text-ink"
          onClick={() => void navigate({ to: "/" })}
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          type="button"
        >
          <BackIcon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3]" />
          Back
        </button>
        <h1 className="px-2.5 pb-1 text-[13px] font-semibold text-ink">Settings</h1>
        {settingsSections.map((item) => {
          const Icon = item.icon;
          const selected = item.id === section;
          return (
            <button
              aria-current={selected ? "page" : undefined}
              className={`flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left
                text-[12.5px] font-medium transition-[background-color,color] duration-150
                hover:bg-hover hover:text-ink ${selected ? "bg-hover-2 text-ink" : "text-ink-2"}`}
              key={item.id}
              onClick={() => void navigate({ to: item.to })}
              type="button"
            >
              <Icon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3]" />
              {item.label}
            </button>
          );
        })}
        <h2 className="px-2.5 pt-4 pb-1 text-[13px] font-semibold text-ink">Plugins</h2>
        {pluginSections.map((item) => {
          const Icon = item.icon;
          const selected = item.id === section;
          return (
            <button
              aria-current={selected ? "page" : undefined}
              className={`flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left
                text-[12.5px] font-medium transition-[background-color,color] duration-150
                hover:bg-hover hover:text-ink ${selected ? "bg-hover-2 text-ink" : "text-ink-2"}`}
              key={item.id}
              onClick={() => void navigate({ to: item.to })}
              type="button"
            >
              <Icon className="size-4 shrink-0 fill-none stroke-current stroke-[1.3]" />
              {item.label}
            </button>
          );
        })}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {section === "tools" || section === "skills" ? (
          <SettingsContent width="wide">
            <PluginsSettings agents={agents} kind={section} />
          </SettingsContent>
        ) : section === "routines" ? (
          <SettingsContent width="constrained">
            <SignalsSettingsContainer />
          </SettingsContent>
        ) : (
          <SettingsContent width="constrained">
            <div className="flex flex-col gap-3 rounded-[12px] bg-surface p-4 shadow-hairline">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[13px] font-medium text-ink">Appearance</h3>
                <p className="text-[12.5px] text-ink-3">
                  Follow the operating system or pin a single theme.
                </p>
              </div>
              <div className="flex gap-1.5">
                {themeOptions.map((option) => (
                  <button
                    aria-pressed={theme === option.value}
                    className={`h-8 rounded-control px-3 text-[12.5px] font-medium
                    transition-[background-color,color] duration-150 hover:bg-hover
                    ${theme === option.value ? "bg-hover-2 text-ink" : "text-ink-2"}`}
                    key={option.value}
                    onClick={() => {
                      setThemePreference(option.value);
                      setTheme(option.value);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </SettingsContent>
        )}
      </section>
    </motion.main>
  );
}

function SignalsSettingsContainer() {
  const signals = useStore(openBotRuntime.store, (state) => state.signals);
  const [connectProviderId, setConnectProviderId] = useState("");
  const [rowNotices, setRowNotices] = useState<
    Record<string, { text: string; tone: "success" | "danger" }>
  >({});
  const noticeTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    void openBotRuntime.actions.refreshSignalProviders().catch(() => undefined);
    void openBotRuntime.actions.refreshSignalInstances().catch(() => undefined);
  }, []);

  const timers = noticeTimersRef.current;
  useEffect(
    () => () => {
      for (const timer of Object.values(timers)) window.clearTimeout(timer);
    },
    [timers],
  );

  function notice(instanceId: string, text: string, tone: "success" | "danger"): void {
    setRowNotices((current) => ({ ...current, [instanceId]: { text, tone } }));
    window.clearTimeout(timers[instanceId]);
    timers[instanceId] = window.setTimeout(() => {
      delete timers[instanceId];
      setRowNotices((current) => {
        const { [instanceId]: _dropped, ...rest } = current;
        return rest;
      });
    }, 4000);
  }

  async function withNotice(
    instance: SignalInstance,
    operation: () => Promise<void>,
    successText?: string,
  ): Promise<void> {
    try {
      await operation();
      if (successText) notice(instance.id, successText, "success");
    } catch (reason) {
      notice(instance.id, errorMessage(reason), "danger");
    }
  }

  return (
    <>
      <SignalsSettings
        deliveriesByInstanceId={signals.deliveriesByInstanceId}
        error={signals.error || undefined}
        instances={signals.instances}
        onConnectProvider={setConnectProviderId}
        onDeleteInstance={(instance) =>
          void withNotice(instance, () => openBotRuntime.actions.deleteSignalInstance(instance.id))
        }
        onRotateSigningKey={(instance, signingSecret) =>
          void withNotice(
            instance,
            async () => {
              await openBotRuntime.actions.updateSignalInstance(instance.id, { signingSecret });
            },
            "Signing key rotated",
          )
        }
        onTestInstance={(instance) =>
          void withNotice(
            instance,
            async () => {
              await openBotRuntime.actions.testSignalInstance(instance.id);
            },
            "Test delivered",
          )
        }
        onToggleInstance={(instance, enabled) =>
          void withNotice(instance, async () => {
            await openBotRuntime.actions.updateSignalInstance(instance.id, {
              status: enabled ? "enabled" : "disabled",
            });
          })
        }
        onViewDeliveries={(instanceId) =>
          void openBotRuntime.actions.refreshSignalDeliveries(instanceId).catch(() => undefined)
        }
        providers={signals.providers}
        rowNotices={rowNotices}
        settled={signals.status === "ready" || signals.status === "error"}
      />
      {connectProviderId ? (
        <SignalConnectContainer
          onClose={() => setConnectProviderId("")}
          providerTypeId={connectProviderId}
        />
      ) : null}
    </>
  );
}

export function SettingsGeneralApp() {
  return <SettingsApp section="general" />;
}

export function SettingsPluginsApp() {
  return <SettingsApp section="tools" />;
}

export function SettingsSignalsApp() {
  return <SettingsApp section="routines" />;
}

export function SettingsToolsApp() {
  return <SettingsApp section="tools" />;
}

export function SettingsSkillsApp() {
  return <SettingsApp section="skills" />;
}

export function SettingsRoutinesApp() {
  return <SettingsApp section="routines" />;
}
