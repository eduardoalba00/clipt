/** What a take plays: a recording of the pretend desktop, or a real video. */
import type { Rect } from "../../../src/lib/recipe";
import { drawCursor, drawFace, drawSample, type Point } from "./sample";

export interface Clip {
  /** Source pixels. */
  width: number;
  height: number;
  duration: number;
  hasCamera: boolean;
  /** Draws the source pixels `crop` at time `t` into `dest`. */
  draw(ctx: CanvasRenderingContext2D, t: number, crop: Rect, dest: Rect): void;
  drawCamera(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, r: number): void;
  /** Set when a <video> backs the clip; the player keeps it in time. */
  video?: HTMLVideoElement;
}

/** Recordings are made on a Retina screen. */
export const SCALE = 2;

export const MENU_BAR = 24;

export type CursorSample = { t: number; x: number; y: number };

let wallpaper: HTMLImageElement | null = null;

export function setWallpaper(img: HTMLImageElement) {
  wallpaper = img;
}

const APPLE = new Path2D(
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
);

function drawMenuBar(ctx: CanvasRenderingContext2D, width: number) {
  ctx.save();
  ctx.fillStyle = "rgba(8,10,22,0.45)";
  ctx.fillRect(0, 0, width, MENU_BAR);
  ctx.fillStyle = "#fff";
  ctx.save();
  ctx.translate(17, 5);
  ctx.scale(14 / 24, 14 / 24);
  ctx.fill(APPLE);
  ctx.restore();
  ctx.textBaseline = "middle";
  let x = 45;
  ["Clipt", "File", "Edit", "Window"].forEach((label, i) => {
    ctx.font = `${i ? 400 : 700} 13px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(label, x, MENU_BAR / 2);
    x += ctx.measureText(label).width + 18;
  });
  ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "right";
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  ctx.fillText(`${day}  ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`, width - 12, MENU_BAR / 2);
  ctx.restore();
}

/** Draws the pretend desktop in points: wallpaper, menu bar, the app window, the pointer. */
function drawDesktop(
  ctx: CanvasRenderingContext2D,
  screen: { w: number; h: number },
  sample: Rect | null,
  sampleTime: number,
  cursor: Point | null,
) {
  if (wallpaper?.complete && wallpaper.naturalWidth) {
    const s = Math.max(screen.w / wallpaper.naturalWidth, screen.h / wallpaper.naturalHeight);
    const w = wallpaper.naturalWidth * s;
    const h = wallpaper.naturalHeight * s;
    ctx.drawImage(wallpaper, (screen.w - w) / 2, (screen.h - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#101426";
    ctx.fillRect(0, 0, screen.w, screen.h);
  }
  drawMenuBar(ctx, screen.w);
  if (sample) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    ctx.beginPath();
    ctx.roundRect(sample.x, sample.y, sample.w, sample.h, 12);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(sample.x, sample.y);
    const local = cursor ? { x: cursor.x - sample.x, y: cursor.y - sample.y } : null;
    drawSample(ctx, sampleTime, sample.w, sample.h, local);
    ctx.restore();
  }
  if (cursor) drawCursor(ctx, cursor.x, cursor.y);
}

/** Where the pointer was at `t`, from samples taken while recording. */
function cursorAt(samples: CursorSample[], t: number): Point | null {
  if (!samples.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[hi].t) return samples[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** A recording of part of the pretend screen. Exactly what was on screen,
 * pointer included, redrawn at any size. */
export class ScreenClip implements Clip {
  width: number;
  height: number;

  constructor(
    /** What was recorded, in screen points. */
    readonly region: Rect,
    readonly screen: { w: number; h: number },
    readonly sample: Rect | null,
    /** How long the app window had been open when recording began. */
    readonly sampleOffset: number,
    readonly cursor: CursorSample[],
    readonly duration: number,
    readonly hasCamera: boolean,
  ) {
    this.width = Math.round(region.w * SCALE);
    this.height = Math.round(region.h * SCALE);
  }

  draw(ctx: CanvasRenderingContext2D, t: number, crop: Rect, dest: Rect) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(dest.x, dest.y, dest.w, dest.h);
    ctx.clip();
    ctx.translate(dest.x, dest.y);
    ctx.scale(dest.w / crop.w, dest.h / crop.h);
    ctx.translate(-crop.x, -crop.y);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-this.region.x, -this.region.y);
    drawDesktop(ctx, this.screen, this.sample, t + this.sampleOffset, cursorAt(this.cursor, t));
    ctx.restore();
  }

  drawCamera(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, r: number) {
    drawFace(ctx, t, cx, cy, r);
  }
}

/** A real video: dropped on the window, or the demo clip from config. */
export class VideoClip implements Clip {
  width: number;
  height: number;
  duration: number;
  hasCamera = false;

  constructor(readonly video: HTMLVideoElement) {
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.duration = video.duration;
  }

  /** Seconds into the video. */
  time(): number {
    return this.video.currentTime;
  }

  seek(t: number) {
    this.video.currentTime = t;
  }

  play() {
    void this.video.play().catch(() => {});
  }

  pause() {
    this.video.pause();
  }

  draw(ctx: CanvasRenderingContext2D, _t: number, crop: Rect, dest: Rect) {
    if (this.video.readyState < 2) return;
    ctx.drawImage(this.video, crop.x, crop.y, crop.w, crop.h, dest.x, dest.y, dest.w, dest.h);
  }

  drawCamera() {}
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("Clipt couldn't read that video"));
  });
}

export async function openVideo(url: string): Promise<VideoClip> {
  const video = await loadVideo(url);
  if (!Number.isFinite(video.duration) || !video.videoWidth) throw new Error("Clipt couldn't read that video");
  return new VideoClip(video);
}

let shown: string[] = [];

/** `count` evenly spaced frames, `height` pixels tall, as image URLs
 * (blob URLs, so each is distinct, like the files Clipt writes). */
export async function thumbnails(clip: Clip, count: number, height: number): Promise<string[]> {
  const canvas = document.createElement("canvas");
  canvas.height = height * 2;
  canvas.width = Math.max(2, Math.round((canvas.height * clip.width) / clip.height));
  const ctx = canvas.getContext("2d")!;
  const full = { x: 0, y: 0, w: clip.width, h: clip.height };
  const dest = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  // A separate element, so seeking doesn't disturb playback.
  const video = clip.video ? await loadVideo(clip.video.src) : null;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * clip.duration;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (video) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      clip.draw(ctx, t, full, dest);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    out.push(blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.72));
  }
  for (const url of shown) URL.revokeObjectURL(url);
  shown = out;
  return out;
}
