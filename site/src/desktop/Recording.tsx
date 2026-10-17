/**
 * Everything on screen while Clipt records: the app being recorded, the
 * drag-to-select overlay (record.rs), the system picker, and the indicator
 * that dims what isn't recorded (indicator.rs).
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Rect } from "../../../src/lib/recipe";
import { begin, cancel, pointerAt, sampleTime } from "../backend/clipt";
import { SCALE } from "../backend/clip";
import { sampleRect } from "../backend/layout";
import { drawSample } from "../backend/sample";
import { useDesktop, type Phase } from "../backend/state";
import { Kbd } from "../../../src/components/ui/controls";
import { useViewport } from "./hooks";

/** The app the visitor records: it keeps moving and follows the pointer. */
export function SampleWindow() {
  const shown = useDesktop((s) => s.phase.kind !== "idle");
  useViewport();
  const rect = sampleRect();
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          key="sample"
          className="absolute"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 9 }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <SampleCanvas rect={rect} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SampleCanvas({ rect }: { rect: Rect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(rect.w * dpr);
    el.height = Math.round(rect.h * dpr);
    const ctx = el.getContext("2d")!;
    let pointer: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => (pointer = { x: e.clientX - rect.x, y: e.clientY - rect.y });
    window.addEventListener("pointermove", move, { passive: true });
    let frame = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.w, rect.h);
      drawSample(ctx, sampleTime(), rect.w, rect.h, pointer);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, [rect.x, rect.y, rect.w, rect.h]);
  return (
    <canvas
      ref={canvas}
      className="block size-full rounded-[12px] shadow-[0_24px_70px_rgba(0,0,0,0.5),0_0_0_0.5px_rgba(0,0,0,0.5)]"
    />
  );
}

/** record.rs's selection overlay: dims every screen; drag out an area. */
function Selecting() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart({ x: e.clientX, y: e.clientY });
    setRect(null);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start) return;
    const x = Math.min(Math.max(e.clientX, 0), window.innerWidth);
    const y = Math.min(Math.max(e.clientY, 0), window.innerHeight);
    setRect({
      x: Math.round(Math.min(start.x, x)),
      y: Math.round(Math.min(start.y, y)),
      w: Math.round(Math.abs(start.x - x)),
      h: Math.round(Math.abs(start.y - y)),
    });
  };
  const up = () => {
    setStart(null);
    if (rect && rect.w >= 32 && rect.h >= 32) begin({ kind: "area", rect });
    else setRect(null);
  };

  const label = rect ? `${Math.round(rect.w * SCALE)} × ${Math.round(rect.h * SCALE)}` : "";
  return (
    <div
      className="absolute inset-0 z-[90] cursor-crosshair touch-none select-none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {rect ? (
        <>
          <Dim hole={rect} />
          <div
            className="pointer-events-none absolute outline outline-1 outline-white"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
          <span
            className="pointer-events-none absolute text-[12px] text-white tabular-nums"
            style={{ left: rect.x, top: rect.y > 28 ? rect.y - 22 : rect.y + rect.h + 6 }}
          >
            {label}
          </span>
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-black/38">
          <p className="text-[15px] text-white">Drag to select an area. Press Esc to cancel.</p>
        </div>
      )}
    </div>
  );
}

/** Black at 38% everywhere but `hole`. */
function Dim({ hole, className = "" }: { hole: Rect | null; className?: string }) {
  if (!hole) return <div className={`pointer-events-none absolute inset-0 bg-black/38 ${className}`} />;
  return (
    <div
      className={`pointer-events-none absolute ${className}`}
      style={{
        left: hole.x,
        top: hole.y,
        width: hole.w,
        height: hole.h,
        boxShadow: "0 0 0 100vmax rgba(0,0,0,0.38)",
      }}
    />
  );
}

/** The system's content-sharing picker, for a display or a window. */
function Picker({ mode }: { mode: "screen" | "window" }) {
  useViewport();
  const sample = sampleRect();
  const target: Rect | null = mode === "window" ? sample : null;
  const within = (p: { x: number; y: number }) =>
    mode === "screen" || (p.x >= sample.x && p.x <= sample.x + sample.w && p.y >= sample.y && p.y <= sample.y + sample.h);
  // A display is always under the pointer; a window only when it's over it.
  const [hover, setHover] = useState(() => within(pointerAt()));
  const over = (e: ReactPointerEvent) => setHover(within({ x: e.clientX, y: e.clientY }));

  const pick = () => begin(mode === "screen" ? { kind: "screen" } : { kind: "window", rect: sample });

  return (
    <div className="absolute inset-0 z-[90]" onPointerMove={over} onPointerLeave={() => setHover(mode === "screen")}>
      {hover ? (
        <div
          className="absolute grid place-items-center rounded-[12px] border-[3px] border-[#0a84ff] bg-[#0a84ff]/15"
          style={target ? { left: target.x - 3, top: target.y - 3, width: target.w + 6, height: target.h + 6 } : { inset: 0, borderRadius: 0 }}
          onClick={pick}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              pick();
            }}
            className="rounded-full bg-[#0a84ff] px-4 py-1.5 text-[13px] font-medium text-white shadow-lg hover:bg-[#2b95ff]"
          >
            {mode === "screen" ? "Share Entire Screen" : "Share This Window"}
          </button>
        </div>
      ) : null}
      <div className="menu-glass absolute top-9 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[10px] py-1.5 pr-1.5 pl-3.5 text-[12.5px] text-white/85">
        {mode === "screen" ? "Choose a display to share" : "Choose a window to share"}
        <button type="button" onClick={cancel} className="rounded-md bg-white/12 px-2.5 py-1 text-white hover:bg-white/20">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** indicator.rs: while recording, dims what isn't recorded (below the menu bar). */
function Indicator({ phase }: { phase: Extract<Phase, { kind: "recording" }> }) {
  const t = phase.target;
  if (t.kind === "screen") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-6 bottom-0 z-[65] overflow-hidden">
      <div className="absolute inset-x-0 -top-6 bottom-0">
        <Dim hole={t.rect} />
        {t.kind === "area" ? (
          <div
            className="absolute outline outline-1 outline-white/85"
            style={{ left: t.rect.x - 1, top: t.rect.y - 1, width: t.rect.w + 2, height: t.rect.h + 2 }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A pointer to the stop button: the demo's only addition to the real flow. */
function StopHint() {
  useViewport();
  const tray = document.querySelector("[data-tray]")?.getBoundingClientRect();
  if (!tray) return null;
  const x = tray.left + tray.width / 2;
  return (
    <motion.div
      className="pointer-events-none absolute top-[30px] z-[75] -translate-x-1/2"
      style={{ left: x }}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.5, duration: 0.25 }}
    >
      <div className="mx-auto size-2.5 translate-y-[5px] rotate-45 rounded-[2px] bg-[#2b2b2e]" />
      <div className="menu-glass rounded-[9px] px-3 py-2 text-center text-[12px] leading-snug whitespace-nowrap text-white/85">
        <div className="flex items-center justify-center gap-1.5 font-medium text-white">
          <span className="record-pulse size-2 rounded-full bg-record" />
          Recording
        </div>
        <div className="mt-0.5 text-white/60">
          Click to stop, or press <Kbd className="!text-white/60">⌘</Kbd> <Kbd className="!text-white/60">⇧</Kbd>{" "}
          <Kbd className="!text-white/60">2</Kbd>
        </div>
      </div>
    </motion.div>
  );
}

export function RecordingLayer() {
  const phase = useDesktop((s) => s.phase);
  return (
    <>
      {phase.kind === "selecting" ? <Selecting /> : null}
      {phase.kind === "picking" ? <Picker mode={phase.mode} /> : null}
      {phase.kind === "recording" ? <Indicator phase={phase} /> : null}
      <AnimatePresence>{phase.kind === "recording" ? <StopHint key="hint" /> : null}</AnimatePresence>
    </>
  );
}
