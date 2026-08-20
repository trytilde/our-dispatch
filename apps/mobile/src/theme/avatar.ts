export const MOBILE_AVATAR_PALETTE = [
  "#FF5A5F",
  "#FF8A3D",
  "#FFC53D",
  "#7ED957",
  "#2FD07A",
  "#22D3C5",
  "#38BDF8",
  "#4F7CFF",
  "#A66BFF",
  "#FF5FA8",
] as const;

export const MOBILE_ONBOARDING_CAST = [
  { id: "triage", color: MOBILE_AVATAR_PALETTE[0], shape: "pebble", label: "Inbox triage" },
  { id: "checks", color: MOBILE_AVATAR_PALETTE[5], shape: "cloud", label: "Nightly checks" },
  { id: "cleanup", color: MOBILE_AVATAR_PALETTE[7], shape: "hex", label: "Data cleanup" },
] as const;
