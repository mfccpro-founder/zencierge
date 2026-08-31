import type { MouseEvent, PointerEvent } from "react";

function runOnceOnTarget(target: EventTarget | null, handler: () => void) {
  const node = target instanceof HTMLElement ? target : null;
  const now = Date.now();
  const prev = node ? Number(node.dataset.pressAt ?? 0) : 0;
  if (now - prev < 400) return;
  if (node) node.dataset.pressAt = String(now);
  handler();
}

/**
 * Fires once per tap on mobile (pointer) and once per click on desktop,
 * without double-invoking when both events occur.
 */
export function withMobilePress(handler: () => void) {
  return {
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        event.stopPropagation();
        runOnceOnTarget(event.currentTarget, handler);
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      runOnceOnTarget(event.currentTarget, handler);
    },
  };
}

export const guestPressClass =
  "relative z-20 min-h-11 cursor-pointer touch-manipulation pointer-events-auto select-none";
