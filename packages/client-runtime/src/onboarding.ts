import {
  onboardingStateSchema,
  type OnboardingResult,
  type OnboardingState,
  type OnboardingStorage,
} from "./contracts/onboarding.js";

const storageKey = "openbot.onboarding";

const notOnboarded: OnboardingState = { completed: false };

/**
 * Reads persisted onboarding state. A missing, malformed, or unreadable value reports
 * "not onboarded" rather than throwing: a storage failure must never block boot, and a
 * client that cannot persist still needs a defined answer.
 */
export async function loadOnboarding(storage: OnboardingStorage): Promise<OnboardingState> {
  try {
    const raw = await storage.getItem(storageKey);
    if (!raw) return notOnboarded;
    const parsed = onboardingStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : notOnboarded;
  } catch {
    return notOnboarded;
  }
}

/** Records completion. Returns the state the caller should render, persisted or not. */
export async function completeOnboarding(
  storage: OnboardingStorage,
  result?: OnboardingResult,
): Promise<OnboardingState> {
  const state: OnboardingState = { completed: true, ...(result ? { result } : {}) };
  try {
    await storage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // A non-persistent environment still proceeds into the app for this session.
  }
  return state;
}

/** Clears onboarding so the next launch runs first-run again. */
export async function resetOnboarding(storage: OnboardingStorage): Promise<void> {
  try {
    await storage.removeItem?.(storageKey);
  } catch {
    // Nothing to do: the caller only asked for a best-effort reset.
  }
}
