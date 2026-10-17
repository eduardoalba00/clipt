/** Finder at ~/Movies/Clipt, where exports land, and Quick Look to play one. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { contain } from "../../../src/lib/geometry";
import { visibleFrame } from "../backend/layout";
import { VideoClip } from "../backend/clip";
import { compose } from "../backend/render";
import { buildScene } from "../backend/scene";
import { close, desktop, raise, useDesktop, type Recording } from "../backend/state";
import { Chevron, FolderGlyph, Search } from "./glyphs";
import { useViewport } from "./hooks";
import { MacWindow } from "./Window";

const SIDEBAR: { section: string; items: string[] }[] = [
  { section: "Favorites", items: ["AirDrop", "Recents", "Applications", "Desktop", "Documents", "Downloads", "Movies"] },
  { section: "Locations", items: ["Macintosh HD"] },
];

export function openQuickLook(rec: Recording) {
  desktop.set({ quicklook: rec, selected: rec.name });
  raise("quicklook");
}

function useOffset() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  return [offset, (dx: number, dy: number) => setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))] as const;
}

export function Finder() {
  useViewport();
  const { recordings, selected } = useDesktop((s) => ({ recordings: s.recordings, selected: s.selected }));
  const [offset, move] = useOffset();
  const v = visibleFrame();
  const w = Math.min(780, v.w - 40);
  const h = Math.min(470, v.h - 40);
  const x = v.x + Math.max((v.w - w) / 2 + 150, 20) + offset.x;
  const y = v.y + Math.max((v.h - h) / 2 - 70, 12) + offset.y;

  return (
    <MacWindow id="finder" title="Clipt" x={x} y={y} w={w} h={h} onClose={() => close("finder")} onMove={move} className="bg-[#1e1e20] text-white">
      <div className="flex h-full">
        <aside data-drag className="finder-sidebar w-[172px] shrink-0 overflow-hidden px-2.5 pt-12 text-[13px]">
          {SIDEBAR.map((s) => (
            <div key={s.section} data-drag className="mb-3">
              <div data-drag className="px-2 pb-1 text-[11px] font-semibold text-white/35">
                {s.section}
              </div>
              {s.items.map((item) => (
                <div key={item} className="flex h-7 items-center gap-2 rounded-md px-2 text-white/85">
                  <FolderGlyph className="h-[13px] w-4 shrink-0 text-[#4a9dff]" />
                  {item}
                </div>
              ))}
            </div>
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header data-drag className="flex h-[52px] shrink-0 items-center gap-1 border-b border-black/40 px-3">
            <Chevron dir="left" className="mx-1.5 h-3.5 text-white/70" />
            <Chevron dir="right" className="mx-1.5 h-3.5 text-white/25" />
            <span data-drag className="ml-2 text-[15px] font-bold text-white/90">
              Clipt
            </span>
            <span data-drag className="flex-1" />
            <Search className="mx-2 h-[15px] text-white/60" />
          </header>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-4"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) desktop.set({ selected: null });
            }}
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-2 gap-y-4">
              {recordings.map((rec) => (
                <FileIcon key={rec.name} rec={rec} selected={selected === rec.name} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </MacWindow>
  );
}

function FileIcon({ rec, selected }: { rec: Recording; selected: boolean }) {
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-1.5 outline-none"
      onPointerDown={() => desktop.set({ selected: rec.name })}
      onDoubleClick={() => openQuickLook(rec)}
    >
      <span className={`grid h-[84px] w-[112px] place-items-center rounded-md p-1.5 ${selected ? "bg-white/10" : ""}`}>
        <img src={rec.thumb} alt="" draggable={false} className="max-h-full max-w-full rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.5)]" />
      </span>
      <span
        className={`line-clamp-2 max-w-[120px] rounded-[4px] px-1 text-center text-[11.5px] leading-[1.3] break-words ${
          selected ? "bg-[#0a64d8] text-white" : "text-white/85"
        }`}
      >
        {rec.name}
      </span>
    </button>
  );
}

export function QuickLook() {
  const rec = useDesktop((s) => s.quicklook);
  const [offset, move] = useOffset();
  useViewport();
  if (!rec) return null;
  const scene = buildScene(rec.recipe, { width: rec.clip.width, height: rec.clip.height, hasCamera: rec.clip.hasCamera });
  const v = visibleFrame();
  const bar = 40;
  const box = contain(Math.min(v.w * 0.62, 1100), Math.min(v.h * 0.72, 700) - bar, scene.width / scene.height);
  const w = box.w;
  const h = box.h + bar;
  return (
    <MacWindow
      id="quicklook"
      title={rec.name}
      x={v.x + (v.w - w) / 2 + offset.x}
      y={v.y + (v.h - h) / 2 + offset.y}
      w={w}
      h={h}
      onClose={() => close("quicklook")}
      onMove={move}
      className="bg-[#1e1e20]"
    >
      <div data-drag className="flex h-10 items-center justify-center px-20 text-[13px] font-semibold text-white/85">
        <span data-drag className="truncate">
          {rec.name}
        </span>
      </div>
      <Player rec={rec} width={box.w} height={box.h} />
    </MacWindow>
  );
}

function Player({ rec, width, height }: { rec: Recording; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paused = useRef(false);
  const video = rec.clip instanceof VideoClip ? rec.clip : null;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const scene = buildScene(rec.recipe, { width: rec.clip.width, height: rec.clip.height, hasCamera: rec.clip.hasCamera });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const ctx = el.getContext("2d")!;
    const { start, end } = rec.recipe.trim;
    const clock = { t: start, last: performance.now(), frame: 0 };
    video?.seek(start);
    video?.play();
    // Loops the trimmed part, like Quick Look.
    const draw = (now: number) => {
      if (video) {
        clock.t = video.time();
        if (clock.t >= end) video.seek(start);
      } else {
        if (!paused.current) clock.t += (now - clock.last) / 1000;
        if (clock.t >= end) clock.t = start;
      }
      clock.last = now;
      const k = el.width / scene.width;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      compose(ctx, scene, rec.clip, clock.t);
      clock.frame = requestAnimationFrame(draw);
    };
    clock.frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(clock.frame);
      video?.pause();
    };
  }, [rec, video, width, height]);

  const toggle = () => {
    paused.current = !paused.current;
    if (paused.current) video?.pause();
    else video?.play();
  };
  return <canvas ref={canvas} onClick={toggle} style={{ width, height }} className="block" />;
}

export function About() {
  const [offset, move] = useOffset();
  useViewport();
  const v = visibleFrame();
  const w = 280;
  const h = 268;
  return (
    <MacWindow
      id="about"
      x={v.x + (v.w - w) / 2 + offset.x}
      y={v.y + Math.max((v.h - h) / 2 - 80, 8) + offset.y}
      w={w}
      h={h}
      onClose={() => close("about")}
      onMove={move}
      className="glass"
    >
      <div data-drag className="flex h-full flex-col items-center pt-10 text-center">
        <img src="/icon.svg" alt="" draggable={false} className="size-[88px]" />
        <Line className="mt-3 text-[15px] font-bold text-white">Clipt</Line>
        <Line className="mt-1.5 text-[11px] text-white/55">Version 0.1.0 (0.1.0)</Line>
        <Line className="mt-4 text-[10.5px] text-white/45">A small, fast, frictionless screen recorder.</Line>
        <Line className="mt-1 text-[10.5px] text-white/45">MIT</Line>
      </div>
    </MacWindow>
  );
}

function Line({ className, children }: { className: string; children: ReactNode }) {
  return (
    <p data-drag className={className}>
      {children}
    </p>
  );
}
