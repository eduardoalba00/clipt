/** Stands in for src/lib/ipc.ts: the same calls, answered in the browser. */
import type { ipc as Real } from "../../../src/lib/ipc";
import * as clipt from "../backend/clipt";
import { listen, type Events } from "../backend/events";
import { player } from "../backend/player";

export type * from "../../../src/lib/ipc";

/** Like `invoke`: always async, and errors arrive as strings. */
function call<T>(run: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      Promise.resolve(run()).then(resolve, (e) => reject(message(e)));
    } catch (e) {
      reject(message(e));
    }
  });
}

const none = () => call(() => undefined);

export const ipc: typeof Real = {
  importVideo: (path) => call(() => clipt.importVideo(path)),
  leftoverTake: () => call(clipt.leftoverTake),
  resumeTake: (id) => call(() => clipt.resumeTake(id)),
  discardLeftover: () => call(clipt.discardLeftover),
  addBackground: (path) => call(() => path),
  setRecipe: (recipe, cropping) => call(() => clipt.setRecipe(recipe, cropping)),
  previewInsets: (top, right, bottom, left) => call(() => clipt.previewInsets(top, right, bottom, left)),
  previewVisible: (visible) => call(() => clipt.previewVisible(visible)),
  togglePlay: () => call(player.toggle),
  pause: () => call(player.pause),
  seek: (time) => call(() => player.seek(time)),
  discardTake: () => call(clipt.discardTake),
  exportTake: (recipe) => call(() => clipt.exportTake(recipe)),
  openRecordings: () => call(clipt.openRecordings),
  setAppearance: none,
  setMode: (mode) => call(() => clipt.setMode(mode)),
  ready: none,
  quit: () => call(clipt.quit),
  startRecording: (kind, mic, camera) => call(() => clipt.startRecording(kind, mic, camera)),
  stopRecording: () => call(clipt.stopRecording),
  permissions: () => call(clipt.permissions),
  requestPermission: (what) => call(() => clipt.requestPermission(what)),
  openPrivacy: (what) => call(() => clipt.openPrivacy(what)),
  relaunch: () => call(clipt.relaunch),
};

export function on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): () => void {
  return listen(name, handler);
}

export function message(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
