/** The events Clipt's Rust side sends the page (see `on` in src/lib/ipc.ts). */
import type { Exported, MenuAction, Playback, RecordingEvent } from "../../../src/lib/ipc";

export type Events = {
  playback: Playback;
  thumbnails: { id: string; paths: string[] };
  "export-progress": number;
  "export-done": Exported;
  "export-failed": string;
  menu: MenuAction;
  recording: RecordingEvent;
};

const handlers = new Map<keyof Events, Set<(payload: never) => void>>();

/** Thumbnails can be ready before the editor listens; they wait for it. */
const STICKY = new Set<keyof Events>(["thumbnails"]);
const latest = new Map<keyof Events, unknown>();

export function emit<K extends keyof Events>(name: K, payload: Events[K]) {
  if (STICKY.has(name)) latest.set(name, payload);
  // Like Tauri, delivered after the current call returns.
  queueMicrotask(() => {
    for (const h of handlers.get(name) ?? []) (h as (p: Events[K]) => void)(payload);
  });
}

export function listen<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(handler as (payload: never) => void);
  if (latest.has(name)) {
    const payload = latest.get(name) as Events[K];
    queueMicrotask(() => {
      if (set.has(handler as (payload: never) => void)) handler(payload);
    });
  }
  return () => set.delete(handler as (payload: never) => void);
}
