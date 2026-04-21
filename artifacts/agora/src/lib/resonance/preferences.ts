/**
 * Single opt-in flag that gates every Resonance feature in the app.
 * Stored in localStorage so it survives reloads but never crosses the
 * relay boundary. Default is OFF — a user who never enables Resonance
 * Mode sees zero changes to the existing forum experience.
 */

import { useEffect, useState } from "react";

const RESONANCE_MODE_KEY = "agora.resonance.mode.v1";

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function getResonanceMode(): boolean {
  try {
    return localStorage.getItem(RESONANCE_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setResonanceMode(value: boolean): void {
  try {
    localStorage.setItem(RESONANCE_MODE_KEY, value ? "true" : "false");
  } catch {
    /* ignore quota errors */
  }
  notify();
}

/**
 * Subscribes to Resonance Mode changes so any UI that gates on it
 * re-renders the moment the toggle flips.
 */
export function useResonanceMode(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => getResonanceMode());
  useEffect(() => {
    const fn = () => setEnabled(getResonanceMode());
    listeners.add(fn);
    // Also listen to cross-tab changes.
    const onStorage = (e: StorageEvent) => {
      if (e.key === RESONANCE_MODE_KEY) setEnabled(getResonanceMode());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return enabled;
}
