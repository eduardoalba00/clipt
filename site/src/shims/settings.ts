/** Stands in for src/lib/settings.ts: remembered for as long as the page is open. */
import { DEFAULT_LOOK, type Look } from "../../../src/lib/recipe";

export type RecordOptions = { mic: boolean; camera: boolean };

const store = new Map<string, unknown>();

const get = <T>(key: string, fallback: T) => Promise.resolve((store.get(key) as T | undefined) ?? fallback);
const set = (key: string, value: unknown) => {
  store.set(key, structuredClone(value));
  return Promise.resolve();
};

export const loadLook = () => get<Look>("look", DEFAULT_LOOK).then((l) => structuredClone(l));
export const saveLook = (look: Look) => set("look", look);
/** The demo starts on the launcher; the permissions step is a click away. */
export const loadOnboarded = () => get("onboarded", true);
export const saveOnboarded = () => set("onboarded", true);
export const loadPicture = () => get<string | null>("picture", null);
export const savePicture = (path: string) => set("picture", path);
export const loadRecordOptions = () => get<RecordOptions>("record", { mic: false, camera: false });
export const saveRecordOptions = (options: RecordOptions) => set("record", options);
