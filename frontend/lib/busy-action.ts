"use client";

import { useRef, useState } from "react";

// Returned by an action that hands the page over to a navigation. The control
// that started it stays busy instead of flicking back to idle for the frames
// between the successful response and the new route painting.
export const keepBusyUntilNavigation = "keep-busy-until-navigation";

export type BusyActionOutcome = void | typeof keepBusyUntilNavigation;

export type BusyAction = {
  isRunning: () => boolean;
  run: (action: () => Promise<BusyActionOutcome> | BusyActionOutcome) => Promise<void>;
};

// The in-flight flag lives in a plain box rather than React state on purpose.
// A second click can land in the same tick as the first, before React has
// re-rendered the button as disabled, and every handler closure created by that
// first render would still read "idle" from state. A box is written
// synchronously before the first await, so the second call sees the first one.
export function createBusyAction(setBusy: (busy: boolean) => void): BusyAction {
  const running = { current: false };

  return {
    isRunning: () => running.current,
    run: async (action) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      let holdBusy = false;
      try {
        holdBusy = (await action()) === keepBusyUntilNavigation;
      } finally {
        // A rejected action releases the control so the person can correct
        // whatever failed and try again.
        if (!holdBusy) {
          running.current = false;
          setBusy(false);
        }
      }
    },
  };
}

// One async control per hook: `busy` drives the button, `run` guards the work.
export function useBusyAction(): BusyAction & { busy: boolean } {
  const [busy, setBusy] = useState(false);
  const action = useRef<BusyAction | null>(null);
  if (!action.current) action.current = createBusyAction(setBusy);
  return { busy, run: action.current.run, isRunning: action.current.isRunning };
}
