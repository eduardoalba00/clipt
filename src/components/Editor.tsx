import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clamp, formatTime } from "../lib/geometry";
import { history, useHistory } from "../lib/history";
import { useLatest } from "../lib/hooks";
import { ipc, message, on, type Playback, type TakeInfo } from "../lib/ipc";
import { lookOf, MIN_CLIP, type Recipe, type Scene } from "../lib/recipe";
import { saveLook } from "../lib/settings";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import { PrimaryButton, Shimmer } from "./ui/controls";
import { Alert, Check, Plus, Redo, Undo } from "./ui/icons";
import { Tooltip } from "./ui/overlays";

/** X rejects videos longer than this. */
const X_MAX = 140;

type ExportState =
  | { phase: "idle" }
  | { phase: "running"; progress: number }
  | { phase: "done"; name: string }
  | { phase: "failed"; message: string };

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Sends the recipe to Rust as it changes, never more than one call in flight. */
function useScene(recipe: Recipe | null, cropping: boolean, gesture: boolean) {
  const [scene, setScene] = useState<Scene | null>(null);
  const pending = useRef<{ recipe: Recipe; cropping: boolean; persist: boolean } | null>(null);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      try {
        setScene(await ipc.setRecipe(next.recipe, next.cropping, next.persist));
      } catch (e) {
        console.error(message(e));
      }
    }
    busy.current = false;
  }, []);

  useEffect(() => {
    if (!recipe) return;
    pending.current = { recipe, cropping, persist: !gesture };
    void flush();
  }, [recipe, cropping, gesture, flush]);

  return scene;
}

export function Editor({ take, onNew }: { take: TakeInfo; onNew: () => void }) {
  const h = useHistory();
  const recipe = h.present;
  const gesture = h.base !== null;
  const [cropping, setCropping] = useState(false);
  const scene = useScene(recipe, cropping, gesture);
  const [playback, setPlayback] = useState<Playback>({ time: recipe?.trim.start ?? 0, playing: false });
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [exp, setExp] = useState<ExportState>({ phase: "idle" });
  const playRef = useLatest(playback);
  const recipeRef = useLatest(recipe);

  useEffect(() => on("playback", setPlayback), []);
  useEffect(
    () =>
      on("thumbnails", (t) => {
        if (t.id === take.id) setThumbs(t.paths.map((p) => convertFileSrc(p)));
      }),
    [take.id],
  );

  // Remember the look for the next take, once a change settles.
  useEffect(() => {
    if (!recipe || gesture) return;
    const timer = window.setTimeout(() => void saveLook(lookOf(recipe)), 400);
    return () => window.clearTimeout(timer);
  }, [recipe, gesture]);

  const apply = useCallback((next: Recipe) => history.apply(next), []);

  const startExport = useCallback(async () => {
    const r = recipeRef.current;
    if (!r) return;
    setCropping(false);
    void ipc.pause();
    setExp({ phase: "running", progress: 0 });
    try {
      await ipc.exportTake(r);
    } catch (e) {
      setExp({ phase: "failed", message: message(e) });
    }
  }, [recipeRef]);

  useEffect(() => {
    const offs = [
      on("export-progress", (p) => setExp((s) => (s.phase === "running" ? { phase: "running", progress: p } : s))),
      on("export-done", (e) => setExp({ phase: "done", name: e.name })),
      on("export-failed", (m) => setExp({ phase: "failed", message: m })),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    if (exp.phase !== "done" && exp.phase !== "failed") return;
    const timer = window.setTimeout(() => setExp({ phase: "idle" }), exp.phase === "done" ? 4000 : 8000);
    return () => window.clearTimeout(timer);
  }, [exp.phase]);

  useEffect(() => {
    const run = () => {
      if (exp.phase !== "running") void startExport();
    };
    window.addEventListener("clipt:export", run);
    return () => window.removeEventListener("clipt:export", run);
  }, [exp.phase, startExport]);

  // Single-key shortcuts. ⌘ shortcuts come through the app menu.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (document.querySelector("[role=alertdialog]")) return;
      const r = recipeRef.current;
      if (!r) return;
      const t = playRef.current.time;
      switch (e.key) {
        case " ":
          e.preventDefault();
          void ipc.togglePlay();
          break;
        case "i":
        case "I":
          e.preventDefault();
          apply({ ...r, trim: { ...r.trim, start: clamp(t, 0, r.trim.end - MIN_CLIP) } });
          break;
        case "o":
        case "O":
          e.preventDefault();
          apply({ ...r, trim: { ...r.trim, end: clamp(t, r.trim.start + MIN_CLIP, take.duration) } });
          break;
        case "c":
        case "C":
          e.preventDefault();
          setCropping((c) => !c);
          break;
        case "Escape":
        case "Enter":
          if (cropping) {
            e.preventDefault();
            setCropping(false);
          }
          break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [apply, cropping, take.duration, playRef, recipeRef]);

  if (!recipe) return null;
  const length = recipe.trim.end - recipe.trim.start;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="relative flex h-10 shrink-0 items-center pr-2 pl-[84px]">
          <Tooltip label="New recording" keys={["⌘", "N"]}>
            <button
              type="button"
              aria-label="New recording"
              onClick={onNew}
              className="grid size-7 place-items-center rounded-md text-content/55 hover:bg-selection hover:text-content"
            >
              <Plus size={15} />
            </button>
          </Tooltip>
          <div
            data-tauri-drag-region
            className="pointer-events-none absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-1.5 text-[12px]"
          >
            <span className="max-w-[40%] truncate text-content/75">{take.name}</span>
            <span className="text-content/35 tabular">{formatTime(take.duration, false)}</span>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip label="Undo" keys={["⌘", "Z"]}>
              <button
                type="button"
                aria-label="Undo"
                disabled={!h.past.length}
                onClick={() => history.undo()}
                className="grid size-7 place-items-center rounded-md text-content/55 hover:bg-selection hover:text-content disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Undo size={15} />
              </button>
            </Tooltip>
            <Tooltip label="Redo" keys={["⌘", "⇧", "Z"]}>
              <button
                type="button"
                aria-label="Redo"
                disabled={!h.future.length}
                onClick={() => history.redo()}
                className="grid size-7 place-items-center rounded-md text-content/55 hover:bg-selection hover:text-content disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Redo size={15} />
              </button>
            </Tooltip>
          </div>
        </header>

        <Preview
          scene={scene}
          cropping={cropping}
          crop={recipe.crop}
          source={{ width: take.width, height: take.height }}
          onCropInput={(crop) => history.preview({ ...recipe, crop })}
          onCropCommit={() => history.commit()}
          onTogglePlay={() => void ipc.togglePlay()}
        />

        <Timeline
          duration={take.duration}
          trim={recipe.trim}
          playback={playback}
          thumbs={thumbs}
          tooLong={length > X_MAX}
          onTrimInput={(trim) => history.preview({ ...recipe, trim })}
          onTrimCommit={() => history.commit()}
          onSeek={(t) => {
            setPlayback((p) => ({ ...p, time: t }));
            void ipc.seek(t);
          }}
          onTogglePlay={() => void ipc.togglePlay()}
        />
      </div>

      <aside className="sidebar-glass flex w-[268px] shrink-0 flex-col border-l border-stroke">
        <div data-tauri-drag-region className="flex h-10 shrink-0 items-center justify-end gap-2 px-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {exp.phase === "running" ? (
              <motion.span
                key="running"
                initial={{ opacity: 0, filter: "blur(3px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(3px)" }}
                className="text-[12px] tabular"
              >
                <Shimmer>{`Exporting · ${Math.round(exp.progress * 100)}%`}</Shimmer>
              </motion.span>
            ) : exp.phase === "done" ? (
              <motion.span
                key="done"
                title={exp.name}
                initial={{ opacity: 0, filter: "blur(3px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(3px)" }}
                className="flex items-center gap-1.5 text-[12px] text-content/70"
              >
                <Check size={14} className="text-emerald-400" />
                Copied to clipboard
              </motion.span>
            ) : exp.phase === "failed" ? (
              <motion.span
                key="failed"
                title={exp.message}
                initial={{ opacity: 0, filter: "blur(3px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(3px)" }}
                className="flex min-w-0 items-center gap-1.5 text-[12px] text-warning"
              >
                <Alert size={14} className="shrink-0" />
                <span className="truncate">Export failed</span>
              </motion.span>
            ) : null}
          </AnimatePresence>
          {exp.phase !== "running" ? (
            <Tooltip label="Export MP4" keys={["⌘", "E"]}>
              <PrimaryButton onClick={() => void startExport()} className="h-7">
                Export
              </PrimaryButton>
            </Tooltip>
          ) : null}
        </div>
        <Inspector
          recipe={recipe}
          hasCamera={take.hasCamera}
          cropping={cropping}
          onApply={apply}
          onInput={(r) => history.preview(r)}
          onCommit={() => history.commit()}
          onToggleCrop={() => setCropping((c) => !c)}
        />
      </aside>
    </div>
  );
}
