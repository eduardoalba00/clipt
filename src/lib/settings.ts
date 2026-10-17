/** Remembered between launches: the last look, and the record options. */
import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_LOOK, type Look } from "./recipe";

export type RecordOptions = { mic: boolean; camera: boolean };

let store: Promise<Store> | null = null;

function settings(): Promise<Store> {
  store ??= load("settings.json", { autoSave: 300, defaults: {} });
  return store;
}

export async function loadLook(): Promise<Look> {
  try {
    const saved = await (await settings()).get<Partial<Look>>("look");
    if (!saved) return DEFAULT_LOOK;
    // Merge so a look saved by an older version still has every field.
    return {
      style: { ...DEFAULT_LOOK.style, ...saved.style },
      frame: { ...DEFAULT_LOOK.frame, ...saved.frame },
      camera: { ...DEFAULT_LOOK.camera, ...saved.camera },
      output: { ...DEFAULT_LOOK.output, ...saved.output },
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export async function saveLook(look: Look): Promise<void> {
  try {
    await (await settings()).set("look", look);
  } catch {
    // Remembering is best effort.
  }
}

export async function loadRecordOptions(): Promise<RecordOptions> {
  try {
    const saved = await (await settings()).get<RecordOptions>("record");
    return { mic: saved?.mic ?? false, camera: saved?.camera ?? false };
  } catch {
    return { mic: false, camera: false };
  }
}

export async function saveRecordOptions(options: RecordOptions): Promise<void> {
  try {
    await (await settings()).set("record", options);
  } catch {
    // Best effort.
  }
}
