/**
 * The pretend Mac: what's on screen besides Clipt's own page, and what Clipt's
 * "Rust side" is doing. Clipt's components never see this directly; they talk
 * to the fake `ipc` (shims/ipc.ts), which drives it.
 */
import { useRef, useSyncExternalStore } from "react";
import type { Permissions, RecordKind } from "../../../src/lib/ipc";
import type { Recipe, Rect } from "../../../src/lib/recipe";
import type { Clip } from "./clip";

export type WindowId = "clipt" | "finder" | "about" | "quicklook" | "sample";

/** A finished export, as it sits in ~/Movies/Clipt. */
export type Recording = {
  name: string;
  created: number;
  recipe: Recipe;
  clip: Clip;
  thumb: string;
};

export type Target =
  | { kind: "screen" }
  | { kind: "window"; rect: Rect }
  | { kind: "area"; rect: Rect };

export type Phase =
  | { kind: "idle" }
  | { kind: "selecting" }
  | { kind: "picking"; mode: "screen" | "window" }
  | { kind: "recording"; target: Target; started: number; mic: boolean; camera: boolean; source: RecordKind };

export type Prompt = { what: keyof Permissions; answer: (allow: boolean) => void };

export type Desktop = {
  /** Clipt is open (it lives in the menu bar). */
  running: boolean;
  /** Bumped on every launch, to start Clipt's page fresh. */
  launch: number;
  cliptVisible: boolean;
  mode: "launcher" | "editor";
  zoomed: boolean;
  /** Windows that are open, back to front. */
  stack: WindowId[];
  /** The app whose menus show: Clipt, or Finder (the desktop). */
  active: "clipt" | "finder";
  phase: Phase;
  permissions: Permissions;
  prompt: Prompt | null;
  recordings: Recording[];
  selected: string | null;
  quicklook: Recording | null;
};

const initial: Desktop = {
  running: true,
  launch: 0,
  cliptVisible: true,
  mode: "launcher",
  zoomed: false,
  stack: ["clipt"],
  active: "clipt",
  phase: { kind: "idle" },
  // Screen recording is already allowed, so the demo starts on the launcher.
  permissions: { screen: "granted", mic: "notAsked", camera: "notAsked" },
  prompt: null,
  recordings: [],
  selected: null,
  quicklook: null,
};

let state = initial;
const listeners = new Set<() => void>();

export const desktop = {
  get: () => state,
  set(patch: Partial<Desktop> | ((s: Desktop) => Partial<Desktop>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/** Part of the desktop's state; re-renders only when that part changes. */
export function useDesktop<T>(pick: (s: Desktop) => T): T {
  const last = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(desktop.subscribe, () => {
    const next = pick(state);
    if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  });
}

/** Brings a window to the front (opening it if needed). */
export function raise(id: WindowId) {
  desktop.set((s) => ({
    stack: [...s.stack.filter((w) => w !== id), id],
    active: id === "clipt" || id === "about" ? "clipt" : "finder",
  }));
}

export function close(id: WindowId) {
  desktop.set((s) => {
    const stack = s.stack.filter((w) => w !== id);
    const top = stack[stack.length - 1];
    return { stack, active: top === "clipt" || top === "about" ? "clipt" : "finder" };
  });
}

/** Clipt's window: shown and in front, or hidden (it stays in the menu bar). */
export function showClipt(): void {
  if (!state.running) return launch();
  desktop.set({ cliptVisible: true });
  raise("clipt");
}

/** Hides the window. Clipt stays the active app, as when its last window closes. */
export function hideClipt() {
  desktop.set((s) => ({ cliptVisible: false, stack: s.stack.filter((w) => w !== "clipt") }));
}

export function launch(): void {
  if (state.running) return showClipt();
  desktop.set((s) => ({ running: true, launch: s.launch + 1, cliptVisible: true, mode: "launcher", zoomed: false }));
  raise("clipt");
}
