/** A line-for-line port of `src-tauri/src/scene.rs`: the layout a recipe
 * produces, in output pixels. Keep the two in step. */
import type { Recipe, Rect } from "../../../src/lib/recipe";

export type Rgb = { r: number; g: number; b: number };

export type Fill =
  | { kind: "solid"; color: Rgb }
  | { kind: "gradient"; from: Rgb; to: Rgb }
  | { kind: "image"; path: string };

export type FrameLayout = {
  bar: Rect;
  dots: { x: number; y: number }[];
  dotRadius: number;
  pill: Rect;
  text: string;
  fontSize: number;
  dark: boolean;
};

export type CameraLayout = { center: { x: number; y: number }; radius: number; ring: number };

export type Shadow = { offsetY: number; blur: number; opacity: number };

export type Source = { width: number; height: number; hasCamera: boolean };

export type FullScene = {
  width: number;
  height: number;
  fill: Fill;
  card: Rect;
  video: Rect;
  sourceCrop: Rect;
  radius: number;
  shadow: Shadow | null;
  frame: FrameLayout | null;
  camera: CameraLayout | null;
  plain: boolean;
  fps: number;
};

const MAX_LONG = 1920;
const MAX_SHORT = 1080;
const BAR = 0.042;

export const hex = (v: number): Rgb => ({ r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 });

function parse(s: string): Rgb | null {
  return /^#[0-9a-f]{6}$/i.test(s) ? hex(parseInt(s.slice(1), 16)) : null;
}

const PRESETS: Record<string, Fill> = {
  dawn: { kind: "gradient", from: hex(0xf9c6e0), to: hex(0xa9c2f0) },
  seaGlass: { kind: "gradient", from: hex(0xa8e6e2), to: hex(0xf6d6e4) },
  apricot: { kind: "gradient", from: hex(0xf7d58b), to: hex(0xf4a28c) },
  sage: { kind: "gradient", from: hex(0xdce8d2), to: hex(0x9db89a) },
  dusk: { kind: "gradient", from: hex(0x232a47), to: hex(0x5e4a8c) },
  graphite: { kind: "gradient", from: hex(0x3a3a3d), to: hex(0x161618) },
  paper: { kind: "solid", color: hex(0xf3f0ea) },
  ink: { kind: "solid", color: hex(0x111113) },
};

function fillOf(bg: Recipe["style"]["background"]): Fill {
  switch (bg.kind) {
    case "preset":
      return PRESETS[bg.id] ?? PRESETS.dawn;
    case "solid":
      return { kind: "solid", color: parse(bg.color) ?? hex(0x111113) };
    case "image":
      return { kind: "image", path: bg.path };
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function even(v: number): number {
  const n = Math.max(Math.round(v), 2);
  return n + (n & 1);
}

function fitMax(aspect: number): [number, number] {
  const [bw, bh] = aspect >= 1 ? [MAX_LONG, MAX_SHORT] : [MAX_SHORT, MAX_LONG];
  const [w, h] = bw / bh > aspect ? [bh * aspect, bh] : [bw, bw / aspect];
  return [even(w), even(h)];
}

function contain(area: Rect, aspect: number): Rect {
  const [w, h] = area.w / area.h > aspect ? [area.h * aspect, area.h] : [area.w, area.w / aspect];
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

function cropRect(recipe: Recipe, src: Source): Rect {
  const c = recipe.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = clamp(c.x, 0, 1);
  const y = clamp(c.y, 0, 1);
  const w = clamp(c.w, 0.01, 1 - x);
  const h = clamp(c.h, 0.01, 1 - y);
  return { x: x * src.width, y: y * src.height, w: w * src.width, h: h * src.height };
}

export function buildScene(recipe: Recipe, src: Source): FullScene {
  const crop = cropRect(recipe, src);
  const videoAspect = crop.w / crop.h;
  const framed = recipe.frame.enabled;
  const cardAspect = framed ? 1 / (1 / videoAspect + BAR) : videoAspect;
  const pad = clamp(recipe.style.padding, 0, 1) * 0.16;

  const autoPad = pad * Math.min(cardAspect, 1);
  const [width, height] = (() => {
    switch (recipe.output.aspect) {
      case "auto":
        return fitMax((cardAspect + 2 * autoPad) / (1 + 2 * autoPad));
      case "16:9":
        return [1920, 1080];
      case "1:1":
        return [1080, 1080];
      case "4:3":
        return [1440, 1080];
      case "4:5":
        return [1080, 1350];
    }
  })();
  const w = width;
  const h = height;
  const short = Math.min(w, h);

  let card: Rect;
  if (recipe.output.aspect === "auto") {
    const scale = Math.min(w / (cardAspect + 2 * autoPad), h / (1 + 2 * autoPad));
    const cw = cardAspect * scale;
    const ch = scale;
    card = { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
  } else {
    const p = pad * short;
    card = contain({ x: p, y: p, w: w - 2 * p, h: h - 2 * p }, cardAspect);
  }

  const barH = framed ? card.w * BAR : 0;
  const video = { x: card.x, y: card.y + barH, w: card.w, h: card.h - barH };

  const radius = Math.min(clamp(recipe.style.radius, 0, 1) * 0.045 * short, Math.min(card.w, card.h) / 2);
  const shadow = recipe.style.shadow ? { offsetY: 0.012 * short, blur: 0.022 * short, opacity: 0.32 } : null;

  let frame: FrameLayout | null = null;
  if (framed) {
    const cy = card.y + barH / 2;
    const first = card.x + barH * 0.55;
    const gap = barH * 0.46;
    const pillH = barH * 0.6;
    const pillW = Math.min(Math.max(card.w * 0.42, pillH * 4), card.w - barH * 5);
    frame = {
      bar: { x: card.x, y: card.y, w: card.w, h: barH },
      dots: [0, 1, 2].map((i) => ({ x: first + gap * i, y: cy })),
      dotRadius: barH * 0.15,
      pill: { x: card.x + (card.w - pillW) / 2, y: cy - pillH / 2, w: pillW, h: pillH },
      text: recipe.frame.url.trim(),
      fontSize: barH * 0.34,
      dark: recipe.frame.dark,
    };
  }

  let camera: CameraLayout | null = null;
  if (src.hasCamera && recipe.camera.visible) {
    const r = (0.07 + clamp(recipe.camera.size, 0, 1) * 0.08) * short;
    const margin = 0.035 * short + r;
    const [x, y] = {
      topLeft: [margin, margin],
      topRight: [w - margin, margin],
      bottomLeft: [margin, h - margin],
      bottomRight: [w - margin, h - margin],
    }[recipe.camera.corner];
    camera = { center: { x, y }, radius: r, ring: Math.max(0.006 * short, 2) };
  }

  return {
    width,
    height,
    fill: fillOf(recipe.style.background),
    card,
    video,
    sourceCrop: crop,
    radius,
    shadow,
    frame,
    camera,
    plain: false,
    fps: recipe.output.fps,
  };
}

/** The whole source frame and nothing else, for drawing the crop on top. */
export function plainScene(src: Source, fps: number): FullScene {
  const [width, height] = fitMax(src.width / src.height);
  const full = { x: 0, y: 0, w: width, h: height };
  return {
    width,
    height,
    fill: { kind: "solid", color: hex(0) },
    card: full,
    video: full,
    sourceCrop: { x: 0, y: 0, w: src.width, h: src.height },
    radius: 0,
    shadow: null,
    frame: null,
    camera: null,
    plain: true,
    fps,
  };
}
