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

/** A crop shape, as width over height in source pixels. */
export type CropRatio = "free" | "16:9" | "4:3" | "1:1" | "4:5" | "9:16";

export const CROP_RATIOS: readonly CropRatio[] = ["free", "16:9", "4:3", "1:1", "4:5", "9:16"];

/** The ratio in 0..1 crop units: pixel ratio corrected for the source's shape. */
export function normRatio(ratio: CropRatio, sourceW: number, sourceH: number): number | null {
  if (ratio === "free") return null;
  const [a, b] = ratio.split(":").map(Number);
  return (a / b) * (sourceH / sourceW);
}

/** The largest-ish rect of ratio `rn` about the same size and centre as `r`. */
export function fitRatio(r: NormRect, rn: number): NormRect {
  let w = Math.sqrt(r.w * r.h * rn);
  let h = w / rn;
  const shrink = Math.min(1, 1 / w, 1 / h);
  w *= shrink;
  h *= shrink;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Like `dragCrop`, keeping the shape at ratio `rn` (crop units). Corners
 * grow from the opposite corner; edges grow from the opposite edge, centred. */
export function dragCropLocked(start: NormRect, edge: Edge, dx: number, dy: number, rn: number): NormRect {
  if (edge === "move") return dragCrop(start, edge, dx, dy);
  const minW = Math.max(MIN_CROP, MIN_CROP * rn);
  const right = edge.includes("e");
  const down = edge.includes("s");
  if (edge.length === 2) {
    const ax = right ? start.x : start.x + start.w;
    const ay = down ? start.y : start.y + start.h;
    const wantW = start.w + (right ? dx : -dx);
    const wantH = start.h + (down ? dy : -dy);
    const roomW = right ? 1 - ax : ax;
    const roomH = down ? 1 - ay : ay;
    const w = clamp(Math.max(wantW, wantH * rn), minW, Math.min(roomW, roomH * rn));
    const h = w / rn;
    return { x: right ? ax : ax - w, y: down ? ay : ay - h, w, h };
  }
  if (edge === "n" || edge === "s") {
    const ay = down ? start.y : start.y + start.h;
    const roomH = down ? 1 - ay : ay;
    const h = clamp(start.h + (down ? dy : -dy), minW / rn, Math.min(roomH, 1 / rn));
    const w = h * rn;
    const x = clamp(start.x + start.w / 2 - w / 2, 0, 1 - w);
    return { x, y: down ? ay : ay - h, w, h };
  }
  const ax = right ? start.x : start.x + start.w;
  const roomW = right ? 1 - ax : ax;
  const w = clamp(start.w + (right ? dx : -dx), minW, Math.min(roomW, rn));
  const h = w / rn;
  const y = clamp(start.y + start.h / 2 - h / 2, 0, 1 - h);
  return { x: right ? ax : ax - w, y, w, h };
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
