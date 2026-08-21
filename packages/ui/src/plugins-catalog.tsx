import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDownIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { AgentAvatar } from "./agent-avatar.js";
import { Avatar, AvatarGroup, AvatarGroupCount } from "./components/ui/avatar.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";

export interface PluginsCatalogAgent {
  id: string;
  name: string;
}

export interface PluginsCatalogProps {
  agents: readonly PluginsCatalogAgent[];
}

type CatalogKind = "tools" | "skills";

interface ToolProvider {
  id: string;
  name: string;
  description: string;
  mark: string;
  color: string;
}

interface ToolConnection {
  id: string;
  providerId: string;
  accountName: string;
}

interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  mark: string;
  color: string;
}

interface AssignmentTarget {
  kind: CatalogKind;
  id: string;
  providerId?: string;
}

const toolProviders: readonly ToolProvider[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Issues, pull requests, repositories, and code search.",
    mark: "GH",
    color: "#24292f",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Find and work with files across shared drives.",
    mark: "GD",
    color: "#2f7cf6",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search channels and coordinate with your team.",
    mark: "SL",
    color: "#8c4a91",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Plan work, update issues, and follow projects.",
    mark: "LI",
    color: "#5e6ad2",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read and update team docs and databases.",
    mark: "NO",
    color: "#3d3d3d",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Inspect production errors, traces, and releases.",
    mark: "SE",
    color: "#6f4ca5",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Inspect designs, components, and design variables.",
    mark: "FI",
    color: "#e64f3d",
  },
  {
    id: "browser",
    name: "Browser",
    description: "Open pages and interact with web applications.",
    mark: "BR",
    color: "#1084fe",
  },
];

const skillDefinitions: readonly SkillDefinition[] = [
  {
    id: "code-review",
    name: "Code review",
    description: "Review changes for correctness, clarity, and risk.",
    mark: "CR",
    color: "#315fdd",
  },
  {
    id: "frontend-design",
    name: "Frontend design",
    description: "Shape distinctive interfaces and interaction systems.",
    mark: "FD",
    color: "#d45b7c",
  },
  {
    id: "browser-qa",
    name: "Browser QA",
    description: "Exercise browser workflows and capture visual evidence.",
    mark: "QA",
    color: "#12866d",
  },
  {
    id: "incident-diagnosis",
    name: "Incident diagnosis",
    description: "Investigate failures with evidence-ranked hypotheses.",
    mark: "ID",
    color: "#c26a17",
  },
  {
    id: "pdf",
    name: "PDF",
    description: "Create, inspect, render, and verify PDF documents.",
    mark: "PDF",
    color: "#bc3c3c",
  },
  {
    id: "spreadsheets",
    name: "Spreadsheets",
    description: "Create, analyze, and verify workbook files.",
    mark: "SS",
    color: "#26804a",
  },
];

const initialConnections: readonly ToolConnection[] = [
  { id: "github-work", providerId: "github", accountName: "Work" },
  { id: "github-personal", providerId: "github", accountName: "Personal" },
  { id: "google-drive-team", providerId: "google-drive", accountName: "Team" },
];

export function PluginsCatalog({ agents }: PluginsCatalogProps) {
  const [kind, setKind] = useState<CatalogKind>("tools");
  const [query, setQuery] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<readonly string[]>([]);
  const [connections, setConnections] = useState<readonly ToolConnection[]>(initialConnections);
  const [assignments, setAssignments] = useState<Record<string, readonly string[]>>(() =>
    initialAssignments(agents),
  );
  const [target, setTarget] = useState<AssignmentTarget | null>(null);
  const assignmentsSeeded = useRef(agents.length > 0);

  useEffect(() => {
    if (assignmentsSeeded.current || agents.length === 0) return;
    assignmentsSeeded.current = true;
    setAssignments((current) => ({ ...current, ...initialAssignments(agents) }));
  }, [agents]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredConnections = useMemo(() => {
    const byProvider = new Map<string, ToolConnection[]>();
    for (const connection of connections) {
      const current = byProvider.get(connection.providerId) ?? [];
      current.push(connection);
      byProvider.set(connection.providerId, current);
    }
    return byProvider;
  }, [connections]);

  const matchingSkills = skillDefinitions.filter((skill) => {
    const matchesSearch = `${skill.name} ${skill.description}`
      .toLowerCase()
      .includes(normalizedQuery);
    const matchesAgent = matchesSelectedAgents(assignments[skill.id], selectedAgentIds);
    return matchesSearch && matchesAgent;
  });

  function toggleAgentFilter(agentId: string): void {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((candidate) => candidate !== agentId)
        : [...current, agentId],
    );
  }

  function assignToAgent(agentId: string): void {
    if (!target) return;
    if (target.kind === "tools" && target.providerId) {
      const providerConnections = connections.filter(
        (connection) => connection.providerId === target.providerId,
      );
      const id = `${target.providerId}-${crypto.randomUUID()}`;
      const accountName =
        providerConnections.length === 0 ? "Default" : `Account ${providerConnections.length + 1}`;
      setConnections((current) => [
        ...current,
        { id, providerId: target.providerId!, accountName },
      ]);
      setAssignments((current) => ({ ...current, [id]: [agentId] }));
    } else {
      setAssignments((current) => ({
        ...current,
        [target.id]: unique([...(current[target.id] ?? []), agentId]),
      }));
    }
    setTarget(null);
  }

  function removeAssignment(itemId: string, agentId: string): void {
    setAssignments((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? []).filter((candidate) => candidate !== agentId),
    }));
  }

  return (
    <section aria-label="Plugins" className="plugin-library">
      <div className="plugin-library__frame">
        <div className="plugin-library__controls">
          <div aria-label="Plugin type" className="plugin-library__tabs" role="tablist">
            {(["tools", "skills"] as const).map((option) => (
              <button
                aria-selected={kind === option}
                className={kind === option ? "is-active" : ""}
                key={option}
                onClick={() => {
                  setKind(option);
                  setQuery("");
                }}
                role="tab"
                type="button"
              >
                {sentenceCase(option)}
              </button>
            ))}
          </div>

          <div className="plugin-library__toolbar">
            <BotFilter
              agents={agents}
              selectedAgentIds={selectedAgentIds}
              onClear={() => setSelectedAgentIds([])}
              onToggle={toggleAgentFilter}
            />
            <label className="plugin-library__search">
              <SearchIcon aria-hidden="true" />
              <span className="sr-only">Search {kind}</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${kind}`}
                type="search"
                value={query}
              />
            </label>
          </div>
        </div>

        <div className="plugin-library__section-heading">
          <h2>{kind === "tools" ? "All tools" : "All skills"}</h2>
        </div>

        {kind === "tools" ? (
          <div className="plugin-library__grid">
            {toolProviders.flatMap((provider) => {
              const providerConnections = filteredConnections.get(provider.id) ?? [];
              const connectionCards = providerConnections
                .filter((connection) => {
                  const text =
                    `${provider.name} ${connection.accountName} ${provider.description}`.toLowerCase();
                  return (
                    text.includes(normalizedQuery) &&
                    matchesSelectedAgents(assignments[connection.id], selectedAgentIds)
                  );
                })
                .map((connection) => (
                  <CapabilityCard
                    agents={agents}
                    assignedAgentIds={assignments[connection.id] ?? []}
                    color={provider.color}
                    description={provider.description}
                    key={connection.id}
                    mark={provider.mark}
                    name={`${provider.name} (${connection.accountName})`}
                    onAdd={() => setTarget({ kind: "tools", id: connection.id })}
                    onRemove={(agentId) => removeAssignment(connection.id, agentId)}
                  />
                ));
              const addMatchesSearch = `${provider.name} ${provider.description}`
                .toLowerCase()
                .includes(normalizedQuery);
              const addCard =
                selectedAgentIds.length === 0 && addMatchesSearch ? (
                  <CapabilityCard
                    actionLabel={providerConnections.length > 0 ? "Add new account" : "Add"}
                    agents={agents}
                    assignedAgentIds={[]}
                    color={provider.color}
                    description={provider.description}
                    key={`${provider.id}-add`}
                    mark={provider.mark}
                    name={provider.name}
                    onAction={() =>
                      setTarget({ kind: "tools", id: provider.id, providerId: provider.id })
                    }
                  />
                ) : null;
              return [...connectionCards, addCard].filter(Boolean);
            })}
          </div>
        ) : (
          <div className="plugin-library__grid">
            {matchingSkills.map((skill) => (
              <CapabilityCard
                agents={agents}
                assignedAgentIds={assignments[skill.id] ?? []}
                color={skill.color}
                description={skill.description}
                key={skill.id}
                mark={skill.mark}
                name={skill.name}
                onAdd={() => setTarget({ kind: "skills", id: skill.id })}
                onRemove={(agentId) => removeAssignment(skill.id, agentId)}
              />
            ))}
          </div>
        )}

        {(kind === "skills" && matchingSkills.length === 0) ||
        (kind === "tools" &&
          !toolProviders.some((provider) =>
            `${provider.name} ${provider.description}`.toLowerCase().includes(normalizedQuery),
          )) ? (
          <div className="plugin-library__empty">
            No {kind} match this search and bot selection.
          </div>
        ) : null}
      </div>

      <BotSelectionDialog
        agents={agents}
        onClose={() => setTarget(null)}
        onSelect={assignToAgent}
        open={target !== null}
        title={
          target?.kind === "tools" && target.providerId
            ? "Add account to bot"
            : `Add ${target?.kind === "skills" ? "skill" : "tool"} to bot`
        }
      />
    </section>
  );
}

interface BotFilterProps {
  agents: readonly PluginsCatalogAgent[];
  selectedAgentIds: readonly string[];
  onClear: () => void;
  onToggle: (agentId: string) => void;
}

function BotFilter({ agents, selectedAgentIds, onClear, onToggle }: BotFilterProps) {
  const selected = agents.filter((agent) => selectedAgentIds.includes(agent.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={
            selected.length > 0
              ? `Filtered by ${selected.map((agent) => agent.name).join(", ")}`
              : "Show all"
          }
          className="plugin-library__bot-filter"
          type="button"
        >
          {selected.length === 0 ? (
            <span>Show all</span>
          ) : (
            <AvatarGroup aria-hidden="true">
              {selected.slice(0, 4).map((agent) => (
                <Avatar className="plugin-library__filter-avatar" key={agent.id} size="sm">
                  <AgentAvatar id={agent.id} paused />
                </Avatar>
              ))}
              {selected.length > 4 ? (
                <AvatarGroupCount className="plugin-library__filter-avatar">
                  +{selected.length - 4}
                </AvatarGroupCount>
              ) : null}
            </AvatarGroup>
          )}
          <ChevronDownIcon aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        <DropdownMenuItem onSelect={onClear}>Show all</DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((agent) => (
          <DropdownMenuCheckboxItem
            checked={selectedAgentIds.includes(agent.id)}
            key={agent.id}
            onCheckedChange={() => onToggle(agent.id)}
            onSelect={(event) => event.preventDefault()}
          >
            <Avatar className="size-5" size="sm">
              <AgentAvatar id={agent.id} paused />
            </Avatar>
            <span className="truncate">{agent.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {agents.length === 0 ? (
          <DropdownMenuItem disabled>No bots available</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface CapabilityCardProps {
  actionLabel?: string;
  agents: readonly PluginsCatalogAgent[];
  assignedAgentIds: readonly string[];
  color: string;
  description: string;
  mark: string;
  name: string;
  onAction?: () => void;
  onAdd?: () => void;
  onRemove?: (agentId: string) => void;
}

function CapabilityCard({
  actionLabel,
  agents,
  assignedAgentIds,
  color,
  description,
  mark,
  name,
  onAction,
  onAdd,
  onRemove,
}: CapabilityCardProps) {
  const assignedAgents = agents.filter((agent) => assignedAgentIds.includes(agent.id));
  return (
    <article className={`plugin-library__card ${actionLabel ? "is-action" : ""}`}>
      <span className="plugin-library__mark" style={{ "--plugin-mark": color } as CSSProperties}>
        {mark}
      </span>
      <div className="plugin-library__card-copy">
        <h3>{name}</h3>
        <p>{description}</p>
      </div>
      {actionLabel ? (
        <button className="plugin-library__add-account" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : (
        <BotAvatarActions agents={assignedAgents} onAdd={onAdd} onRemove={onRemove} />
      )}
    </article>
  );
}

function BotAvatarActions({
  agents,
  onAdd,
  onRemove,
}: {
  agents: readonly PluginsCatalogAgent[];
  onAdd?: () => void;
  onRemove?: (agentId: string) => void;
}) {
  return (
    <TooltipProvider delayDuration={180}>
      <AvatarGroup className="plugin-library__avatars">
        {agents.map((agent) => (
          <Tooltip key={agent.id}>
            <TooltipTrigger asChild>
              <button
                aria-label={`Remove from ${agent.name}`}
                className="plugin-library__avatar-action"
                onClick={() => onRemove?.(agent.id)}
                type="button"
              >
                <Avatar>
                  <AgentAvatar id={agent.id} paused />
                </Avatar>
                <span aria-hidden="true">
                  <XIcon />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={7}>
              {agent.name}
            </TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Add to bot"
              className="plugin-library__avatar-add"
              onClick={onAdd}
              type="button"
            >
              <AvatarGroupCount>
                <PlusIcon />
              </AvatarGroupCount>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={7}>
            Add to bot
          </TooltipContent>
        </Tooltip>
      </AvatarGroup>
    </TooltipProvider>
  );
}

function BotSelectionDialog({
  agents,
  onClose,
  onSelect,
  open,
  title,
}: {
  agents: readonly PluginsCatalogAgent[];
  onClose: () => void;
  onSelect: (agentId: string) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="plugin-library__dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Choose the bot that should receive this capability.</DialogDescription>
        <div className="plugin-library__bot-list">
          {agents.map((agent) => (
            <button key={agent.id} onClick={() => onSelect(agent.id)} type="button">
              <Avatar>
                <AgentAvatar id={agent.id} paused />
              </Avatar>
              <span>{agent.name}</span>
            </button>
          ))}
          {agents.length === 0 ? <p>No bots are available yet.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function initialAssignments(
  agents: readonly PluginsCatalogAgent[],
): Record<string, readonly string[]> {
  const first = agents[0]?.id;
  const second = agents[1]?.id ?? first;
  return {
    "github-work": first ? [first] : [],
    "github-personal": second ? [second] : [],
    "google-drive-team": first && second ? unique([first, second]) : [],
    "code-review": first ? [first] : [],
    "frontend-design": second ? [second] : [],
  };
}

function matchesSelectedAgents(
  assigned: readonly string[] | undefined,
  selected: readonly string[],
): boolean {
  return selected.length === 0 || selected.some((agentId) => assigned?.includes(agentId));
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
