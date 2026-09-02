import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { WorkOverview } from "./work-overview.js";

describe("WorkOverview", () => {
  it("shows the owner outcome, tasks, and active background bots without host jargon", () => {
    const html = renderToStaticMarkup(
      createElement(WorkOverview, {
        goals: [
          {
            id: "goal-one",
            objective: "Launch v1",
            status: "active",
            progressPercent: 62,
          },
        ],
        tasks: [
          { id: "task-one", summary: "Connect Stripe", status: "input-required" },
          { id: "task-two", summary: "Positioning", status: "working" },
        ],
        jobs: [
          {
            id: "job-one",
            childAgentId: "researcher",
            objective: "Compare competitors",
            status: "running",
            updatedAt: "2026-09-01T10:00:00Z",
            transcriptMessageIds: [],
            artifacts: [],
          },
        ],
        onResume: vi.fn(),
        onSteer: vi.fn(),
        onStop: vi.fn(),
      }),
    );

    expect(html).toContain("Launch v1");
    expect(html).toContain("Needs you");
    expect(html).toContain("Connect Stripe");
    expect(html).toContain("In background");
    expect(html).toContain("researcher");
    expect(html).not.toContain("lease");
    expect(html).not.toContain("generation");
  });
});
