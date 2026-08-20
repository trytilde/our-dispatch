import { describe, expect, it } from "vite-plus/test";
import { shouldClaimChatBackSwipe, shouldFinishChatBackSwipe } from "./chat-gesture";

describe("mobile chat back gesture", () => {
  it("claims a deliberate left swipe without stealing vertical chat scrolling", () => {
    expect(shouldClaimChatBackSwipe(-40, 8)).toBe(true);
    expect(shouldClaimChatBackSwipe(-18, 40)).toBe(false);
    expect(shouldClaimChatBackSwipe(40, 8)).toBe(false);
  });

  it("returns to the chat list for enough distance or velocity", () => {
    expect(shouldFinishChatBackSwipe(-90, -0.2)).toBe(true);
    expect(shouldFinishChatBackSwipe(-30, -0.7)).toBe(true);
    expect(shouldFinishChatBackSwipe(-30, -0.2)).toBe(false);
  });
});
