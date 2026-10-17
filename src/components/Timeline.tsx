import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clamp, formatTime } from "../lib/geometry";
import type { Playback } from "../lib/ipc";
import { MIN_CLIP } from "../lib/recipe";
import { Kbd, SPRING } from "./ui/controls";
import { Pause, Play } from "./ui/icons";
import { Tooltip } from "./ui/overlays";

type Trim = { start: number; end: number };
type Drag = "start" | "end" | "scrub" | null;

export function Timeline({
  duration,
  trim,
  playback,
  thumbs,
  onTrimInput,
  onTrimCommit,
  onSeek,
  onTogglePlay,
}: {
  duration: number;
  trim: Trim;
  playback: Playback;
  thumbs: string[];
  onTrimInput: (trim: Trim) => void;
  onTrimCommit: () => void;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
}) {
  const reduce = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag>(null);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const x = (t: number) => (duration > 0 ? (t / duration) * width : 0);
  const timeAt = (clientX: number) => {
    const r = strip.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };

  const begin = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const kind = (e.currentTarget.dataset.drag ?? "scrub") as Exclude<Drag, null>;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(kind);
    if (kind === "scrub") onSeek(timeAt(e.clientX));
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const t = timeAt(e.clientX);
    if (drag === "scrub") onSeek(t);
    else if (drag === "start") {
      const start = Math.min(t, trim.end - MIN_CLIP);
      onTrimInput({ ...trim, start: Math.max(0, start) });
      onSeek(Math.max(0, start));
    } else {
      const end = Math.max(t, trim.start + MIN_CLIP);
      onTrimInput({ ...trim, end: Math.min(duration, end) });
      onSeek(Math.min(duration, end));
    }
  };
  const end = () => {
    if (!drag) return;
    if (drag !== "scrub") onTrimCommit();
    setDrag(null);
  };

  const settle = drag || reduce ? { duration: 0 } : SPRING;
  const left = x(trim.start);
  const right = x(trim.end);
  const length = trim.end - trim.start;

  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mb-2 flex h-7 items-center gap-2 text-[12px]">
        <Tooltip label={playback.playing ? "Pause" : "Play"} keys={["Space"]} side="top">
          <button
            type="button"
            aria-label={playback.playing ? "Pause" : "Play"}
            onClick={onTogglePlay}
            className="grid size-7 place-items-center rounded-md text-content/75 hover:bg-selection hover:text-content"
          >
            {playback.playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </Tooltip>
        <span className="w-14 text-content/80 tabular">{formatTime(playback.time)}</span>
        <span className="hidden items-center gap-1 text-[11px] text-content/35 md:flex">
          <Kbd>I</Kbd> <Kbd>O</Kbd> set trim
        </span>
        <span className="ml-auto text-content/50 tabular">{formatTime(length)}</span>
      </div>

      <div
        ref={strip}
        className="relative h-12 touch-none"
        data-drag="scrub"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="absolute inset-0 flex overflow-hidden rounded-lg bg-selection">
          {thumbs.map((src) => (
            <img key={src} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
          ))}
        </div>

        {/* Outside the trim is dimmed. */}
        <motion.div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/55"
          initial={false}
          animate={{ width: left }}
          transition={settle}
        />
        <motion.div
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/55"
          initial={false}
          animate={{ width: Math.max(0, width - right) }}
          transition={settle}
        />

        <motion.div
          className="absolute inset-y-0 rounded-lg border-y-2 border-white/90"
          initial={false}
          animate={{ left, width: Math.max(0, right - left) }}
          transition={settle}
          style={{ pointerEvents: "none" }}
        >
          <span
            role="slider"
            aria-label="Trim start"
            aria-valuenow={Math.round(trim.start * 10) / 10}
            className="pointer-events-auto absolute inset-y-[-2px] -left-[2px] grid w-3 cursor-ew-resize place-items-center rounded-l-lg bg-white/90"
            data-drag="start"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className="h-4 w-0.5 rounded-full bg-black/40" />
          </span>
          <span
            role="slider"
            aria-label="Trim end"
            aria-valuenow={Math.round(trim.end * 10) / 10}
            className="pointer-events-auto absolute inset-y-[-2px] -right-[2px] grid w-3 cursor-ew-resize place-items-center rounded-r-lg bg-white/90"
            data-drag="end"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className="h-4 w-0.5 rounded-full bg-black/40" />
          </span>
        </motion.div>

        <div
          className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          style={{ left: x(playback.time) }}
        />
      </div>
    </div>
  );
}
