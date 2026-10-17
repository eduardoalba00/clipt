/** Pictures as backgrounds: choosing one, and the file types Clipt takes. */
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "./ipc";
import { savePicture } from "./settings";

export const PICTURE = /\.(png|jpe?g|heic|webp|tiff?|gif)$/i;

/** Copies `path` in as a background and remembers it for the swatch. */
export async function addPicture(path: string): Promise<string> {
  const stored = await ipc.addBackground(path);
  await savePicture(stored);
  return stored;
}

/** Asks for a picture. Resolves to its stored path, or null if cancelled. */
export async function choosePicture(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Choose a background",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "webp", "tiff", "gif"] }],
  });
  return typeof picked === "string" ? addPicture(picked) : null;
}
