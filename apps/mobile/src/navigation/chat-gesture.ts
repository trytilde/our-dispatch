export function shouldClaimChatBackSwipe(deltaX: number, deltaY: number): boolean {
  return deltaX < -16 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;
}

export function shouldFinishChatBackSwipe(deltaX: number, velocityX: number): boolean {
  return deltaX < -84 || velocityX < -0.55;
}
