/** macOS window chrome: traffic lights, dragging by the title bar, stacking. */
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { raise, useDesktop, type WindowId } from "../backend/state";

const LIGHTS = [
  { fill: "#ff5f57", edge: "#e0443e", glyph: "M3.5 3.5l5 5M8.5 3.5l-5 5" },
  { fill: "#febc2e", edge: "#dea123", glyph: "M3 6h6" },
  { fill: "#28c840", edge: "#1aab29", glyph: "M6 3v6M3 6h6" },
];

export function TrafficLights({
  size = 12,
  gap = 8,
  left = 12,
  top = 12,
  active,
  onClose,
  onMinimize,
  onZoom,
}: {
  size?: number;
  gap?: number;
  left?: number;
  top?: number;
  active: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  onZoom?: () => void;
}) {
  const actions = [onClose, onMinimize, onZoom];
  return (
    <div className="group/lights absolute z-30 flex" style={{ left, top, gap }}>
      {LIGHTS.map((l, i) => {
        const action = actions[i];
        const lit = active && action;
        return (
          <button
            key={l.fill}
            type="button"
            tabIndex={-1}
            aria-label={["Close", "Minimize", "Zoom"][i]}
            disabled={!action}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              action?.();
            }}
            className="relative grid place-items-center rounded-full"
            style={{
              width: size,
              height: size,
              background: lit ? l.fill : "rgba(255,255,255,0.16)",
              boxShadow: `inset 0 0 0 0.5px ${lit ? l.edge : "rgba(0,0,0,0.25)"}`,
            }}
          >
            {action ? (
              <svg
                viewBox="0 0 12 12"
                className="pointer-events-none opacity-0 group-hover/lights:opacity-100"
                style={{ width: size * 0.72, height: size * 0.72 }}
              >
                <path d={l.glyph} stroke="rgba(0,0,0,0.55)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Drags a window by any element marked as a drag region. */
export function useWindowDrag(onMove: (dx: number, dy: number) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        const t = e.target as HTMLElement;
        if (e.button !== 0) return;
        if (!t.hasAttribute("data-tauri-drag-region") && !t.hasAttribute("data-drag")) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        if (!s) return;
        onMove(e.clientX - s.x, e.clientY - s.y);
        start.current = { x: e.clientX, y: e.clientY };
      },
      onPointerUp: () => {
        start.current = null;
        setDragging(false);
      },
    },
  };
}

/** A plain window (Finder, About, Quick Look): opens in front, drags, closes. */
export function MacWindow({
  id,
  x,
  y,
  w,
  h,
  title,
  onClose,
  onMove,
  className = "",
  children,
}: {
  id: WindowId;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: ReactNode;
  onClose: () => void;
  onMove: (dx: number, dy: number) => void;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const { stack, active } = useDesktop((s) => ({ stack: s.stack, active: s.active }));
  const key = stack[stack.length - 1] === id && active === (id === "about" ? "clipt" : "finder");
  const { handlers } = useWindowDrag(onMove);
  return (
    <motion.div
      role="dialog"
      aria-label={typeof title === "string" ? title : id}
      className={`window-frame absolute overflow-hidden rounded-[12px] ${key ? "is-key" : ""} ${className}`}
      style={{ left: x, top: y, width: w, height: h, zIndex: 10 + stack.indexOf(id) }}
      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onPointerDownCapture={() => raise(id)}
      {...handlers}
    >
      <TrafficLights active={key} onClose={onClose} />
      {children}
      <div aria-hidden className="window-edge pointer-events-none absolute inset-0 rounded-[inherit]" />
    </motion.div>
  );
}
