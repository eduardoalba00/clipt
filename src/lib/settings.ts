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

/** Whether the permissions step has been seen. */
export async function loadOnboarded(): Promise<boolean> {
  try {
    return (await (await settings()).get<boolean>("onboarded")) ?? false;
  } catch {
    return false;
  }
}

export async function saveOnboarded(): Promise<void> {
  try {
    await (await settings()).set("onboarded", true);
  } catch {
    // Best effort.
  }
}

/** The last picture used as a background, for its swatch. */
export async function loadPicture(): Promise<string | null> {
  try {
    return (await (await settings()).get<string>("picture")) ?? null;
  } catch {
    return null;
  }
}

export async function savePicture(path: string): Promise<void> {
  try {
    await (await settings()).set("picture", path);
  } catch {
    // Best effort.
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
