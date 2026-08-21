import { describe, expect, it } from "vite-plus/test";
import { completeOnboarding, loadOnboarding, resetOnboarding } from "./onboarding.js";
import type { OnboardingStorage } from "./contracts/onboarding.js";

function memoryStorage(initial: Record<string, string> = {}): OnboardingStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

import type { OnboardingResult } from "./contracts/onboarding.js";

const result: OnboardingResult = {
  name: "Scout",
  color: "#2a92fe",
  shape: "blob",
  tools: ["Airtable"],
};

describe("onboarding state", () => {
  it("reports not onboarded when nothing is stored", async () => {
    expect(await loadOnboarding(memoryStorage())).toEqual({ completed: false });
  });

  it("round-trips a completed result", async () => {
    const storage = memoryStorage();
    await completeOnboarding(storage, result);
    expect(await loadOnboarding(storage)).toEqual({ completed: true, result });
  });

  it("records completion when a client has no agent preferences to save", async () => {
    const storage = memoryStorage();
    await completeOnboarding(storage);
    expect(await loadOnboarding(storage)).toEqual({ completed: true });
  });

  it("treats malformed stored state as not onboarded rather than throwing", async () => {
    expect(await loadOnboarding(memoryStorage({ "openbot.onboarding": "{not json" }))).toEqual({
      completed: false,
    });
    expect(
      await loadOnboarding(memoryStorage({ "openbot.onboarding": '{"completed":"yes"}' })),
    ).toEqual({ completed: false });
  });

  it("still reports completion when storage cannot persist, so boot is never blocked", async () => {
    const failing: OnboardingStorage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    };
    expect(await completeOnboarding(failing, result)).toEqual({ completed: true, result });
    expect(await loadOnboarding(failing)).toEqual({ completed: false });
  });

  it("accepts an async storage, so SecureStore satisfies it unchanged", async () => {
    const values = new Map<string, string>();
    const asyncStorage: OnboardingStorage = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    };
    await completeOnboarding(asyncStorage, result);
    expect((await loadOnboarding(asyncStorage)).completed).toBe(true);
    await resetOnboarding(asyncStorage);
    expect((await loadOnboarding(asyncStorage)).completed).toBe(false);
  });
});
