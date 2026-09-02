# @tryopenbot/ui

Shared React UI components and the vendored Beautiful UI surface used by OpenBot applications.

## Public API

The package root exports the complete workspace surface:

- Shell and navigation: `WorkspaceShell`, `WorkspaceSidebar`, `WorkspaceSelector`,
  `AgentListItem`, `AgentSearchDialog`, `AgentSetupDialog`, `WorkspaceAccount`,
  `BrandedLoadingState`, and `useWorkspaceLayout`. `AgentSearchDialog` accepts consolidated bot,
  conversation-title, and message results through `WorkspaceSearchResult`.
- Chat: `ChatHeader`, `ChatPane`, `ChatComposer`, `ConversationSurface`,
  `ConversationMessage`, `EmptyConversation`, `MessageContent`,
  `ScrollToLatestButton`, `ThinkingIndicator`, `ChatFindBar`, transcript
  loading and error states, unread and new-message markers, message delivery
  notices, and system-event primitives.
- Connectors: `ConnectorAccountGrid`, `ConnectorSetupDialog`,
  `connectorSelectionViewFromPart`, and `isConnectorSelectionPart` render the
  agent's in-chat connector account picker and schema-driven credential setup.
- Capability changes: `CapabilityApprovalCard` renders the server-authored cost, security, and
  rollback preview with exact Yes/No actions inside the active conversation.
- Plugins and routines: `PluginsCatalog` renders provider-backed tool and skill assignments;
  `RoutineProvidersSettings` manages user-facing trigger-provider connections; and
  `RoutineSettings` renders searchable, filterable routine management with edit, status, and
  delete actions. Provider cards use explicit or server-authored icons and fall back to local
  monograms rather than synthesizing remote asset URLs.
- Rich content: `MarkdownText`, `JsonBlock`, `ReasoningCard`, `ToolCallCard`,
  `ConnectionCard`, `FileCard`, `FileViewer`, `MediaViewer`, `AudioPlayer`,
  `LinkPreviewCard`, `LinkHoverPreview`, `DiagramCard`, `CodeBlock`,
  `DiffBlock`, `CitationLink`, and `InlinePath`.
- Agent activity: `AgentActivity`, `ActivityQueue`, `ActivityTimeline`,
  `AsyncTasksPanel`, and `ConversationOutlinePanel`.
- Computer: `AgentWorkspacePanel`, `ComputerStagePlaceholder`,
  `ComputerMonitorStrip`, `ComputerReconnectBanner`, `ComputerRebuildBanner`,
  `ComputerRebuildDialog`, `ComputerFailureDialog`, and the remaining Computer
  lifecycle dialogs, including `ComputerHandoffCard`.
- Overlays: `DialogSurface`, `PermissionRequestCard`,
  `LocalToolPermissionCard`, `LocalToolPermissionDock`, and `ThreadOverlay`.
- Identity: `AgentAvatar` and its packaged avatar artwork.
- Controls: `StatusBadge`, `KeyboardKey`, `InputGroup`, `SelectField`,
  `ScrollArea`, `TextRoll`, `VoiceWaveform`, and `ModelPicker`.
- Vendored Beautiful UI: `ApprovalCard`, `BeautifulChat`,
  `BeautifulSidebarNav`, `StreamingText`, `TaskRows`, `Thinking`, and
  `ToolChips`.

`@tryopenbot/ui/beautiful-ui.css` exports the upstream stylesheet. `@tryopenbot/ui/beautiful-ui/*` exposes the vendored component modules for consumers that need a specific upstream file. Changes to vendored files must retain provenance in the repository notices.

`@tryopenbot/ui/openbot-ui.css` exports the complete OpenBot workspace palette,
geometry, responsive layout, component states, and motion system. Applications
should consume the package stylesheet instead of maintaining local overrides.

Consumers that need only the avatar can import `AgentAvatar` from
`@tryopenbot/ui/agent-avatar` and its component-scoped layout from
`@tryopenbot/ui/agent-avatar.css`. The standalone entry does not require the
OpenBot global stylesheet, theme tokens, or `@tryopenbot/client-runtime`.

## Storybook

Run the package-owned component catalog from the repository root:

```bash
pnpm --filter @tryopenbot/ui storybook
```

Build its static output with `pnpm --filter @tryopenbot/ui storybook:build`.
The stories cover every public visual component that can run in isolation,
including responsive compositions and loading, error, permission, reconnect,
and deployment lifecycle states.
