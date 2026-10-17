/** The pretend Mac, filling the browser window. */
import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { seedExamples } from "../backend/clipt";
import { setWallpaper } from "../backend/clip";
import { desktop, useDesktop } from "../backend/state";
import { DesktopIcon, Dock, Prompt } from "./Chrome";
import { CliptWindow } from "./CliptWindow";
import { About, Finder, QuickLook } from "./Finder";
import { MenuBar } from "./MenuBar";
import { RecordingLayer, SampleWindow } from "./Recording";

export function wallpaperUrl() {
  return (window.devicePixelRatio || 1) > 1.25 || window.innerWidth > 1700 ? "/wallpaper.webp" : "/wallpaper-1600.webp";
}

export function Desktop() {
  const stack = useDesktop((s) => s.stack);

  useEffect(() => {
    // Recordings draw the desktop too, so they need the same picture.
    const img = new Image();
    img.src = wallpaperUrl();
    setWallpaper(img);
    const seed = () => seedExamples();
    if (img.complete) seed();
    else {
      img.addEventListener("load", seed, { once: true });
      img.addEventListener("error", seed, { once: true });
    }
  }, []);

  return (
    <main className="desktop absolute inset-0 overflow-hidden" aria-label="Clipt, running on a pretend Mac">
      <div
        aria-hidden
        className="absolute inset-0"
        onPointerDown={() => desktop.set({ active: "finder" })}
      />
      <DesktopIcon />
      <SampleWindow />
      <CliptWindow />
      <AnimatePresence>
        {stack.includes("finder") ? <Finder key="finder" /> : null}
        {stack.includes("quicklook") ? <QuickLook key="quicklook" /> : null}
        {stack.includes("about") ? <About key="about" /> : null}
      </AnimatePresence>
      <Dock />
      <RecordingLayer />
      <MenuBar />
      <Prompt />
    </main>
  );
}
