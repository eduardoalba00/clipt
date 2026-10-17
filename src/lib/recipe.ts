/** Mirrors `src-tauri/src/scene.rs`. The recipe is what the user chose; the
 * scene is what Rust laid out from it. */

export type Aspect = "auto" | "16:9" | "1:1" | "4:5";
export type Fps = 30 | 60;
export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export type Background =
  | { kind: "preset"; id: string }
  | { kind: "solid"; color: string };

export type NormRect = { x: number; y: number; w: number; h: number };

export type Style = {
  background: Background;
  padding: number;
  radius: number;
  shadow: boolean;
};

export type BrowserFrame = { enabled: boolean; url: string; dark: boolean };

export type CameraBubble = { visible: boolean; corner: Corner; size: number };

export type Output = { aspect: Aspect; fps: Fps };

export type Recipe = {
  trim: { start: number; end: number };
  crop: NormRect | null;
  style: Style;
  frame: BrowserFrame;
  camera: CameraBubble;
  output: Output;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Scene = {
  width: number;
  height: number;
  card: Rect;
  video: Rect;
  sourceCrop: Rect;
  plain: boolean;
  fps: number;
};

/** The parts of a recipe remembered between takes. */
export type Look = Pick<Recipe, "style" | "frame" | "camera" | "output">;

export const DEFAULT_LOOK: Look = {
  style: {
    background: { kind: "preset", id: "dawn" },
    padding: 0.45,
    radius: 0.5,
    shadow: true,
  },
  frame: { enabled: false, url: "myapp.com", dark: false },
  camera: { visible: true, corner: "bottomRight", size: 0.4 },
  output: { aspect: "auto", fps: 60 },
};

export function freshRecipe(look: Look, duration: number): Recipe {
  return {
    ...structuredClone(look),
    trim: { start: 0, end: duration },
    crop: null,
  };
}

export function lookOf(recipe: Recipe): Look {
  return {
    style: recipe.style,
    frame: recipe.frame,
    camera: recipe.camera,
    output: recipe.output,
  };
}

export const MIN_CLIP = 0.2;

export function sameRecipe(a: Recipe, b: Recipe): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
