import type { NormRect, Rect } from "./recipe";

/** The canvas fitted inside the preview area, rounded the way Rust rounds it
 * (`preview::contain`), so overlays sit exactly on the native layer. */
export function contain(areaW: number, areaH: number, aspect: number): Rect {
  const [w, h] =
    areaW / areaH > aspect ? [areaH * aspect, areaH] : [areaW, areaW / aspect];
  return {
    x: Math.round((areaW - w) / 2),
    y: Math.round((areaH - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export const FULL: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest crop, as a share of each side. */
export const MIN_CROP = 0.08;

export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

/** Moves or resizes `start` by (dx, dy), in 0..1 units, staying in bounds. */
export function dragCrop(start: NormRect, edge: Edge, dx: number, dy: number): NormRect {
  const { x, y, w, h } = start;
  if (edge === "move") {
    return { x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w, h };
  }
  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;
  if (edge.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP);
  if (edge.includes("e")) right = clamp(right + dx, left + MIN_CROP, 1);
  if (edge.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isFull(r: NormRect | null): boolean {
  return (
    !r ||
    (r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.999 && r.h >= 0.999)
  );
}

/** "1:04.2" */
export function formatTime(seconds: number, tenths = true): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const sec = whole.toString().padStart(2, "0");
  if (!tenths) return `${m}:${sec}`;
  return `${m}:${sec}.${Math.floor((rest - whole) * 10)}`;
}
