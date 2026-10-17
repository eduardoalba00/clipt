/** Where things sit on the pretend screen, in CSS pixels ("points"). */
import type { Rect } from "../../../src/lib/recipe";
import { MENU_BAR } from "./clip";

/** Kept clear at the bottom for the download bar, like the Dock. Short
 * screens drop its second line to leave Clipt's editor room. */
export const dockHeight = () => (window.innerHeight < 760 ? 80 : 128);

export const LAUNCHER = { w: 340, h: 404 };
export const EDITOR = { w: 1200, h: 780 };
export const EDITOR_MIN = { w: 860, h: 520 };

export function screenSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

/** The screen minus the menu bar and the Dock. */
export function visibleFrame(): Rect {
  const { w, h } = screenSize();
  return { x: 0, y: MENU_BAR, w, h: Math.max(h - MENU_BAR - dockHeight(), 200) };
}

/** A window of this size, centred in the visible frame and kept on it. */
export function centred(size: { w: number; h: number }): Rect {
  const v = visibleFrame();
  const w = Math.min(size.w, v.w - 24);
  const h = Math.min(size.h, v.h - 16);
  return { x: Math.round(v.x + (v.w - w) / 2), y: Math.round(v.y + (v.h - h) / 2), w, h };
}

/** The pretend app that gets recorded. */
export function sampleRect(): Rect {
  const v = visibleFrame();
  return centred({ w: Math.min(1040, v.w * 0.72), h: Math.min(660, v.h * 0.8) });
}
