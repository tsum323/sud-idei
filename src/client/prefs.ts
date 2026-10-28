"use client";

export interface Prefs {
  concurrency: number;
  confirmPaid: boolean;
  /** Экономный режим (страница на claude.ai): агенты на быстрой модели. */
  economy: boolean;
}

const PREFS_KEY = "ai-court:prefs";
export const DEFAULT_PREFS: Prefs = { concurrency: 3, confirmPaid: true, economy: false };

export function safeStorage<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadPrefs(): Prefs {
  return safeStorage(() => ({ ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }), DEFAULT_PREFS);
}

export function savePrefs(p: Prefs) {
  safeStorage(() => localStorage.setItem(PREFS_KEY, JSON.stringify(p)), undefined);
}

