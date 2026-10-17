/**
 * Undo and redo for the edit recipe. Discrete edits `apply` a new recipe.
 * Drags (sliders, trim handles, the crop box) `preview` as they go and
 * `commit` once at the end, so one gesture is one undo step.
 */
import { useSyncExternalStore } from "react";
import { sameRecipe, type Recipe } from "./recipe";

type State = {
  past: Recipe[];
  present: Recipe | null;
  future: Recipe[];
  /** The recipe when the current gesture started. */
  base: Recipe | null;
};

const LIMIT = 200;

let state: State = { past: [], present: null, future: [], base: null };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

export const history = {
  get: () => state,

  reset(recipe: Recipe | null) {
    set({ past: [], present: recipe, future: [], base: null });
  },

  apply(recipe: Recipe) {
    const { present } = state;
    if (present && sameRecipe(present, recipe)) return;
    set({
      past: present ? [...state.past, present].slice(-LIMIT) : state.past,
      present: recipe,
      future: [],
      base: null,
    });
  },

  /** A step of a gesture: shown, not yet an undo step. */
  preview(recipe: Recipe) {
    set({ ...state, base: state.base ?? state.present, present: recipe });
  },

  commit() {
    const { base, present } = state;
    if (!base || !present) return set({ ...state, base: null });
    if (sameRecipe(base, present)) return set({ ...state, base: null });
    set({
      past: [...state.past, base].slice(-LIMIT),
      present,
      future: [],
      base: null,
    });
  },

  undo() {
    const { past, present } = state;
    if (!past.length || !present) return;
    set({
      past: past.slice(0, -1),
      present: past[past.length - 1],
      future: [present, ...state.future],
      base: null,
    });
  },

  redo() {
    const { future, present } = state;
    if (!future.length || !present) return;
    set({
      past: [...state.past, present],
      present: future[0],
      future: future.slice(1),
      base: null,
    });
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useHistory(): State {
  return useSyncExternalStore(history.subscribe, history.get);
}
