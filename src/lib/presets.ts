/** Names and swatches for the background presets. The colours that end up in
 * the video live in `src-tauri/src/scene.rs` (`PRESETS`); keep them in sync. */

export type Preset = { id: string; name: string; from: string; to?: string };

export const PRESETS: readonly Preset[] = [
  { id: "dawn", name: "Dawn", from: "#F9C6E0", to: "#A9C2F0" },
  { id: "seaGlass", name: "Sea glass", from: "#A8E6E2", to: "#F6D6E4" },
  { id: "apricot", name: "Apricot", from: "#F7D58B", to: "#F4A28C" },
  { id: "sage", name: "Sage", from: "#DCE8D2", to: "#9DB89A" },
  { id: "dusk", name: "Dusk", from: "#232A47", to: "#5E4A8C" },
  { id: "graphite", name: "Graphite", from: "#3A3A3D", to: "#161618" },
  { id: "paper", name: "Paper", from: "#F3F0EA" },
  { id: "ink", name: "Ink", from: "#111113" },
];

export function swatch(p: Preset): string {
  return p.to ? `linear-gradient(135deg, ${p.from}, ${p.to})` : p.from;
}
