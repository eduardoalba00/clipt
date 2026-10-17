import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { contain, dragCrop, dragCropLocked, FULL, type Edge } from "../lib/geometry";
import { ipc } from "../lib/ipc";
import type { NormRect, Rect, Scene } from "../lib/recipe";
import { SPRING, Shimmer } from "./ui/controls";

/**
 * The page leaves this area clear; the native player layer shows through it.
 * We report where it is, and draw the crop overlay on top.
 */
export function Preview({
  scene,
  cropping,
  crop,
  source,
  ratio,
  onCropInput,
  onCropCommit,
  onTogglePlay,
}: {
  scene: Scene | null;
  cropping: boolean;
  crop: NormRect | null;
  source: { width: number; height: number };
  /** Locked crop shape in crop units, if any. */
  ratio: number | null;
  onCropInput: (crop: NormRect) => void;
  onCropCommit: () => void;
  onTogglePlay: () => void;
}) {
  const hole = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ready = scene !== null;

  useLayoutEffect(() => {
    const el = hole.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      void ipc.previewInsets(r.top, window.innerWidth - r.right, window.innerHeight - r.bottom, r.left);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
    // Re-report once the preview exists: it starts hidden until placed.
  }, [ready]);

  useEffect(() => () => void ipc.previewVisible(false), []);

  const canvas = scene && size.w > 0 ? contain(size.w, size.h, scene.width / scene.height) : null;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hole} className="absolute inset-x-6 top-2 bottom-4">
        {!ready ? (
          <div className="grid h-full place-items-center text-[12px]">
            <Shimmer>Preparing preview</Shimmer>
          </div>
        ) : canvas && cropping && scene.plain ? (
          <CropOverlay
            canvas={canvas}
            crop={crop ?? FULL}
            source={source}
            ratio={ratio}
            onInput={onCropInput}
            onCommit={onCropCommit}
          />
        ) : canvas ? (
          <button
            type="button"
            aria-label="Play or pause"
            tabIndex={-1}
            onClick={onTogglePlay}
            className="absolute"
            style={{ left: canvas.x, top: canvas.y, width: canvas.w, height: canvas.h }}
          />
        ) : null}
      </div>
    </div>
  );
}

const HANDLES: { edge: Edge; className: string }[] = [
  { edge: "nw", className: "-top-1.5 -left-1.5 cursor-nwse-resize" },
  { edge: "ne", className: "-top-1.5 -right-1.5 cursor-nesw-resize" },
  { edge: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { edge: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  { edge: "n", className: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { edge: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { edge: "w", className: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
  { edge: "e", className: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
];

function Corner({ edge }: { edge: Edge }) {
  const v = edge.includes("n") ? "top-1.5" : "bottom-1.5";
  const hz = edge.includes("w") ? "left-1.5" : "right-1.5";
  return (
    <>
      <span className={`absolute ${v} ${hz} h-[3px] w-4 rounded-full bg-white shadow`} />
      <span className={`absolute ${v} ${hz} h-4 w-[3px] rounded-full bg-white shadow`} />
    </>
  );
}

function CropOverlay({
  canvas,
  crop,
  source,
  ratio,
  onInput,
  onCommit,
}: {
  canvas: Rect;
  crop: NormRect;
  source: { width: number; height: number };
  ratio: number | null;
  onInput: (crop: NormRect) => void;
  onCommit: () => void;
}) {
  const reduce = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ crop: NormRect; x: number; y: number; edge: Edge } | null>(null);

  const down = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const edge = (e.currentTarget.dataset.edge ?? "move") as Edge;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { crop, x: e.clientX, y: e.clientY, edge };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.x) / canvas.w;
    const dy = (e.clientY - s.y) / canvas.h;
    onInput(ratio ? dragCropLocked(s.crop, s.edge, dx, dy, ratio) : dragCrop(s.crop, s.edge, dx, dy));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    onCommit();
  };

  const box = { left: crop.x * canvas.w, top: crop.y * canvas.h, width: crop.w * canvas.w, height: crop.h * canvas.h };

  return (
    <div
      className="absolute overflow-hidden"
      style={{ left: canvas.x, top: canvas.y, width: canvas.w, height: canvas.h }}
    >
      <motion.div
        className="absolute cursor-move rounded-[2px] outline outline-1 outline-white/90"
        style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
        initial={false}
        animate={box}
        transition={dragging || reduce ? { duration: 0 } : SPRING}
        data-edge="move"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular">
              {Math.round(crop.w * source.width)} × {Math.round(crop.h * source.height)}
            </span>
          </div>
        ) : null}
        {HANDLES.map((handle) => (
          <span
            key={handle.edge}
            className={`absolute grid size-7 place-items-center ${handle.className}`}
            data-edge={handle.edge}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {handle.edge.length === 2 ? (
              <span className="relative size-7">
                <Corner edge={handle.edge} />
              </span>
            ) : (
              <span
                className={`rounded-full bg-white shadow ${
                  handle.edge === "n" || handle.edge === "s" ? "h-[3px] w-5" : "h-5 w-[3px]"
                }`}
              />
            )}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
