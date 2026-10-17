/** Typed wrappers around the Rust commands and events. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Recipe, Scene } from "./recipe";

export type TakeInfo = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasCamera: boolean;
  exported: boolean;
  recipe: Recipe | null;
};

export type Leftover = { id: string; name: string; created: number };

export type RecordKind = "screen" | "selection" | "window";

export type Playback = { time: number; playing: boolean };

export type Exported = { id: string; path: string; name: string };

export type RecordingEvent =
  | { state: "started" }
  | { state: "finished"; take: TakeInfo }
  | { state: "cancelled" }
  | { state: "failed"; message: string };

export type Access = "granted" | "denied" | "notAsked";
export type Permissions = { screen: Access; mic: Access; camera: Access };
export type Permission = keyof Permissions;

export type MenuAction = "new" | "export" | "undo" | "redo" | "stop";

export const ipc = {
  importVideo: (path: string) => invoke<TakeInfo>("import_video", { path }),
  leftoverTake: () => invoke<Leftover | null>("leftover_take"),
  resumeTake: (id: string) => invoke<TakeInfo>("resume_take", { id }),
  discardLeftover: (id: string) => invoke<void>("discard_leftover", { id }),
  /** Copies a picture into Clipt's backgrounds folder; returns its new path. */
  addBackground: (path: string) => invoke<string>("add_background", { path }),
  setRecipe: (recipe: Recipe, cropping: boolean, persist: boolean) =>
    invoke<Scene>("set_recipe", { recipe, cropping, persist }),
  previewInsets: (top: number, right: number, bottom: number, left: number) =>
    invoke<void>("preview_insets", { top, right, bottom, left }),
  previewVisible: (visible: boolean) =>
    invoke<void>("preview_visible", { visible }),
  togglePlay: () => invoke<void>("toggle_play"),
  pause: () => invoke<void>("pause"),
  seek: (time: number) => invoke<void>("seek", { time }),
  discardTake: () => invoke<void>("discard_take"),
  exportTake: (recipe: Recipe) => invoke<void>("export_take", { recipe }),
  openRecordings: () => invoke<void>("open_recordings"),
  setAppearance: (dark: boolean) => invoke<void>("set_appearance", { dark }),
  setMode: (mode: "launcher" | "editor") => invoke<void>("set_mode", { mode }),
  ready: () => invoke<void>("ready"),
  quit: () => invoke<void>("quit"),
  startRecording: (kind: RecordKind, mic: boolean, camera: boolean) =>
    invoke<void>("start_recording", { kind, mic, camera }),
  stopRecording: () => invoke<void>("stop_recording"),
  permissions: () => invoke<Permissions>("permissions"),
  requestPermission: (what: Permission) => invoke<Permissions>("request_permission", { what }),
  openPrivacy: (what: Permission) => invoke<void>("open_privacy", { what }),
  relaunch: () => invoke<void>("relaunch"),
};

type Events = {
  playback: Playback;
  thumbnails: { id: string; paths: string[] };
  "export-progress": number;
  "export-done": Exported;
  "export-failed": string;
  menu: MenuAction;
  recording: RecordingEvent;
};

export function on<K extends keyof Events>(
  name: K,
  handler: (payload: Events[K]) => void,
): () => void {
  let unlisten: UnlistenFn | undefined;
  let gone = false;
  void listen<Events[K]>(name, (e) => handler(e.payload)).then((u) => {
    if (gone) u();
    else unlisten = u;
  });
  return () => {
    gone = true;
    unlisten?.();
  };
}

export function message(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
