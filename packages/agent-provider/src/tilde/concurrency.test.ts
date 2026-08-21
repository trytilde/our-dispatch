import { describe, expect, it } from "vite-plus/test";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves result order while running no more than ten operations at once", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirstWave!: () => void;
    const firstWave = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    const values = Array.from({ length: 12 }, (_, index) => index);

    const resultPromise = mapWithConcurrency(values, 10, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (value < 10) await firstWave;
      active -= 1;
      return value * 2;
    });

    expect(active).toBe(10);
    expect(maximumActive).toBe(10);
    releaseFirstWave();
    await expect(resultPromise).resolves.toEqual(values.map((value) => value * 2));
    expect(maximumActive).toBe(10);
  });
});
