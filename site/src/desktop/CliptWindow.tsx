/**
 * Clipt's window: frosted dark glass, an overlay title bar with the traffic
 * lights inset like macos.rs places them, Clipt's page inside, and the
 * "native" preview layer drawn under the page's hole.
 */
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { contain } from "../../../src/lib/geometry";
import { usePreview } from "../backend/clipt";
import { centred, EDITOR, EDITOR_MIN, LAUNCHER, visibleFrame } from "../backend/layout";
import { player } from "../backend/player";
import { compose } from "../backend/render";
import { desktop, hideClipt, raise, useDesktop } from "../backend/state";
import { CliptApp } from "./CliptApp";
import { useViewport } from "./hooks";
import { TrafficLights, useWindowDrag } from "./Window";

function PreviewLayer() {
  const { scene, clip, hole, visible } = usePreview();
  const canvas = useRef<HTMLCanvasElement>(null);
  const fit = scene && hole && hole.w > 0 && hole.h > 0 ? contain(hole.w, hole.h, scene.width / scene.height) : null;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !scene || !clip || !fit) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(fit.w * dpr);
    el.height = Math.round(fit.h * dpr);
    const ctx = el.getContext("2d")!;
    let last = -1;
    let dirty = true;
    let frame = 0;
    const draw = () => {
      const t = player.now();
      if (dirty || t !== last || clip.video) {
        dirty = false;
        last = t;
        const k = el.width / scene.width;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        compose(ctx, scene, clip, t, () => (dirty = true));
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene, clip, fit?.w, fit?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scene || !clip || !hole || !fit || !visible) return null;
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: hole.x + fit.x, top: hole.y + fit.y, width: fit.w, height: fit.h }}
    />
  );
}

export function CliptWindow() {
  const reduce = useReducedMotion();
  useViewport();
  const { mode, zoomed, visible, launch, stack, active } = useDesktop((s) => ({
    mode: s.mode,
    zoomed: s.zoomed,
    visible: s.cliptVisible && s.running,
    launch: s.launch,
    stack: s.stack,
    active: s.active,
  }));
  // Where the user dragged the window, as an offset from centred. A fresh
  // launch opens centred again.
  const [dragged, setDragged] = useState({ launch, x: 0, y: 0 });
  const offset = dragged.launch === launch ? dragged : { x: 0, y: 0 };
  const key = stack[stack.length - 1] === "clipt" && active === "clipt";

  const v = visibleFrame();
  const size = zoomed
    ? { w: v.w, h: v.h }
    : mode === "editor"
      ? { w: Math.max(Math.min(EDITOR.w, v.w - 48), EDITOR_MIN.w), h: Math.max(Math.min(EDITOR.h, v.h - 24), EDITOR_MIN.h) }
      : LAUNCHER;
  const base = centred(size);
  // Kept in the visible frame, like set_mode keeps it.
  const keep = (o: { x: number; y: number }) => ({
    x: Math.min(Math.max(o.x, v.x - base.x), v.x + v.w - base.w - base.x),
    y: Math.min(Math.max(o.y, v.y - base.y), v.y + v.h - base.h - base.y),
  });
  const placed = keep(offset);
  const x = zoomed ? v.x : base.x + placed.x;
  const y = zoomed ? v.y : base.y + placed.y;
  const { dragging, handlers } = useWindowDrag((dx, dy) =>
    setDragged((d) => {
      const from = keep(d.launch === launch ? d : { x: 0, y: 0 });
      return { launch, ...keep({ x: from.x + dx, y: from.y + dy }) };
    }),
  );

  return (
    <motion.div
      id="clipt-window"
      className={`window-frame glass absolute overflow-hidden rounded-[12px] ${key ? "is-key" : ""}`}
      style={{ zIndex: 10 + Math.max(stack.indexOf("clipt"), 0), pointerEvents: visible ? "auto" : "none" }}
      initial={false}
      animate={{
        left: x,
        top: y,
        width: base.w,
        height: base.h,
        opacity: visible ? 1 : 0,
        scale: visible ? 1 : 0.96,
        visibility: visible ? "visible" : "hidden",
      }}
      transition={
        dragging || reduce
          ? { duration: 0 }
          : {
              default: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.18 },
              scale: { duration: 0.18 },
              visibility: { delay: visible ? 0 : 0.18, duration: 0 },
            }
      }
      onPointerDownCapture={() => raise("clipt")}
      {...handlers}
    >
      <PreviewLayer />
      <div className="absolute inset-0">
        <CliptApp key={launch} />
      </div>
      <TrafficLights
        size={14}
        gap={6}
        left={14}
        top={13}
        active={key}
        onClose={hideClipt}
        onMinimize={hideClipt}
        onZoom={mode === "editor" ? () => desktop.set((s) => ({ zoomed: !s.zoomed })) : undefined}
      />
      <div aria-hidden className="window-edge pointer-events-none absolute inset-0 z-40 rounded-[inherit]" />
    </motion.div>
  );
}
