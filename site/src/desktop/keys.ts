/**
 * Keys on the pretend Mac. Registered before any of Clipt's own listeners,
 * so keys only reach Clipt's page while its window is in front, as on a Mac.
 */
import { cancel, openRecordings, quit, stopRecording } from "../backend/clipt";
import { emit } from "../backend/events";
import { close, desktop, hideClipt } from "../backend/state";
import { openQuickLook } from "./Finder";

function cliptCommand(e: KeyboardEvent): (() => void) | null {
  const k = e.key.toLowerCase();
  if (k === "n") return () => emit("menu", "new");
  if (k === "e") return () => emit("menu", "export");
  if (k === "z") return () => emit("menu", e.shiftKey ? "redo" : "undo");
  if (k === "o" && e.shiftKey) return openRecordings;
  if (k === "w" || k === "h" || k === "m") return hideClipt;
  if (k === "q") return quit;
  return null;
}

window.addEventListener(
  "keydown",
  (e) => {
    const s = desktop.get();
    const swallow = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // Clipt's global shortcut.
    if (e.metaKey && e.shiftKey && e.code === "Digit2") {
      swallow();
      void stopRecording();
      return;
    }
    if (s.phase.kind === "selecting" || s.phase.kind === "picking") {
      if (e.key === "Escape") cancel();
      swallow();
      return;
    }
    if (s.prompt) {
      if (e.key === "Escape") {
        swallow();
        s.prompt.answer(false);
      }
      return;
    }

    const top = s.stack[s.stack.length - 1];
    const cliptActive = s.running && s.active === "clipt";
    if (e.metaKey && cliptActive) {
      const run = cliptCommand(e);
      if (run) {
        swallow();
        run();
      }
      return;
    }

    const cliptKey = cliptActive && s.cliptVisible && top === "clipt";
    if (cliptKey) return;
    if (e.target instanceof HTMLInputElement) return;

    // Finder and Quick Look.
    if (top === "quicklook" && (e.key === " " || e.key === "Escape")) {
      swallow();
      close("quicklook");
      return;
    }
    if (top === "finder" && e.key === " " && s.selected) {
      const rec = s.recordings.find((r) => r.name === s.selected);
      swallow();
      if (rec) openQuickLook(rec);
      return;
    }
    // Keys for another window never reach Clipt's page.
    e.stopImmediatePropagation();
  },
  true,
);
