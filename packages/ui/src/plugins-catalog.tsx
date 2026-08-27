import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDownIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { AgentAvatar } from "./agent-avatar.js";
import { Button } from "./beautiful-ui/atoms/button.js";
import { Avatar, AvatarGroup, AvatarGroupCount } from "./components/ui/avatar.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog.js";
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
import { Spinner } from "./components/ui/spinner.js";
import { cn } from "./lib/utils.js";
import { ProviderIcon } from "./provider-icon.js";

export interface PluginsCatalogAgent {
  id: string;
  name: string;
}

export interface PluginsCatalogProps {
  agents: readonly PluginsCatalogAgent[];
  toolProviders: readonly PluginsCatalogToolProvider[];
  skillProviders: readonly PluginsCatalogSkillProvider[];
  /** Fixes the catalog to one routable view and hides the in-page kind switcher. */
  kind?: CatalogKind;
  loading?: boolean;
  error?: string;
  onAddToolAccount: (providerId: string) => void | Promise<void>;
  onDeleteToolAccounts: (accountIds: readonly string[]) => void | Promise<void>;
  onSetToolAccount: (accountId: string, agentId: string, enabled: boolean) => void | Promise<void>;
  onSetSkill: (skillId: string, agentId: string, enabled: boolean) => void | Promise<void>;
}

type CatalogKind = "tools" | "skills";

export interface PluginsCatalogToolProvider {
  id: string;
  name: string;
  description: string;
  categories: readonly string[];
  iconUrl?: string;
  iconKey?: string;
  canAddAccount?: boolean;
  accounts: readonly PluginsCatalogToolAccount[];
}

export interface PluginsCatalogToolAccount {
  id: string;
  accountName: string;
  assignedAgentIds: readonly string[];
}

export interface PluginsCatalogSkill {
  id: string;
  name: string;
  description: string;
  assignedAgentIds: readonly string[];
  assignedSkillIdByAgentId?: Readonly<Record<string, string>>;
}

export interface PluginsCatalogSkillProvider {
  id: string;
  name: string;
  description: string;
  categories: readonly string[];
  iconUrl?: string;
  iconKey?: string;
  skills: readonly PluginsCatalogSkill[];
}

type DetailTarget = { kind: "tools" | "skills"; providerId: string };

interface AssignmentTarget {
  kind: CatalogKind;
  id: string;
  returnToDetail?: DetailTarget;
}

interface PendingAssignment {
  kind: CatalogKind;
  id: string;
  agentId: string;
}

export function PluginsCatalog({
  agents,
  toolProviders,
  skillProviders,
  kind: fixedKind,
  loading = false,
  error,
  onAddToolAccount,
  onDeleteToolAccounts,
  onSetToolAccount,
  onSetSkill,
}: PluginsCatalogProps) {
  const catalogHeadingId = useId();
  const [selectedKind, setSelectedKind] = useState<CatalogKind>("tools");
  const kind = fixedKind ?? selectedKind;
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<readonly string[]>([]);
  const [target, setTarget] = useState<AssignmentTarget | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [pendingAssignments, setPendingAssignments] = useState<readonly PendingAssignment[]>([]);

  const normalizedQuery = query.trim().toLowerCase();
  const groupedSkillProviders = skillProviders.map((provider) => ({
    ...provider,
    skills: groupSkillsByName(provider.skills),
  }));
  const availableCategories = [
    ...new Set(
      kind === "tools"
        ? toolProviders.flatMap((provider) => provider.categories)
        : groupedSkillProviders.flatMap((provider) => provider.categories),
    ),
  ].sort(compareCategories);
  const visibleToolProviders = toolProviders
    .filter(
      (provider) => selectedCategory === null || provider.categories.includes(selectedCategory),
    )
    .map((provider) => {
      const connections = provider.accounts.filter((connection) => {
        const text =
          `${provider.name} ${connection.accountName} ${provider.description}`.toLowerCase();
        return (
          text.includes(normalizedQuery) &&
          matchesSelectedAgents(connection.assignedAgentIds, selectedAgentIds)
        );
      });
      const providerMatches = `${provider.name} ${provider.description}`
        .toLowerCase()
        .includes(normalizedQuery);
      return {
        provider,
        connections,
        visible: (selectedAgentIds.length === 0 && providerMatches) || connections.length > 0,
      };
    })
    .filter(({ visible }) => visible);
  const visibleSkillProviders = groupedSkillProviders.filter((provider) => {
    const matchesSearch = `${provider.name} ${provider.description} ${provider.skills
      .map((skill) => `${skill.name} ${skill.description}`)
      .join(" ")}`
      .toLowerCase()
      .includes(normalizedQuery);
    const matchesAgent =
      selectedAgentIds.length === 0 ||
      provider.skills.some((skill) =>
        matchesSelectedAgents(skill.assignedAgentIds, selectedAgentIds),
      );
    const matchesCategory =
      selectedCategory === null || provider.categories.includes(selectedCategory);
    return matchesSearch && matchesAgent && matchesCategory;
  });
  const toolGroups = groupToolProvidersByCategory(visibleToolProviders, selectedCategory);
  const skillGroups = groupSkillProvidersByCategory(visibleSkillProviders, selectedCategory);
  const detailProvider =
    detailTarget?.kind === "tools"
      ? toolProviders.find((provider) => provider.id === detailTarget.providerId)
      : undefined;
  const detailSkill =
    detailTarget?.kind === "skills"
      ? groupedSkillProviders.find((provider) => provider.id === detailTarget.providerId)
      : undefined;

  function toggleAgentFilter(agentId: string): void {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((candidate) => candidate !== agentId)
        : [...current, agentId],
    );
  }

  function assignToAgent(agentId: string): void {
    if (!target) return;
    const assignment = target;
    setTarget(null);
    if (assignment.returnToDetail) setDetailTarget(assignment.returnToDetail);

    const pending = { kind: assignment.kind, id: assignment.id, agentId };
    setPendingAssignments((current) => [...current, pending]);
    const finish = () => {
      setPendingAssignments((current) => current.filter((candidate) => candidate !== pending));
    };
    try {
      const mutation =
        assignment.kind === "tools"
          ? onSetToolAccount(assignment.id, agentId, true)
          : onSetSkill(assignment.id, agentId, true);
      void Promise.resolve(mutation).then(finish, finish);
    } catch {
      finish();
    }
  }

  function closeBotSelection(): void {
    if (target?.returnToDetail) setDetailTarget(target.returnToDetail);
    setTarget(null);
  }

  return (
    <section aria-label="Plugins" className="min-h-full min-w-0 bg-page text-ink">
      <div className="w-full">
        <div
          className={cn(
            "flex min-h-[58px] items-center gap-[22px]",
            fixedKind ? "justify-end" : "justify-between",
            `max-[980px]:flex-col max-[980px]:items-start max-[980px]:gap-2 max-[980px]:py-2.5
              max-[980px]:pb-3`,
          )}
        >
          {!fixedKind ? (
            <div aria-label="Plugin type" className="flex gap-6" role="tablist">
              {(["tools", "skills"] as const).map((option) => (
                <button
                  aria-selected={kind === option}
                  className={cn(
                    "relative h-[38px] cursor-pointer bg-transparent px-px text-[13px] font-medium",
                    "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-center",
                    "after:bg-ink after:opacity-0 after:transition-[opacity,transform] after:duration-150",
                    "after:content-['']",
                    kind === option
                      ? "text-ink after:scale-x-100 after:opacity-100"
                      : "text-ink-3 after:scale-x-40",
                  )}
                  key={option}
                  onClick={() => {
                    setSelectedKind(option);
                    setQuery("");
                    setSelectedCategory(null);
                  }}
                  role="tab"
                  type="button"
                >
                  {sentenceCase(option)}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className="flex items-center gap-2.5 max-[980px]:w-full max-[720px]:flex-col
              max-[720px]:items-stretch"
          >
            <BotFilter
              agents={agents}
              selectedAgentIds={selectedAgentIds}
              onClear={() => setSelectedAgentIds([])}
              onToggle={toggleAgentFilter}
            />
            <CategoryFilter
              categories={availableCategories}
              selectedCategory={selectedCategory}
              onSelect={setSelectedCategory}
            />
            <label
              className="flex h-[34px] w-[min(32vw,280px)] min-w-0 flex-[0_1_280px] items-center
                gap-2 rounded-lg border-[0.5px] border-line-strong bg-surface text-ink-3
                shadow-inset-field focus-within:border-[color-mix(in_srgb,var(--accent)_55%,var(--line-strong))]
                focus-within:shadow-[0_0_0_2px_var(--accent-tint)] max-[980px]:w-full"
            >
              <SearchIcon aria-hidden="true" className="ml-2.5 size-[15px] stroke-[1.5]" />
              <span className="sr-only">Search {kind}</span>
              <input
                className="h-full w-full min-w-0 bg-transparent pr-2.5 text-[12.5px] text-ink outline-none"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${kind}`}
                type="search"
                value={query}
              />
            </label>
          </div>
        </div>

        <section
          aria-label={kind === "tools" ? "Tool providers" : undefined}
          aria-labelledby={kind === "skills" ? catalogHeadingId : undefined}
          className="mt-4"
        >
          {kind === "skills" ? (
            <h2 className="sr-only" id={catalogHeadingId}>
              All skills
            </h2>
          ) : null}

          {error ? (
            <div className="mx-2 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}
          {loading ? <CatalogSkeleton kind={kind} /> : null}

          {!loading && kind === "tools" ? (
            <div className="space-y-3">
              {toolGroups.map(([category, categoryProviders]) => (
                <section aria-labelledby={`tool-category-${slugify(category)}`} key={category}>
                  <h3
                    className="m-0 px-2 pt-2 pb-1.5 text-[13px] leading-[18px] font-medium text-ink-3"
                    id={`tool-category-${slugify(category)}`}
                  >
                    {categoryLabel(category)}
                  </h3>
                  <ul
                    className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-0.5 p-0
                      max-[980px]:grid-cols-1"
                  >
                    {categoryProviders.map(({ provider, connections }) => (
                      <CatalogSummaryRow
                        agents={agents}
                        assignedAgentIds={unique(
                          connections.flatMap((connection) => connection.assignedAgentIds),
                        )}
                        color={capabilityColor(provider.id)}
                        description={provider.description}
                        {...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {})}
                        {...(provider.iconKey ? { iconKey: provider.iconKey } : {})}
                        key={provider.id}
                        mark={capabilityMark(provider.name)}
                        name={provider.name}
                        platformFallbacks={[provider.id, provider.name]}
                        onOpen={() => setDetailTarget({ kind: "tools", providerId: provider.id })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : !loading ? (
            <div className="space-y-3">
              {skillGroups.map(([category, categoryProviders]) => (
                <section aria-labelledby={`skill-category-${slugify(category)}`} key={category}>
                  <h3
                    className="m-0 px-2 pt-2 pb-1.5 text-[13px] leading-[18px] font-medium text-ink-3"
                    id={`skill-category-${slugify(category)}`}
                  >
                    {categoryLabel(category)}
                  </h3>
                  <ul
                    className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-0.5 p-0
                      max-[980px]:grid-cols-1"
                  >
                    {categoryProviders.map((provider) => (
                      <CatalogSummaryRow
                        agents={agents}
                        assignedAgentIds={unique(
                          provider.skills.flatMap((skill) => skill.assignedAgentIds),
                        )}
                        color={capabilityColor(provider.id)}
                        description={`${provider.skills.length} ${
                          provider.skills.length === 1 ? "skill" : "skills"
                        } · ${provider.description}`}
                        {...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {})}
                        {...(provider.iconKey ? { iconKey: provider.iconKey } : {})}
                        key={provider.id}
                        mark={capabilityMark(provider.name)}
                        name={provider.name}
                        platformFallbacks={[provider.id, provider.name]}
                        onOpen={() => setDetailTarget({ kind: "skills", providerId: provider.id })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}

          {!loading &&
          ((kind === "skills" && visibleSkillProviders.length === 0) ||
            (kind === "tools" && visibleToolProviders.length === 0)) ? (
            <div
              className="mt-2.5 rounded-xl border border-dashed border-line-strong p-9 text-center
                text-[12.5px] text-ink-3"
            >
              No {kind} match these filters.
            </div>
          ) : null}
        </section>
      </div>

      <BotSelectionDialog
        agents={agents}
        onClose={closeBotSelection}
        onSelect={assignToAgent}
        open={target !== null}
        title={`Add ${target?.kind === "skills" ? "skill" : "tool"} to bot`}
      />
      <PluginDetailDialog
        agents={agents}
        onAddSkill={(skillId) => {
          setDetailTarget(null);
          setTarget({
            kind: "skills",
            id: skillId,
            returnToDetail: { kind: "skills", providerId: detailSkill?.id ?? "" },
          });
        }}
        onAddToolAccount={(accountId) => {
          setDetailTarget(null);
          setTarget({
            kind: "tools",
            id: accountId,
            returnToDetail: { kind: "tools", providerId: detailProvider?.id ?? "" },
          });
        }}
        onAddToolProvider={(providerId) => {
          setDetailTarget(null);
          void onAddToolAccount(providerId);
        }}
        onClose={() => setDetailTarget(null)}
        onDeleteToolAccounts={onDeleteToolAccounts}
        onRemoveSkill={(skillId, agentId) => onSetSkill(skillId, agentId, false)}
        onRemoveToolAccount={(accountId, agentId) => onSetToolAccount(accountId, agentId, false)}
        open={detailTarget !== null}
        pendingAssignments={pendingAssignments}
        provider={detailProvider}
        skillProvider={detailSkill}
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
              : "Enabled for bot"
          }
          className="flex h-[34px] min-w-28 cursor-pointer items-center justify-between gap-2.5
            rounded-lg border-[0.5px] border-line-strong bg-surface px-2.5 text-xs font-medium
            text-ink-2 shadow-inset-field max-[720px]:w-full"
          type="button"
        >
          {selected.length === 0 ? (
            <span>Enabled for bot</span>
          ) : (
            <AvatarGroup aria-hidden="true">
              {selected.slice(0, 4).map((agent) => (
                <Avatar
                  className="size-[22px] border-[1.5px] border-surface bg-surface text-[9px]"
                  key={agent.id}
                  size="sm"
                >
                  <AgentAvatar className="!size-full" id={agent.id} paused />
                </Avatar>
              ))}
              {selected.length > 4 ? (
                <AvatarGroupCount className="size-[22px] border-[1.5px] border-surface text-[9px]">
                  +{selected.length - 4}
                </AvatarGroupCount>
              ) : null}
            </AvatarGroup>
          )}
          <ChevronDownIcon aria-hidden="true" className="size-3.5 stroke-[1.5]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        <DropdownMenuItem onSelect={onClear}>Enabled for bot</DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((agent) => (
          <DropdownMenuCheckboxItem
            checked={selectedAgentIds.includes(agent.id)}
            key={agent.id}
            onCheckedChange={() => onToggle(agent.id)}
            onSelect={(event) => event.preventDefault()}
          >
            <Avatar className="size-5 bg-surface" size="sm">
              <AgentAvatar className="!size-full" id={agent.id} paused />
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

interface CategoryFilterProps {
  categories: readonly string[];
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
}

function CategoryFilter({ categories, selectedCategory, onSelect }: CategoryFilterProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={
            selectedCategory ? `Category: ${categoryLabel(selectedCategory)}` : "Category"
          }
          className="flex h-[34px] min-w-28 cursor-pointer items-center justify-between gap-2.5
            rounded-lg border-[0.5px] border-line-strong bg-surface px-2.5 text-xs font-medium
            text-ink-2 shadow-inset-field max-[720px]:w-full"
          type="button"
        >
          <span className="max-w-32 truncate">
            {selectedCategory ? categoryLabel(selectedCategory) : "Category"}
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 stroke-[1.5]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuItem onSelect={() => onSelect(null)}>All categories</DropdownMenuItem>
        <DropdownMenuSeparator />
        {categories.map((category) => (
          <DropdownMenuCheckboxItem
            checked={selectedCategory === category}
            key={category}
            onCheckedChange={() => onSelect(selectedCategory === category ? null : category)}
          >
            {categoryLabel(category)}
          </DropdownMenuCheckboxItem>
        ))}
        {categories.length === 0 ? (
          <DropdownMenuItem disabled>No categories available</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface CapabilityRowProps {
  actionLabel?: string;
  agents: readonly PluginsCatalogAgent[];
  assignedAgentIds: readonly string[];
  color: string;
  description?: string;
  iconUrl?: string;
  iconKey?: string;
  mark: string;
  multilineDescription?: boolean;
  name: string;
  pendingAgentIds?: readonly string[];
  platformFallbacks?: readonly string[];
  showIcon?: boolean;
  onAction?: () => void;
  onAdd?: () => void;
  onRemoveAccount?: () => void;
  onRemove?: (agentId: string) => void;
}

interface CatalogSummaryRowProps {
  agents: readonly PluginsCatalogAgent[];
  assignedAgentIds: readonly string[];
  color: string;
  description: string;
  iconUrl?: string;
  iconKey?: string;
  mark: string;
  name: string;
  onOpen: () => void;
  platformFallbacks?: readonly string[];
}

function CatalogSummaryRow({
  agents,
  assignedAgentIds,
  color,
  description,
  iconUrl,
  iconKey,
  mark,
  name,
  onOpen,
  platformFallbacks,
}: CatalogSummaryRowProps) {
  const assignedAgents = agents.filter((agent) => assignedAgentIds.includes(agent.id));
  return (
    <li className="min-w-0">
      <button
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl bg-transparent
          px-3 py-[9.5px] text-left hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]
          focus-visible:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]
          focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        <CapabilityIcon
          color={color}
          {...(iconUrl ? { iconUrl } : {})}
          {...(iconKey ? { iconKey } : {})}
          mark={mark}
          platformFallbacks={platformFallbacks}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <h3 className="m-0 truncate text-[13px] leading-[18px] font-medium text-ink">{name}</h3>
          <p className="m-0 truncate text-[13px] leading-[18px] text-ink-2">{description}</p>
        </div>
        <StaticAvatarGroup agents={assignedAgents} />
      </button>
    </li>
  );
}

function CapabilityIcon({
  color,
  iconUrl,
  iconKey,
  mark,
  platformFallbacks = [],
}: {
  color: string;
  iconUrl?: string;
  iconKey?: string;
  mark: string;
  platformFallbacks?: readonly string[];
}) {
  const candidates = useMemo(
    () => platformIconCandidates(iconUrl, iconKey, ...platformFallbacks),
    [iconKey, iconUrl, platformFallbacks],
  );
  const candidateKey = candidates.join("\0");
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [candidateKey]);
  const candidate = candidates[candidateIndex];
  return (
    <ProviderIcon
      backgroundColor={color}
      fallback={mark}
      {...(candidate ? { imageUrl: candidate } : {})}
      onImageError={() => setCandidateIndex((current) => current + 1)}
    />
  );
}

function StaticAvatarGroup({ agents }: { agents: readonly PluginsCatalogAgent[] }) {
  if (agents.length === 0) return null;
  return (
    <AvatarGroup aria-label={`Enabled for ${agents.map((agent) => agent.name).join(", ")}`}>
      {agents.slice(0, 4).map((agent) => (
        <Avatar
          className="size-[30px] border-2 border-surface bg-surface
            shadow-[0_0_0_0.5px_var(--line-strong)]"
          key={agent.id}
        >
          <AgentAvatar className="!size-full" id={agent.id} paused />
        </Avatar>
      ))}
      {agents.length > 4 ? (
        <AvatarGroupCount className="size-[30px] border-2 border-surface text-[10px]">
          +{agents.length - 4}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}

function CapabilityRow({
  actionLabel,
  agents,
  assignedAgentIds,
  color,
  description,
  iconUrl,
  iconKey,
  mark,
  multilineDescription = false,
  name,
  onAction,
  onAdd,
  onRemoveAccount,
  onRemove,
  pendingAgentIds = [],
  platformFallbacks,
  showIcon = true,
}: CapabilityRowProps) {
  const visibleAgentIds = unique([...assignedAgentIds, ...pendingAgentIds]);
  const assignedAgents = agents.filter((agent) => visibleAgentIds.includes(agent.id));
  return (
    <li
      className="flex min-w-0 items-center gap-3 rounded-2xl bg-transparent px-3 py-[9.5px]
        hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] max-[720px]:flex-wrap
        max-[720px]:items-start"
    >
      {showIcon ? (
        <CapabilityIcon
          color={color}
          {...(iconUrl ? { iconUrl } : {})}
          {...(iconKey ? { iconKey } : {})}
          mark={mark}
          platformFallbacks={platformFallbacks}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        {onRemoveAccount ? (
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="m-0 truncate text-[13px] leading-[18px] font-medium text-ink">{name}</h3>
            <BotAvatarActions
              agents={assignedAgents}
              alignWithIcon={showIcon}
              inlineWithTitle
              pendingAgentIds={pendingAgentIds}
              onAdd={onAdd}
              onRemove={onRemove}
            />
          </div>
        ) : (
          <h3 className="m-0 truncate text-[13px] leading-[18px] font-medium text-ink">{name}</h3>
        )}
        {description ? (
          <p
            className={cn(
              "m-0 text-[13px] leading-[18px] text-ink-2",
              multilineDescription ? "line-clamp-3" : "truncate",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actionLabel ? (
        <Button
          className="shrink-0 max-[720px]:ml-[52px]"
          onClick={onAction}
          size="sm"
          type="button"
          variant="secondary"
        >
          {actionLabel}
        </Button>
      ) : onRemoveAccount ? (
        <button
          aria-label={`Remove ${name} account`}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2
            text-xs font-medium text-red hover:bg-red/10 focus-visible:bg-red/10
            focus-visible:outline-none"
          onClick={onRemoveAccount}
          type="button"
        >
          <Trash2Icon className="size-3.5" />
          Remove account
        </button>
      ) : (
        <BotAvatarActions
          agents={assignedAgents}
          alignWithIcon={showIcon}
          pendingAgentIds={pendingAgentIds}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      )}
    </li>
  );
}

function BotAvatarActions({
  agents,
  alignWithIcon,
  inlineWithTitle = false,
  onAdd,
  onRemove,
  pendingAgentIds,
}: {
  agents: readonly PluginsCatalogAgent[];
  alignWithIcon: boolean;
  inlineWithTitle?: boolean;
  onAdd?: () => void;
  onRemove?: (agentId: string) => void;
  pendingAgentIds: readonly string[];
}) {
  return (
    <TooltipProvider delayDuration={180}>
      <AvatarGroup
        className={cn(
          "-space-x-1.5 justify-self-end",
          inlineWithTitle ? "pl-0" : "pl-2 max-[720px]:pl-0",
          alignWithIcon && "max-[720px]:ml-[52px]",
        )}
      >
        {agents.map((agent) => {
          const pending = pendingAgentIds.includes(agent.id);
          return (
            <Tooltip key={agent.id}>
              <TooltipTrigger asChild>
                <button
                  aria-label={pending ? `Adding to ${agent.name}` : `Remove from ${agent.name}`}
                  className="group/avatar-control relative z-[1] grid size-[30px] shrink-0 cursor-pointer
                  place-items-center rounded-full bg-transparent p-0 hover:z-[4] focus-visible:z-[4]
                  focus-visible:outline-none"
                  disabled={pending}
                  onClick={() => {
                    if (!pending) onRemove?.(agent.id);
                  }}
                  type="button"
                >
                  <Avatar
                    className={cn(
                      "z-0 size-[30px] border-2 border-surface bg-surface shadow-[0_0_0_0.5px_var(--line-strong)]",
                      !pending &&
                        "group-hover/avatar-control:invisible group-focus-visible/avatar-control:invisible",
                    )}
                  >
                    <AgentAvatar className="!size-full" id={agent.id} paused />
                  </Avatar>
                  {pending ? (
                    <span
                      className="absolute inset-0 grid place-items-center rounded-full
                      bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] text-ink"
                    >
                      <Spinner className="size-4" />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 z-[2] grid place-items-center rounded-full
                      bg-red text-white opacity-0 transition-opacity duration-100
                      group-hover/avatar-control:opacity-100
                      group-focus-visible/avatar-control:opacity-100"
                    >
                      <Trash2Icon className="size-[13px] stroke-2" />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={7}>
                {pending ? `Adding to ${agent.name}` : agent.name}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Add to bot"
              className="group/avatar-add relative z-0 grid size-[30px] shrink-0 cursor-pointer
                place-items-center rounded-full bg-transparent p-0 hover:z-[4] focus-visible:z-[4]
                focus-visible:outline-none"
              onClick={onAdd}
              type="button"
            >
              <AvatarGroupCount
                className="size-[30px] border-2 border-surface bg-field text-ink-2
                  shadow-[0_0_0_0.5px_var(--line-strong)] group-hover/avatar-add:bg-hover-2
                  group-hover/avatar-add:text-ink"
              >
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

function PluginDetailDialog({
  agents,
  onAddSkill,
  onAddToolAccount,
  onAddToolProvider,
  onClose,
  onDeleteToolAccounts,
  onRemoveSkill,
  onRemoveToolAccount,
  open,
  pendingAssignments,
  provider,
  skillProvider,
}: {
  agents: readonly PluginsCatalogAgent[];
  onAddSkill: (skillId: string) => void;
  onAddToolAccount: (accountId: string) => void;
  onAddToolProvider: (providerId: string) => void;
  onClose: () => void;
  onDeleteToolAccounts: (accountIds: readonly string[]) => void | Promise<void>;
  onRemoveSkill: (skillId: string, agentId: string) => void;
  onRemoveToolAccount: (accountId: string, agentId: string) => void;
  open: boolean;
  pendingAssignments: readonly PendingAssignment[];
  provider?: PluginsCatalogToolProvider;
  skillProvider?: PluginsCatalogSkillProvider;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<PluginsCatalogToolAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const title = provider?.name ?? skillProvider?.name ?? "Plugin";
  const description = provider?.description ?? skillProvider?.description ?? "";
  const capability = provider ?? skillProvider;
  async function confirmDelete(): Promise<void> {
    if (!confirmingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDeleteToolAccounts([confirmingDelete.id]);
      setConfirmingDelete(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Could not delete account");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && confirmingDelete === null) onClose();
        }}
      >
        <DialogContent
          className={cn(
            "p-[22px]",
            skillProvider
              ? `flex h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[calc(100vw-32px)]
              flex-col overflow-hidden`
              : "max-w-[520px]",
          )}
        >
          <DialogClose asChild>
            <button
              aria-label="Close"
              className="absolute top-3 right-3 grid size-7 cursor-pointer place-items-center
              rounded-md bg-transparent text-ink-3 hover:bg-hover hover:text-ink
              focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-none"
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
          </DialogClose>
          <div className="mb-[18px] flex items-start gap-3 pr-8">
            {capability ? (
              <CapabilityIcon
                color={capabilityColor(capability.id)}
                {...(capability.iconUrl ? { iconUrl: capability.iconUrl } : {})}
                {...(capability.iconKey ? { iconKey: capability.iconKey } : {})}
                mark={capabilityMark(capability.name)}
                platformFallbacks={[capability.id, capability.name]}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <DialogTitle className="m-0 text-base font-semibold">{title}</DialogTitle>
              <DialogDescription className="mt-1.5 text-[12.5px] leading-[18px] text-ink-3">
                {description || "Manage which bots can use this capability."}
              </DialogDescription>
            </div>
          </div>

          {provider ? (
            <div className="grid gap-2">
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {provider.accounts.map((account) => (
                  <CapabilityRow
                    agents={agents}
                    assignedAgentIds={account.assignedAgentIds}
                    color={capabilityColor(provider.id)}
                    {...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {})}
                    {...(provider.iconKey ? { iconKey: provider.iconKey } : {})}
                    key={account.id}
                    mark={capabilityMark(provider.name)}
                    name={account.accountName}
                    pendingAgentIds={pendingAssignments
                      .filter(({ kind, id }) => kind === "tools" && id === account.id)
                      .map(({ agentId }) => agentId)}
                    platformFallbacks={[provider.id, provider.name]}
                    showIcon={false}
                    onAdd={() => onAddToolAccount(account.id)}
                    onRemoveAccount={() => {
                      setDeleteError("");
                      setConfirmingDelete(account);
                    }}
                    onRemove={(agentId) => onRemoveToolAccount(account.id, agentId)}
                  />
                ))}
              </ul>
              {provider.canAddAccount !== false ? (
                <button
                  className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg
                  bg-transparent px-3 text-left text-xs font-medium text-ink-2 hover:bg-hover
                  focus-visible:bg-hover focus-visible:outline-none"
                  onClick={() => onAddToolProvider(provider.id)}
                  type="button"
                >
                  <span className="grid size-6 place-items-center rounded-md bg-field text-ink-2">
                    <PlusIcon className="size-3.5" />
                  </span>
                  {provider.accounts.length > 0 ? "Add new account" : "Add account"}
                </button>
              ) : null}
            </div>
          ) : null}

          {skillProvider ? (
            <ul
              className="m-0 grid min-h-0 flex-1 auto-rows-min list-none grid-cols-1 gap-1
              overflow-y-auto p-0 pr-1 min-[640px]:grid-cols-2 min-[960px]:grid-cols-3
              min-[1200px]:grid-cols-4"
            >
              {skillProvider.skills.map((skill) => (
                <CapabilityRow
                  agents={agents}
                  assignedAgentIds={skill.assignedAgentIds}
                  color={capabilityColor(skillProvider.id)}
                  description={skill.description}
                  {...(skillProvider.iconUrl ? { iconUrl: skillProvider.iconUrl } : {})}
                  {...(skillProvider.iconKey ? { iconKey: skillProvider.iconKey } : {})}
                  key={skill.id}
                  mark={capabilityMark(skillProvider.name)}
                  multilineDescription
                  name={skill.name}
                  pendingAgentIds={pendingAssignments
                    .filter(({ kind, id }) => kind === "skills" && id === skill.id)
                    .map(({ agentId }) => agentId)}
                  platformFallbacks={[skillProvider.id, skillProvider.name]}
                  showIcon={false}
                  onAdd={() => onAddSkill(skill.id)}
                  onRemove={(agentId) =>
                    onRemoveSkill(skill.assignedSkillIdByAgentId?.[agentId] ?? skill.id, agentId)
                  }
                />
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) setConfirmingDelete(null);
        }}
      >
        <DialogContent className="max-w-[420px] p-[22px]">
          <DialogTitle className="m-0 text-base font-semibold">
            Remove {confirmingDelete?.accountName} account?
          </DialogTitle>
          <DialogDescription className="mt-2 text-[12.5px] leading-[18px] text-ink-3">
            This permanently removes this configured account from Tilde and every bot. This
            can&apos;t be undone.
          </DialogDescription>
          {deleteError ? (
            <p className="mt-3 text-xs leading-5 text-red" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              disabled={deleting}
              onClick={() => setConfirmingDelete(null)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              className="bg-red text-white hover:brightness-95"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Spinner className="size-3.5" /> : <Trash2Icon className="size-3.5" />}
              {deleting ? "Removing…" : "Remove account"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface BotSelectionDialogProps {
  agents: readonly PluginsCatalogAgent[];
  onClose: () => void;
  onSelect: (agentId: string) => void;
  open: boolean;
  pendingAgentIds?: readonly string[];
  title: string;
}

export function BotSelectionDialog({
  agents,
  onClose,
  onSelect,
  open,
  pendingAgentIds = [],
  title,
}: BotSelectionDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-[560px] p-[22px]">
        <DialogTitle className="m-0 text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 mb-[18px] text-[12.5px] text-ink-3">
          Choose the bot that should receive this capability.
        </DialogDescription>
        <div className="grid grid-cols-2 gap-[5px]">
          {agents.map((agent) => {
            const pending = pendingAgentIds.includes(agent.id);
            return (
              <button
                aria-label={pending ? `Adding to ${agent.name}` : undefined}
                className="flex h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-lg
                  bg-transparent px-2.5 text-left text-[12.5px] font-medium text-ink hover:bg-hover
                  focus-visible:bg-hover focus-visible:outline-none disabled:cursor-default"
                disabled={pendingAgentIds.length > 0}
                key={agent.id}
                onClick={() => onSelect(agent.id)}
                type="button"
              >
                <span className="relative shrink-0">
                  <Avatar className="bg-surface">
                    <AgentAvatar className="!size-full" id={agent.id} paused />
                  </Avatar>
                  {pending ? (
                    <span
                      className="absolute inset-0 grid place-items-center rounded-full
                        bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] text-ink"
                    >
                      <Spinner className="size-4" />
                    </span>
                  ) : null}
                </span>
                <span className="truncate">{agent.name}</span>
              </button>
            );
          })}
          {agents.length === 0 ? (
            <p className="text-xs text-ink-3">No bots are available yet.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function matchesSelectedAgents(
  assigned: readonly string[] | undefined,
  selected: readonly string[],
): boolean {
  return selected.length === 0 || selected.some((agentId) => assigned?.includes(agentId));
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function categoryLabel(value: string): string {
  return sentenceCase(value.replaceAll(/[_-]+/g, " "));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function groupSkillProvidersByCategory(
  providers: readonly PluginsCatalogSkillProvider[],
  selectedCategory: string | null,
): [string, PluginsCatalogSkillProvider[]][] {
  const groups = new Map<string, PluginsCatalogSkillProvider[]>();
  for (const provider of providers) {
    const category = selectedCategory ?? provider.categories[0] ?? "Other";
    const group = groups.get(category) ?? [];
    group.push(provider);
    groups.set(category, group);
  }
  return [...groups].sort(([left], [right]) => compareCategories(left, right));
}

function groupToolProvidersByCategory(
  providers: readonly {
    provider: PluginsCatalogToolProvider;
    connections: readonly PluginsCatalogToolAccount[];
  }[],
  selectedCategory: string | null,
): [string, typeof providers][] {
  const groups = new Map<string, (typeof providers)[number][]>();
  for (const provider of providers) {
    const category = selectedCategory ?? provider.provider.categories[0] ?? "Other";
    const group = groups.get(category) ?? [];
    group.push(provider);
    groups.set(category, group);
  }
  return [...groups].sort(([left], [right]) => compareCategories(left, right));
}

function compareCategories(left: string, right: string): number {
  const leftIsOther = left.trim().toLowerCase() === "other";
  const rightIsOther = right.trim().toLowerCase() === "other";
  if (leftIsOther !== rightIsOther) return leftIsOther ? 1 : -1;
  return left.localeCompare(right);
}

function groupSkillsByName(skills: readonly PluginsCatalogSkill[]): PluginsCatalogSkill[] {
  const groups = new Map<string, PluginsCatalogSkill>();
  for (const skill of skills) {
    const key = skill.name.trim().toLocaleLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...skill,
        assignedAgentIds: unique(skill.assignedAgentIds),
        assignedSkillIdByAgentId: Object.fromEntries(
          skill.assignedAgentIds.map((agentId) => [
            agentId,
            skill.assignedSkillIdByAgentId?.[agentId] ?? skill.id,
          ]),
        ),
      });
      continue;
    }

    const assignedSkillIdByAgentId: Record<string, string> = {
      ...existing.assignedSkillIdByAgentId,
    };
    for (const agentId of skill.assignedAgentIds) {
      assignedSkillIdByAgentId[agentId] ??= skill.assignedSkillIdByAgentId?.[agentId] ?? skill.id;
    }
    groups.set(key, {
      ...existing,
      assignedAgentIds: unique([...existing.assignedAgentIds, ...skill.assignedAgentIds]),
      assignedSkillIdByAgentId,
    });
  }
  return [...groups.values()];
}

function capabilityMark(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

const platformIconAliases: Readonly<Record<string, string>> = {
  "amazon s3": "aws-s3",
  "aws s3": "aws-s3",
  "aws s3 bucket": "aws-s3",
  "google bigquery": "google-bigquery",
  "google gmail": "gmail",
  "google mail": "gmail",
  "mongo db": "mongodb",
  "open ai": "openai",
  postgres: "postgresql",
};

const modalIconUrl =
  "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/modal/default.svg";
const e2bIconUrl =
  "https://raw.githubusercontent.com/e2b-dev/E2B/main/readme-assets/logo-circle.png";
const apolloIconUrl = "https://www.apollo.io/icon.svg";
const platformIconOverrides: Readonly<Record<string, string>> = {
  apollo: apolloIconUrl,
  "apollo io": apolloIconUrl,
  e2b: e2bIconUrl,
  "e2b sandbox": e2bIconUrl,
  modal: modalIconUrl,
  "modal sandbox": modalIconUrl,
};

function platformIconCandidates(
  iconUrl: string | undefined,
  iconKey: string | undefined,
  ...fallbacks: readonly string[]
): string[] {
  return unique(
    [
      isImageUrl(iconUrl) ? iconUrl : undefined,
      ...[iconKey, ...fallbacks].map(platformIconUrl),
    ].filter((candidate): candidate is string => Boolean(candidate)),
  );
}

export function resolvePluginIconUrl(
  iconUrl: string | undefined,
  iconKey: string | undefined,
  ...fallbacks: readonly string[]
): string | undefined {
  return platformIconCandidates(iconUrl, iconKey, ...fallbacks)[0];
}

function platformIconUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .toLowerCase()
    .replaceAll(/[_./:]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!normalized || /^(?:tilde|debug|message internal)\b/.test(normalized)) return undefined;
  const override = platformIconOverrides[normalized];
  if (override) return override;
  const slug =
    platformIconAliases[normalized] ??
    normalized.replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return slug ? `https://thesvg.org/icons/${slug}/default.svg` : undefined;
}

function isImageUrl(value: string | undefined): value is string {
  return Boolean(value && /^(?:https?:\/\/|data:image\/)/.test(value));
}

function capabilityColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 48% 43%)`;
}

function CatalogSkeleton({ kind }: { kind: CatalogKind }) {
  return (
    <div
      aria-label={`Loading ${kind}`}
      className="grid grid-cols-2 gap-x-2 gap-y-0.5 max-[980px]:grid-cols-1"
      role="status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          aria-hidden="true"
          className="flex h-16 min-w-0 animate-pulse items-center gap-3 rounded-2xl px-3 py-[9.5px]
            motion-reduce:animate-none"
          key={index}
        >
          <span className="size-[45px] shrink-0 rounded-[10px] bg-hover-2" />
          <span className="min-w-0 flex-1 space-y-2">
            <span
              className={cn(
                "block h-2.5 rounded-full bg-hover-2",
                index % 3 === 0 ? "w-28" : index % 3 === 1 ? "w-36" : "w-24",
              )}
            />
            <span className="block h-2 w-[min(90%,240px)] rounded-full bg-hover" />
          </span>
          <span className="flex -space-x-1.5 pl-2">
            <span className="size-[30px] rounded-full border-2 border-surface bg-hover-2" />
            <span className="size-[30px] rounded-full border-2 border-surface bg-field" />
          </span>
        </div>
      ))}
    </div>
  );
}
