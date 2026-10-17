/** Draws a scene with canvas, the way `src-tauri/src/render.rs` composes it
 * with Core Image: background, shadow, rounded card, browser bar, camera. */
import type { Clip } from "./clip";
import type { FullScene, Rgb } from "./scene";

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

const images = new Map<string, HTMLImageElement>();

/** Pictures used as backgrounds. `onLoad` runs once one is ready to draw. */
function picture(path: string, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    images.set(path, img);
  }
  if (img.complete && img.naturalWidth) return img;
  img.addEventListener("load", onLoad, { once: true });
  return null;
}

/**
 * `ctx` is already scaled so one unit is one scene pixel.
 * `onLoad` asks for another frame once a background picture arrives.
 */
export function compose(ctx: CanvasRenderingContext2D, scene: FullScene, clip: Clip, t: number, onLoad: () => void = () => {}) {
  const { width: w, height: h } = scene;
  const f = scene.fill;
  if (f.kind === "gradient") {
    // Top-left to bottom-right.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, css(f.from));
    g.addColorStop(1, css(f.to));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (f.kind === "solid") {
    ctx.fillStyle = css(f.color);
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = "#111113";
    ctx.fillRect(0, 0, w, h);
    const img = picture(f.path, onLoad);
    if (img) {
      // Scaled to cover the canvas, centred.
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s;
      const ih = img.naturalHeight * s;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
  }

  const { card, video, radius } = scene;
  if (scene.shadow) {
    ctx.save();
    // Core Image blurs by sigma; canvas's shadowBlur is twice that.
    const k = ctx.getTransform().a;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.opacity})`;
    ctx.shadowBlur = scene.shadow.blur * 2 * k;
    ctx.shadowOffsetY = scene.shadow.offsetY * k;
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, card.w, card.h, radius);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, radius);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(video.x, video.y, video.w, video.h);
  clip.draw(ctx, t, scene.sourceCrop, video);

  const frame = scene.frame;
  if (frame) {
    const [bar, pill, label] = frame.dark ? ["#2B2B2F", "#1C1C1F", "#A1A1A8"] : ["#EDEDF0", "#FFFFFF", "#6B6B73"];
    ctx.fillStyle = bar;
    ctx.fillRect(frame.bar.x, frame.bar.y, frame.bar.w, frame.bar.h);
    frame.dots.forEach((d, i) => {
      ctx.beginPath();
      ctx.arc(d.x, d.y, frame.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = ["#FF5F57", "#FEBC2E", "#28C840"][i];
      ctx.fill();
    });
    const p = frame.pill;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, p.h / 2);
    ctx.fillStyle = pill;
    ctx.fill();
    if (frame.text) {
      ctx.font = `${frame.fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = label;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Too long for the pill: cut with an ellipsis.
      const room = p.w - p.h;
      let s = frame.text;
      if (ctx.measureText(s).width > room) {
        while (s.length > 1 && ctx.measureText(`${s}…`).width > room) s = s.slice(0, -1);
        s = `${s}…`;
      }
      ctx.fillText(s, p.x + p.w / 2, p.y + p.h / 2 + frame.fontSize * 0.04);
    }
  }
  ctx.restore();

  const cam = scene.camera;
  if (cam && clip.hasCamera) {
    const { x: cx, y: cy } = cam.center;
    ctx.save();
    const k = ctx.getTransform().a;
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = cam.ring * 6 * k;
    ctx.shadowOffsetY = cam.ring * k;
    ctx.beginPath();
    ctx.arc(cx, cy, cam.radius + cam.ring, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.restore();
    clip.drawCamera(ctx, t, cx, cy, cam.radius);
  }
}
