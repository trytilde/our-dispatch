import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { Routine, SignalInstance, SignalProvider } from "@tryopenbot/client-runtime";
import { AgentDetailsPane } from "./agent-details-pane.js";
import { ChatHeader } from "./chat-components.js";
import { RoutineEditor } from "./routine-editor.js";
import { RoutinesSection } from "./routines-section.js";
import { SignalsSettings } from "./signals-settings.js";

const providers: SignalProvider[] = [
  {
    type_id: "github",
    name: "GitHub",
    documentation: "",
    instructions: "Paste {{webhook_url}} into the repository webhook settings.",
    auth_methods: ["webhook"],
    requires_signing_key: true,
    signing_key_description: "GitHub webhook signing key",
    route_path: "events",
    signal_types: [
      {
        type_id: "github.pull_request.opened",
        name: "Pull request opened",
        documentation: "",
        categories: [],
        default_session_key_template: "",
        default_session_title_template: null,
      },
    ],
    credential_sources: [],
    interpolation_variables: [],
  },
];

const instances: SignalInstance[] = [
  {
    id: "spi_1",
    display_name: "GitHub connection",
    provider_type: "github",
    status: "enabled",
    ingress_mode: "webhook",
    webhook_url: "https://api.example.test/api/v1/webhooks/github-signals-spi_1/events",
    poll_interval_seconds: null,
    last_error: null,
    created_at: "2026-08-24T07:00:00Z",
    updated_at: "2026-08-24T07:00:00Z",
  },
];

const scheduled: Routine = {
  id: "group-1",
  agent_id: "agent-1",
  name: "Morning news",
  instruction: "Summarize overnight AI news.",
  enabled: true,
  triggers: [
    {
      id: "trigger-1",
      kind: "schedule",
      schedule: "0 7 * * *",
      description: "Daily at 07:00 UTC",
      next_run_at: null,
      routine_id: "routine-1",
    },
  ],
  created_at: "2026-08-24T07:00:00Z",
  updated_at: "2026-08-24T07:00:00Z",
};

const paused: Routine = {
  ...scheduled,
  id: "group-2",
  name: "PR triage",
  enabled: false,
  triggers: [
    {
      id: "trigger-2",
      kind: "event",
      instance_id: "spi_1",
      provider_type: "github",
      signal_type: "github.pull_request.opened",
      filters: [{ path: "repository.full_name", value: "acme/web" }],
      rule_id: "rule-1",
    },
  ],
};

const noop = () => undefined;

function editor(routine: Routine | null) {
  return renderToStaticMarkup(
    <RoutineEditor
      deleteFailed={false}
      deliveriesByInstanceId={{}}
      instances={instances}
      onConnectProvider={noop}
      onCreateDraft={noop}
      onDelete={noop}
      onSelectSession={noop}
      onTestRun={noop}
      onUpdate={noop}
      providers={providers}
      routine={routine}
      running={false}
      saveFailed={false}
      togglePending={false}
    />,
  );
}

describe("routines surfaces render", () => {
  it("uses the routines affordance and panel header actions", () => {
    const header = renderToStaticMarkup(
      <ChatHeader
        agentName="OpenBot"
        computerOpen={false}
        onToggleComputer={noop}
        onToggleDetails={noop}
      />,
    );
    expect(header).toContain("Toggle routines");
    expect(header).toContain("lucide-waypoints");

    const panel = renderToStaticMarkup(
      <AgentDetailsPane onAdd={noop} onClose={noop} open title="Routines">
        <div />
      </AgentDetailsPane>,
    );
    expect(panel).toContain("Routines");
    expect(panel).toContain("Add");
    expect(panel.indexOf("Add")).toBeLessThan(panel.indexOf("Close routines"));
  });

  it("renders the settled empty state with its call to action", () => {
    const html = renderToStaticMarkup(
      <RoutinesSection onCreate={noop} onOpen={noop} providers={providers} routines={[]} settled />,
    );
    expect(html).toContain("Routines are recurring tasks this agent runs");
    expect(html).toContain("Create your first routine");
  });

  it("holds the empty state back until the first load settles", () => {
    const html = renderToStaticMarkup(
      <RoutinesSection
        onCreate={noop}
        onOpen={noop}
        providers={providers}
        routines={[]}
        settled={false}
      />,
    );
    expect(html).not.toContain("Routines are recurring tasks this agent runs");
  });

  it("lists routines with enabled first and paused detail text", () => {
    const html = renderToStaticMarkup(
      <RoutinesSection
        onCreate={noop}
        onOpen={noop}
        providers={providers}
        routines={[paused, scheduled]}
        settled
      />,
    );
    expect(html).toContain("Morning news");
    expect(html).toContain("PR triage");
    expect(html).toContain("Paused");
    expect(html.indexOf("Morning news")).toBeLessThan(html.indexOf("PR triage"));
  });

  it("renders an existing routine with its header actions and sections", () => {
    const html = editor(scheduled);
    expect(html).toContain("Active");
    expect(html).toContain("Delete");
    expect(html).toContain("Test run");
    expect(html).toContain("Run history");
    expect(html).toContain("No runs yet");
    expect(html).toContain("Morning news");
  });

  it("renders a draft with the specified placeholders", () => {
    const html = editor(null);
    expect(html).toContain("Name this routine");
    expect(html).toContain("What should this routine do each time it runs?");
  });

  it("renders signal connections with their webhook url", () => {
    const html = renderToStaticMarkup(
      <SignalsSettings
        deliveriesByInstanceId={{}}
        instances={instances}
        onConnectProvider={noop}
        onDeleteInstance={noop}
        onRotateSigningKey={noop}
        onTestInstance={noop}
        onToggleInstance={noop}
        onViewDeliveries={noop}
        providers={providers}
        settled
      />,
    );
    expect(html).toContain("GitHub connection");
    expect(html).toContain("github-signals-spi_1/events");
  });
});
