/** Stands in for src/lib/pictures.ts: pictures come from the browser's file picker. */
import { savePicture } from "./settings";

export const PICTURE = /\.(png|jpe?g|heic|webp|tiff?|gif)$/i;

export async function addPicture(path: string): Promise<string> {
  await savePicture(path);
  return path;
}

export function choosePicture(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? addPicture(URL.createObjectURL(file)) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
