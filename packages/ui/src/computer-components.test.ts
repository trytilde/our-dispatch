import { describe, expect, it } from "vite-plus/test";
import { getComputerRebuildProgress } from "./computer-components.js";

describe("getComputerRebuildProgress", () => {
  it("maps update phases and image download progress", () => {
    const progress = getComputerRebuildProgress({
      kind: "update",
      stage: "downloading",
      pullPercent: 50,
    });

    expect(progress.activeIndex).toBe(2);
    expect(progress.progress).toBe(2.5 / 6);
    expect(progress.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
      "pending",
    ]);
    expect(progress.steps[2]?.label).toBe("Recreating OpenBot's computer");
  });

  it("keeps a reset cleanup after the migrated data steps", () => {
    const progress = getComputerRebuildProgress({
      kind: "reset",
      stage: "tearingDown",
      migrationStatus: "cleaning-up",
      migrationPhases: ["wiping", "creating", "moving"],
    });

    expect(progress.activeIndex).toBe(4);
    expect(progress.steps[4]).toEqual({ label: "Cleaning up", state: "active" });
  });

  it("uses the compact four-step recovery flow", () => {
    const progress = getComputerRebuildProgress({
      kind: "recover",
      stage: "finishing",
      migrationStatus: "done",
      migrationPhases: ["creating", "moving", "cleaning-up"],
    });

    expect(progress.progress).toBe(3 / 4);
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Getting ready",
      "Recreating OpenBot's computer",
      "Starting OpenBot's computer",
      "Reconnecting",
    ]);
  });

  it("clamps image download progress to one phase", () => {
    const progress = getComputerRebuildProgress({
      kind: "update",
      stage: "downloading",
      pullPercent: 180,
    });

    expect(progress.progress).toBe(3 / 6);
  });
});
