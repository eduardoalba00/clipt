/**
 * Clipt's Rust side, pretended: takes, recording, export and permissions.
 * The fake `ipc` (shims/ipc.ts) is a thin layer over this.
 */
import { useSyncExternalStore } from "react";
import type { Leftover, Permission, Permissions, RecordKind, TakeInfo } from "../../../src/lib/ipc";
import type { Recipe, Rect } from "../../../src/lib/recipe";
import { DEMO_VIDEO } from "../config";
import { openVideo, ScreenClip, thumbnails, type Clip, type CursorSample } from "./clip";
import { emit } from "./events";
import { sampleRect, screenSize } from "./layout";
import { player } from "./player";
import { compose } from "./render";
import { buildScene, plainScene, type FullScene } from "./scene";
import { close, desktop, hideClipt, launch, raise, showClipt, type Recording, type Target } from "./state";

type Take = { info: TakeInfo; clip: Clip };

let current: Take | null = null;
let leftover: (Take & { created: number }) | null = null;
let exporting = false;
let screenOnRelaunch = false;

// ---------------------------------------------------------------------------
// The preview layer: what the native player view would be showing.

export type PreviewState = {
  scene: FullScene | null;
  clip: Clip | null;
  /** The hole Clipt's page leaves for the player, relative to the window. */
  hole: Rect | null;
  visible: boolean;
};

let preview: PreviewState = { scene: null, clip: null, hole: null, visible: false };
const previewListeners = new Set<() => void>();

function setPreview(patch: Partial<PreviewState>) {
  preview = { ...preview, ...patch };
  for (const l of previewListeners) l();
}

export function usePreview(): PreviewState {
  return useSyncExternalStore(
    (l) => {
      previewListeners.add(l);
      return () => previewListeners.delete(l);
    },
    () => preview,
  );
}

// ---------------------------------------------------------------------------
// Takes

/** Names of files dropped on the window, by their blob URL. */
const files = new Map<string, string>();

export function registerFile(url: string, name: string) {
  files.set(url, name);
}

function open(take: Take) {
  current = take;
  const trim = take.info.recipe?.trim ?? { start: 0, end: take.info.duration };
  player.open(take.clip, trim.start, trim.end);
  setPreview({ clip: take.clip, scene: null });
  const id = take.info.id;
  void thumbnails(take.clip, 24, 96).then((paths) => {
    if (current?.info.id === id) emit("thumbnails", { id, paths });
  });
}

function info(id: string, name: string, clip: Clip, hasAudio: boolean): TakeInfo {
  return {
    id,
    name,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    fps: 60,
    hasAudio,
    hasCamera: clip.hasCamera,
    exported: false,
    recipe: null,
  };
}

export async function importVideo(path: string): Promise<TakeInfo> {
  const clip = await openVideo(path);
  const name = (files.get(path) ?? "Video").replace(/\.[^.]+$/, "");
  const take = { info: info(`${Date.now()}`, name, clip, true), clip };
  open(take);
  return take.info;
}

export function leftoverTake(): Leftover | null {
  return leftover ? { id: leftover.info.id, name: leftover.info.name, created: leftover.created } : null;
}

export function resumeTake(id: string): TakeInfo {
  if (!leftover || leftover.info.id !== id) throw "That take is gone";
  const take = leftover;
  leftover = null;
  open(take);
  return take.info;
}

export function discardLeftover() {
  leftover = null;
}

export function discardTake() {
  player.close();
  current = null;
  setPreview({ scene: null, clip: null, visible: false });
}

export function setRecipe(recipe: Recipe, cropping: boolean): FullScene {
  if (!current) throw "No take is open";
  current.info = { ...current.info, recipe };
  player.setTrim(recipe.trim.start, recipe.trim.end);
  const source = { width: current.clip.width, height: current.clip.height, hasCamera: current.clip.hasCamera };
  const scene = cropping ? plainScene(source, recipe.output.fps) : buildScene(recipe, source);
  setPreview({ scene, visible: true });
  return scene;
}

export function previewInsets(top: number, right: number, bottom: number, left: number) {
  const win = document.getElementById("clipt-window")?.getBoundingClientRect();
  if (!win) return;
  setPreview({
    hole: {
      x: left - win.left,
      y: top - win.top,
      w: window.innerWidth - right - left,
      h: window.innerHeight - bottom - top,
    },
    visible: true,
  });
}

export function previewVisible(visible: boolean) {
  setPreview({ visible });
}

// ---------------------------------------------------------------------------
// Export

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/** "Clipt 2026-10-17 at 14.32.05.mp4", made unique in the folder. */
function fileName(d: Date): string {
  const base = `Clipt ${stamp(d)}`;
  const taken = new Set(desktop.get().recordings.map((r) => r.name));
  let name = `${base}.mp4`;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}.mp4`;
  return name;
}

/** A still of the export at its first frame, for Finder. */
export function poster(recipe: Recipe, clip: Clip, width = 320): string {
  const scene = buildScene(recipe, { width: clip.width, height: clip.height, hasCamera: clip.hasCamera });
  const canvas = document.createElement("canvas");
  const k = (width * 2) / scene.width;
  canvas.width = Math.round(scene.width * k);
  canvas.height = Math.round(scene.height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(k, k);
  compose(ctx, scene, clip, recipe.trim.start);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function exportTake(recipe: Recipe) {
  if (exporting) throw "An export is already running";
  if (!current) throw "No take is open";
  exporting = true;
  const take = current;
  const length = recipe.trim.end - recipe.trim.start;
  const total = Math.min(Math.max(length * 140, 1400), 3600);
  const began = performance.now();
  const step = () => {
    const p = Math.min((performance.now() - began) / total, 1);
    emit("export-progress", p);
    if (p < 1) {
      window.setTimeout(step, 60);
      return;
    }
    exporting = false;
    const name = fileName(new Date());
    const recording: Recording = { name, created: Date.now(), recipe, clip: take.clip, thumb: poster(recipe, take.clip) };
    take.info = { ...take.info, exported: true };
    desktop.set((s) => ({ recordings: [...s.recordings, recording], selected: name }));
    // Revealed in Finder and copied to the clipboard, as on a Mac.
    raise("finder");
    emit("export-done", { id: take.info.id, path: `~/Movies/Clipt/${name}`, name });
  };
  window.setTimeout(step, 60);
}

export function openRecordings() {
  desktop.set({ selected: null });
  raise("finder");
}

// ---------------------------------------------------------------------------
// Recording

let pointer = { x: 0, y: 0 };
let options: { mic: boolean; camera: boolean; source: RecordKind } = { mic: false, camera: false, source: "screen" };
let samples: CursorSample[] = [];
let sampleShown = 0;

/** Seconds the pretend app window has been open. */
export const sampleTime = () => (performance.now() - sampleShown) / 1000;

window.addEventListener(
  "pointermove",
  (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    const phase = desktop.get().phase;
    if (phase.kind === "recording") samples.push({ t: (performance.now() - phase.started) / 1000, ...pointer });
  },
  { capture: true, passive: true },
);

/** The pointer's last position on the page. */
export const pointerAt = () => pointer;

export function startRecording(kind: RecordKind, mic: boolean, camera: boolean) {
  const s = desktop.get();
  if (s.phase.kind !== "idle") throw "Already recording";
  if (current) throw "Close the open take first";
  if (mic && s.permissions.mic !== "granted") throw "Clipt isn't allowed to use the microphone";
  if (camera && s.permissions.camera !== "granted") throw "Clipt isn't allowed to use the camera";
  options = { mic, camera, source: kind };
  // Get Clipt out of the way while choosing and recording.
  hideClipt();
  sampleShown = performance.now();
  desktop.set({ phase: kind === "selection" ? { kind: "selecting" } : { kind: "picking", mode: kind } });
}

/** The picker or the selection overlay settled on something to record. */
export function begin(target: Target) {
  const started = performance.now();
  samples = [{ t: 0, ...pointer }];
  desktop.set({ phase: { kind: "recording", target, started, ...options } });
  emit("recording", { state: "started" });
}

export function cancel() {
  desktop.set({ phase: { kind: "idle" } });
  showClipt();
  emit("recording", { state: "cancelled" });
}

function regionOf(target: Target): Rect {
  const { w, h } = screenSize();
  return target.kind === "screen" ? { x: 0, y: 0, w, h } : target.rect;
}

export async function stopRecording() {
  const phase = desktop.get().phase;
  if (phase.kind !== "recording") return;
  const elapsed = Math.max((performance.now() - phase.started) / 1000, 0.5);
  desktop.set({ phase: { kind: "idle" } });
  let clip: Clip;
  try {
    clip = DEMO_VIDEO
      ? await openVideo(DEMO_VIDEO)
      : new ScreenClip(
          regionOf(phase.target),
          screenSize(),
          sampleRect(),
          (phase.started - sampleShown) / 1000,
          samples,
          elapsed,
          phase.camera,
        );
  } catch (e) {
    showClipt();
    emit("recording", { state: "failed", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  const take = { info: info(`${Date.now()}`, "Recording", clip, phase.mic), clip };
  open(take);
  showClipt();
  emit("recording", { state: "finished", take: take.info });
}

// ---------------------------------------------------------------------------
// Permissions

export function permissions(): Permissions {
  return desktop.get().permissions;
}

/** Shows the system prompt and waits for the answer. */
export function requestPermission(what: Permission): Promise<Permissions> {
  const s = desktop.get();
  if (s.permissions[what] !== "notAsked") return Promise.resolve(s.permissions);
  return new Promise((resolve) => {
    desktop.set({
      prompt: {
        what,
        answer: (allow) => {
          desktop.set((d) => ({
            prompt: null,
            // Screen recording only takes effect once Clipt reopens.
            permissions:
              what === "screen" ? d.permissions : { ...d.permissions, [what]: allow ? "granted" : "denied" },
          }));
          if (what === "screen") {
            if (allow) screenOnRelaunch = true;
            else desktop.set((d) => ({ permissions: { ...d.permissions, screen: "denied" } }));
          }
          resolve(desktop.get().permissions);
        },
      },
    });
  });
}

/** Stands in for System Settings: the user switches Clipt on there. */
export function openPrivacy(what: Permission) {
  if (what === "screen") screenOnRelaunch = true;
  else desktop.set((d) => ({ permissions: { ...d.permissions, [what]: "granted" } }));
}

// ---------------------------------------------------------------------------
// The app itself

export function quit() {
  desktop.set({ phase: { kind: "idle" } });
  if (current && !current.info.exported) leftover = { ...current, created: Date.now() };
  discardTake();
  close("about");
  hideClipt();
  desktop.set({ running: false, mode: "launcher", zoomed: false, phase: { kind: "idle" } });
}

export function relaunch() {
  quit();
  if (screenOnRelaunch) {
    screenOnRelaunch = false;
    desktop.set((d) => ({ permissions: { ...d.permissions, screen: "granted" } }));
  }
  launch();
}

export function setMode(mode: "launcher" | "editor") {
  desktop.set({ mode, zoomed: false });
}

export function showMain() {
  showClipt();
}

// ---------------------------------------------------------------------------
// A couple of earlier exports, so Finder isn't empty the first time.

export function seedExamples() {
  if (desktop.get().recordings.length) return;
  const screen = screenSize();
  const sample = sampleRect();
  const path = (duration: number, phase: number): CursorSample[] =>
    Array.from({ length: Math.round(duration * 30) + 1 }, (_, i) => {
      const t = i / 30;
      return {
        t,
        x: sample.x + sample.w * (0.55 + 0.3 * Math.sin(t * 0.7 + phase)),
        y: sample.y + sample.h * (0.5 + 0.28 * Math.sin(t * 1.1 + phase * 2)),
      };
    });
  const looks: { ago: number; camera: boolean; recipe: (d: number) => Recipe }[] = [
    {
      ago: 26 * 3600e3,
      camera: true,
      recipe: (d) => ({
        trim: { start: 0, end: d },
        crop: null,
        style: { background: { kind: "preset", id: "dawn" }, padding: 0.45, radius: 0.5, shadow: true },
        frame: { enabled: true, url: "myapp.com", dark: false },
        camera: { visible: true, corner: "bottomRight", size: 0.35 },
        output: { aspect: "auto", fps: 60 },
      }),
    },
    {
      ago: 3 * 3600e3,
      camera: false,
      recipe: (d) => ({
        trim: { start: 0.5, end: d },
        crop: null,
        style: { background: { kind: "preset", id: "dusk" }, padding: 0.35, radius: 0.6, shadow: true },
        frame: { enabled: false, url: "myapp.com", dark: true },
        camera: { visible: false, corner: "bottomRight", size: 0.4 },
        output: { aspect: "16:9", fps: 60 },
      }),
    },
  ];
  const recordings = looks.map((look, i): Recording => {
    const duration = 9;
    const clip = new ScreenClip(sample, screen, sample, 4, path(duration, i * 1.7), duration, look.camera);
    const recipe = look.recipe(duration);
    const created = Date.now() - look.ago;
    return { name: `Clipt ${stamp(new Date(created))}.mp4`, created, recipe, clip, thumb: poster(recipe, clip) };
  });
  desktop.set({ recordings });
}
