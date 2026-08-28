import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ActivityQueueItem } from "./agent-activity.js";
import { ActivityQueue, queuePositionForIndex } from "./agent-activity.js";

const queue = (positions: number[]): ActivityQueueItem[] =>
  positions.map((queuePosition, index) => ({
    id: `queued-${index}`,
    text: `Queued message ${index}`,
    queuePosition,
  }));

describe("queued message ordering", () => {
  it("renders the ChatKit workspace steer and delete actions", () => {
    const markup = renderToStaticMarkup(
      createElement(ActivityQueue, {
        items: queue([1_000]),
        onReorder: () => undefined,
        onRunNow: () => undefined,
        onEdit: () => undefined,
        onRemove: () => undefined,
      }),
    );

    expect(markup).toContain('aria-label="Reorder queued message"');
    expect(markup).toContain('aria-label="Steer queued message"');
    expect(markup).toContain('aria-label="Delete queued message"');
    expect(markup).toContain("Steer");
  });

  it("places a dragged message between its persisted neighbours", () => {
    expect(queuePositionForIndex(queue([1_000, 5_000, 3_000]), 1)).toBe(2_000);
  });

  it("places a dragged message before or after the persisted queue", () => {
    expect(queuePositionForIndex(queue([3_000, 1_000]), 0)).toBe(999);
    expect(queuePositionForIndex(queue([1_000, 3_000]), 1)).toBe(1_001);
  });
});
