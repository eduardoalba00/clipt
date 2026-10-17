/**
 * The pretend app that gets recorded: a browser window with a small
 * analytics dashboard that keeps moving. Drawn with canvas so the same
 * pixels show on the desktop and, later, in the take.
 */

export type Point = { x: number; y: number };

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const INDIGO = "#5b5bf0";
const INK = "#1d1d22";
const MUTED = "#8a8a96";
const LINE = "#ececf1";

const ease = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}

const inside = (p: Point | null, x: number, y: number, w: number, h: number) =>
  !!p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

const STATS = [
  { label: "Revenue", value: 48210, format: (v: number) => `$${(v / 1000).toFixed(1)}k`, delta: "+12.4%" },
  { label: "Active users", value: 12480, format: (v: number) => Math.round(v).toLocaleString("en-US"), delta: "+8.1%" },
  { label: "Conversion", value: 3.86, format: (v: number) => `${v.toFixed(2)}%`, delta: "+0.6%" },
  { label: "Avg. session", value: 412, format: (v: number) => `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`, delta: "+3.2%" },
];

const FEED = [
  { who: "Maya", what: "upgraded to Pro", color: "#f59e8b" },
  { who: "Leo", what: "invited 3 teammates", color: "#7cc4f7" },
  { who: "Ana", what: "exported a report", color: "#9ad9a6" },
  { who: "Sam", what: "created a dashboard", color: "#c7a6f5" },
  { who: "Kai", what: "connected Stripe", color: "#f7c873" },
];

/** A smooth, fixed series for the chart. */
function series(i: number): number {
  return 0.42 + 0.18 * Math.sin(i * 0.55) + 0.1 * Math.sin(i * 1.7 + 1) + i * 0.012;
}

/** Draws the whole window, origin at its top-left, `w` x `h` points. */
export function drawSample(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, cursor: Point | null) {
  ctx.save();
  rounded(ctx, 0, 0, w, h, 12);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Browser bar.
  const bar = 44;
  ctx.fillStyle = "#f4f4f6";
  ctx.fillRect(0, 0, w, bar);
  ctx.fillStyle = "#e3e3e8";
  ctx.fillRect(0, bar - 1, w, 1);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(20 + i * 20, bar / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  const pillW = Math.min(360, w * 0.42);
  rounded(ctx, (w - pillW) / 2, 10, pillW, 24, 8);
  ctx.fillStyle = "#e8e8ed";
  ctx.fill();
  text(ctx, "myapp.com", w / 2, bar / 2, 12.5, "#55555f", 500, "center");

  // Sidebar.
  const side = w > 620 ? 188 : 0;
  if (side) {
    ctx.fillStyle = "#fafafb";
    ctx.fillRect(0, bar, side, h - bar);
    ctx.fillStyle = LINE;
    ctx.fillRect(side - 1, bar, 1, h - bar);
    const logo = ctx.createLinearGradient(20, bar + 22, 44, bar + 46);
    logo.addColorStop(0, "#7c7cf8");
    logo.addColorStop(1, "#4646d8");
    rounded(ctx, 20, bar + 20, 24, 24, 7);
    ctx.fillStyle = logo;
    ctx.fill();
    text(ctx, "Acme", 54, bar + 32, 14, INK, 650);
    const nav = ["Overview", "Projects", "Customers", "Reports", "Settings"];
    nav.forEach((label, i) => {
      const y = bar + 68 + i * 34;
      const on = i === 0;
      const hover = !on && inside(cursor, 12, y, side - 24, 30);
      if (on || hover) {
        rounded(ctx, 12, y, side - 24, 30, 8);
        ctx.fillStyle = on ? "#ededfd" : "#f0f0f3";
        ctx.fill();
      }
      rounded(ctx, 24, y + 9, 12, 12, 3.5);
      ctx.fillStyle = on ? INDIGO : "#c4c4cc";
      ctx.fill();
      text(ctx, label, 46, y + 15.5, 13, on ? "#3f3fc6" : "#4a4a55", on ? 600 : 500);
    });
  }

  // Main.
  const x0 = side + 28;
  const right = w - 28;
  const mw = right - x0;
  text(ctx, "Overview", x0, bar + 38, 21, INK, 700);
  text(ctx, "Last 30 days", x0, bar + 62, 12.5, MUTED, 500);
  const btnW = 112;
  const btnHover = inside(cursor, right - btnW, bar + 24, btnW, 32);
  rounded(ctx, right - btnW, bar + 24, btnW, 32, 9);
  ctx.fillStyle = btnHover ? "#4a4ae0" : INDIGO;
  ctx.fill();
  text(ctx, "New report", right - btnW / 2, bar + 40, 13, "#ffffff", 600, "center");

  // Stats.
  const cols = mw > 720 ? 4 : mw > 420 ? 3 : 2;
  const gap = 14;
  const cw = (mw - gap * (cols - 1)) / cols;
  const sy = bar + 86;
  const sh = 86;
  for (let i = 0; i < cols; i++) {
    const s = STATS[i];
    const x = x0 + i * (cw + gap);
    const hover = inside(cursor, x, sy, cw, sh);
    rounded(ctx, x + 0.5, sy + 0.5, cw - 1, sh - 1, 12);
    ctx.fillStyle = hover ? "#f7f7ff" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = hover ? "#c9c9f6" : LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, s.label, x + 16, sy + 22, 12, MUTED, 500);
    const grow = ease((t - i * 0.15) / 1.6);
    const wobble = 1 + 0.004 * Math.sin(t * 1.3 + i);
    text(ctx, s.format(s.value * grow * wobble), x + 16, sy + 52, 22, INK, 700);
    text(ctx, s.delta, x + cw - 14, sy + 22, 11.5, "#1f9d55", 600, "right");
  }

  // Chart.
  const cy = sy + sh + 16;
  const feedW = mw > 640 ? Math.min(260, mw * 0.32) : 0;
  const chartW = feedW ? mw - feedW - gap : mw;
  const chartH = Math.max(120, h - cy - 24);
  rounded(ctx, x0 + 0.5, cy + 0.5, chartW - 1, chartH - 1, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.stroke();
  text(ctx, "Revenue", x0 + 16, cy + 24, 13, INK, 600);
  text(ctx, "Daily", x0 + chartW - 16, cy + 24, 12, MUTED, 500, "right");
  const px = x0 + 16;
  const pw = chartW - 32;
  const py = cy + 48;
  const ph = chartH - 68;
  ctx.fillStyle = "#f1f1f4";
  for (let g = 0; g <= 3; g++) ctx.fillRect(px, py + (ph * g) / 3, pw, 1);
  const n = 30;
  // The line draws in, holds, then draws again.
  const reveal = ease(((t % 9) - 0.2) / 2.4);
  const upto = Math.max(1, reveal * (n - 1));
  const pt = (i: number) => ({ x: px + (i / (n - 1)) * pw, y: py + ph * (1 - series(i)) });
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py - 4, pw * (upto / (n - 1)) + 1, ph + 8);
  ctx.clip();
  const area = ctx.createLinearGradient(0, py, 0, py + ph);
  area.addColorStop(0, "rgba(91,91,240,0.22)");
  area.addColorStop(1, "rgba(91,91,240,0)");
  ctx.beginPath();
  ctx.moveTo(pt(0).x, py + ph);
  for (let i = 0; i < n; i++) ctx.lineTo(pt(i).x, pt(i).y);
  ctx.lineTo(pt(n - 1).x, py + ph);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pt(i).x, pt(i).y);
  ctx.strokeStyle = INDIGO;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
  const head = pt(Math.min(n - 1, Math.floor(upto)));
  ctx.beginPath();
  ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = INDIGO;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Activity.
  if (feedW) {
    const fx = x0 + chartW + gap;
    rounded(ctx, fx + 0.5, cy + 0.5, feedW - 1, chartH - 1, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.stroke();
    text(ctx, "Activity", fx + 16, cy + 24, 13, INK, 600);
    const rows = Math.max(0, Math.min(FEED.length, Math.floor((chartH - 50) / 46)));
    // A new row slides in every couple of seconds.
    const step = Math.floor(t / 2.2);
    const slide = ease((t % 2.2) / 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(fx, cy + 42, feedW, chartH - 48);
    ctx.clip();
    for (let r = -1; r < rows; r++) {
      const item = FEED[(((step - r) % FEED.length) + FEED.length) % FEED.length];
      const y = cy + 50 + (r + slide) * 46;
      const alpha = r === -1 ? slide : 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(fx + 30, y + 18, 13, 0, Math.PI * 2);
      ctx.fillStyle = item.color;
      ctx.fill();
      text(ctx, item.who[0], fx + 30, y + 18.5, 12, "#ffffff", 700, "center");
      text(ctx, item.who, fx + 52, y + 11, 12.5, INK, 600);
      text(ctx, item.what, fx + 52, y + 27, 11.5, MUTED, 500);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  ctx.restore();
  // Hairline edge.
  rounded(ctx, 0.5, 0.5, w - 1, h - 1, 12);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** The macOS arrow, tip at (x, y). */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16.5);
  ctx.lineTo(3.9, 12.9);
  ctx.lineTo(6.5, 19);
  ctx.lineTo(9.3, 17.8);
  ctx.lineTo(6.8, 11.9);
  ctx.lineTo(12, 11.9);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.restore();
}

/** A stand-in camera: someone at their desk, breathing. */
export function drawFace(ctx: CanvasRenderingContext2D, t: number, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const bg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  bg.addColorStop(0, "#d9e2ef");
  bg.addColorStop(1, "#aab8cc");
  ctx.fillStyle = bg;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // A window glow behind.
  const glow = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.6, 0, cx - r * 0.5, cy - r * 0.6, r * 1.2);
  glow.addColorStop(0, "rgba(255,255,255,0.7)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  const bob = Math.sin(t * 1.4) * r * 0.012;
  const tilt = Math.sin(t * 0.6) * 0.035;
  ctx.translate(cx, cy + bob);
  ctx.rotate(tilt);
  // Shoulders.
  ctx.beginPath();
  ctx.ellipse(0, r * 0.98, r * 0.78, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#33415c";
  ctx.fill();
  // Neck.
  ctx.fillStyle = "#d9a37f";
  ctx.fillRect(-r * 0.12, r * 0.18, r * 0.24, r * 0.34);
  // Head.
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.08, r * 0.3, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#e9b994";
  ctx.fill();
  // Hair.
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.3, r * 0.33, r * 0.22, 0, Math.PI, Math.PI * 2);
  ctx.fillStyle = "#3b2a22";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.3, r * 0.33, r * 0.12, 0, 0, Math.PI);
  ctx.fill();
  // Eyes, with a blink now and then.
  const blink = t % 3.7 < 0.12 ? 0.15 : 1;
  ctx.fillStyle = "#2a1f1a";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.11, -r * 0.06, r * 0.028, r * 0.034 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Smile.
  ctx.beginPath();
  ctx.arc(0, r * 0.06, r * 0.09, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = "#a0563f";
  ctx.lineWidth = Math.max(1, r * 0.022);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}
