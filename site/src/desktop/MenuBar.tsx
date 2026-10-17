/** The menu bar: Clipt's app menus (from lib.rs), its tray icon (tray.rs), the clock. */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { openRecordings, quit, stopRecording } from "../backend/clipt";
import { emit } from "../backend/events";
import { desktop, hideClipt, raise, showClipt, useDesktop } from "../backend/state";
import { AppleLogo, Battery, ControlCenter, Search, TrayIdle, TrayRecording, Wifi } from "./glyphs";

type Item = { label: string; keys?: string; run?: () => void } | "-";
type Menu = { title: string; items: Item[] };

export const CLIPT_MENUS: Menu[] = [
  {
    title: "Clipt",
    items: [
      { label: "About Clipt", run: () => raise("about") },
      "-",
      { label: "Hide Clipt", keys: "⌘H", run: hideClipt },
      { label: "Hide Others", keys: "⌥⌘H" },
      { label: "Show All" },
      "-",
      { label: "Quit Clipt", keys: "⌘Q", run: quit },
    ],
  },
  {
    title: "File",
    items: [
      { label: "New recording", keys: "⌘N", run: () => emit("menu", "new") },
      { label: "Export", keys: "⌘E", run: () => emit("menu", "export") },
      { label: "Open recordings", keys: "⇧⌘O", run: openRecordings },
      "-",
      { label: "Close Window", keys: "⌘W", run: hideClipt },
    ],
  },
  {
    title: "Edit",
    items: [
      { label: "Undo", keys: "⌘Z", run: () => emit("menu", "undo") },
      { label: "Redo", keys: "⇧⌘Z", run: () => emit("menu", "redo") },
      "-",
      { label: "Cut", keys: "⌘X" },
      { label: "Copy", keys: "⌘C" },
      { label: "Paste", keys: "⌘V" },
      { label: "Select All", keys: "⌘A" },
    ],
  },
  {
    title: "Window",
    items: [
      { label: "Minimize", keys: "⌘M", run: hideClipt },
      {
        label: "Zoom",
        run: () => {
          if (desktop.get().mode === "editor") desktop.set((s) => ({ zoomed: !s.zoomed }));
        },
      },
    ],
  },
];

const FINDER_MENUS = ["Finder", "File", "Edit", "View", "Go", "Window", "Help"];

const TRAY: Item[] = [
  {
    label: "New recording",
    run: () => {
      showClipt();
      emit("menu", "new");
    },
  },
  { label: "Stop recording" },
  { label: "Show Clipt", run: showClipt },
  "-",
  { label: "Quit Clipt", run: quit },
];

function Dropdown({ items, align = "left", onDone }: { items: Item[]; align?: "left" | "right"; onDone: () => void }) {
  return (
    <motion.div
      role="menu"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.05 }}
      className={`menu-glass absolute top-[calc(100%+1px)] z-[80] min-w-[220px] rounded-[9px] p-[5px] text-[13px] ${align === "right" ? "right-0" : "left-0"}`}
    >
      {items.map((item, i) =>
        item === "-" ? (
          <div key={i} className="mx-2.5 my-[5px] h-px bg-white/12" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={!item.run}
            onClick={() => {
              onDone();
              item.run?.();
            }}
            className="flex h-[22px] w-full items-center rounded-[4px] px-2.5 text-left text-white/90 enabled:hover:bg-[#2a6bd6] enabled:hover:text-white disabled:text-white/30"
          >
            <span className="flex-1">{item.label}</span>
            {item.keys ? <span className="ml-6 text-white/45 tracking-[0.08em]">{item.keys}</span> : null}
          </button>
        ),
      )}
    </motion.div>
  );
}

function Title({ children, open, bold, onOpen, onHover }: { children: ReactNode; open: boolean; bold?: boolean; onOpen: () => void; onHover: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onOpen();
      }}
      onPointerEnter={onHover}
      className={`flex h-[22px] items-center rounded-[5px] px-[9px] ${bold ? "font-bold" : ""} ${open ? "bg-white/20" : ""}`}
    >
      {children}
    </button>
  );
}

function clock(d: Date) {
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}  ${time}`;
}

export function MenuBar() {
  const { active, running, recording } = useDesktop((s) => ({
    active: s.active,
    running: s.running,
    recording: s.phase.kind === "recording",
  }));
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const bar = useRef<HTMLDivElement>(null);
  const clipt = active === "clipt" && running;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const menus = clipt ? CLIPT_MENUS : null;
  const titleProps = (id: string) => ({
    open: open === id,
    onOpen: () => setOpen((o) => (o === id ? null : id)),
    onHover: () => setOpen((o) => (o && o !== id ? id : o)),
  });

  return (
    <div
      ref={bar}
      // The menu bar never takes keyboard focus from the window in front.
      onMouseDown={(e) => e.preventDefault()}
      className="menubar absolute inset-x-0 top-0 z-[70] flex h-6 items-center justify-between px-2 text-[13px] text-white"
    >
      <div className="flex items-center">
        <div className="relative">
          <Title {...titleProps("apple")}>
            <AppleLogo className="size-[14px] -translate-y-px" />
          </Title>
          <AnimatePresence>
            {open === "apple" ? (
              <Dropdown
                onDone={() => setOpen(null)}
                items={[
                  { label: "About This Mac" },
                  "-",
                  { label: "System Settings…" },
                  { label: "App Store…" },
                  "-",
                  { label: "Force Quit…", keys: "⌥⌘⎋" },
                  "-",
                  { label: "Sleep" },
                  { label: "Restart…" },
                  { label: "Shut Down…" },
                  "-",
                  { label: "Lock Screen", keys: "⌃⌘Q" },
                ]}
              />
            ) : null}
          </AnimatePresence>
        </div>
        {menus
          ? menus.map((m, i) => (
              <div key={m.title} className="relative">
                <Title bold={i === 0} {...titleProps(m.title)}>
                  {m.title}
                </Title>
                <AnimatePresence>
                  {open === m.title ? <Dropdown items={m.items} onDone={() => setOpen(null)} /> : null}
                </AnimatePresence>
              </div>
            ))
          : FINDER_MENUS.map((m, i) => (
              <span key={m} className={`px-[9px] ${i === 0 ? "font-bold" : ""}`}>
                {m}
              </span>
            ))}
      </div>

      <div className="flex items-center gap-[2px]">
        {running ? (
          <div className="relative">
            <button
              type="button"
              aria-label={recording ? "Stop recording" : "Clipt"}
              data-tray
              onPointerDown={(e) => {
                e.preventDefault();
                // While recording, a click stops it; otherwise it opens the menu.
                if (recording) void stopRecording();
                else setOpen((o) => (o === "tray" ? null : "tray"));
              }}
              className={`grid h-[22px] place-items-center rounded-[5px] px-[7px] ${open === "tray" ? "bg-white/20" : ""}`}
            >
              {recording ? <TrayRecording className="size-[17px]" /> : <TrayIdle className="size-[17px]" />}
            </button>
            <AnimatePresence>
              {open === "tray" ? <Dropdown align="right" items={TRAY} onDone={() => setOpen(null)} /> : null}
            </AnimatePresence>
          </div>
        ) : null}
        <span className="grid h-[22px] place-items-center px-[7px]">
          <Battery className="h-[11px]" />
        </span>
        <span className="grid h-[22px] place-items-center px-[7px]">
          <Wifi className="h-[13px]" />
        </span>
        <span className="grid h-[22px] place-items-center px-[7px]">
          <Search className="h-[13px]" />
        </span>
        <span className="grid h-[22px] place-items-center px-[7px]">
          <ControlCenter className="h-[13px]" />
        </span>
        <span className="pl-[7px] pr-1 tabular-nums whitespace-pre">{clock(now)}</span>
      </div>
    </div>
  );
}
