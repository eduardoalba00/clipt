/** The rest of the desktop: the permission prompt, Clipt's desktop icon, and
 * the download bar where the Dock would be. */
import { motion } from "motion/react";
import { useState } from "react";
import type { Permission } from "../../../src/lib/ipc";
import { launch, useDesktop } from "../backend/state";
import { dockHeight } from "../backend/layout";
import { DOWNLOAD_URL, GITHUB_URL } from "../config";
import { useViewport } from "./hooks";
import { AppleLogo, GitHubLogo } from "./glyphs";

const ASKS: Record<Permission, { title: string; body: string; allow: string; deny: string }> = {
  camera: {
    title: "“Clipt” would like to access the camera.",
    body: "Clipt records your camera when the camera is on.",
    allow: "Allow",
    deny: "Don’t Allow",
  },
  mic: {
    title: "“Clipt” would like to access the microphone.",
    body: "Clipt records your voice when the mic is on.",
    allow: "Allow",
    deny: "Don’t Allow",
  },
  screen: {
    title: "“Clipt” would like to record this computer’s screen and audio.",
    body: "Grant access to this application in Privacy & Security settings, located in System Settings.",
    allow: "Open System Settings",
    deny: "Deny",
  },
};

/** macOS's privacy prompt (Info.plist's usage strings). */
export function Prompt() {
  const prompt = useDesktop((s) => s.prompt);
  if (!prompt) return null;
  const ask = ASKS[prompt.what];
  const stacked = prompt.what === "screen";
  return (
    <motion.div
      role="alertdialog"
      aria-label={ask.title}
      className="menu-glass absolute top-[22%] left-1/2 z-[95] w-[260px] -translate-x-1/2 rounded-[14px] p-4 text-center text-white"
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.16 }}
    >
      <img src="/icon.svg" alt="" draggable={false} className="mx-auto size-16" />
      <h2 className="mt-2 text-[13px] leading-snug font-bold">{ask.title}</h2>
      <p className="mt-1.5 text-[11px] leading-snug text-white/75">{ask.body}</p>
      <div className={`mt-4 flex gap-2 ${stacked ? "flex-col" : ""}`}>
        {(stacked ? [true, false] : [false, true]).map((allow) => (
          <button
            key={String(allow)}
            type="button"
            autoFocus={allow}
            onClick={() => prompt.answer(allow)}
            className={`h-7 flex-1 rounded-[6px] text-[13px] ${
              allow ? "bg-[#0a64d8] text-white hover:bg-[#1f74e6]" : "bg-white/15 text-white/90 hover:bg-white/22"
            }`}
          >
            {allow ? ask.allow : ask.deny}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/** Clipt.app on the desktop: double-click to open it again. */
export function DesktopIcon() {
  const [picked, setPicked] = useState(false);
  return (
    <button
      type="button"
      aria-label="Open Clipt"
      className="absolute top-10 right-5 z-[5] flex w-[84px] flex-col items-center gap-1 outline-none"
      onPointerDown={(e) => {
        e.stopPropagation();
        setPicked(true);
        const off = () => {
          setPicked(false);
          window.removeEventListener("pointerdown", off);
        };
        window.setTimeout(() => window.addEventListener("pointerdown", off), 0);
      }}
      onDoubleClick={launch}
      onKeyDown={(e) => {
        if (e.key === "Enter") launch();
      }}
    >
      <span className={`grid size-[68px] place-items-center rounded-[6px] ${picked ? "bg-black/30 ring-1 ring-white/20" : ""}`}>
        <img src="/icon.svg" alt="" draggable={false} className="size-16" />
      </span>
      <span
        className={`rounded-[4px] px-1.5 text-[12px] leading-[17px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] ${
          picked ? "bg-[#0a64d8] [text-shadow:none]" : ""
        }`}
      >
        Clipt
      </span>
    </button>
  );
}

function Available() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <p className="text-[10.5px] font-medium tracking-[0.28em] text-white/45 uppercase">Available for</p>
      <div className="flex items-center gap-6 text-[13px] text-white/70">
        <span className="flex items-center gap-1.5">
          <AppleLogo className="size-3.5 -translate-y-px" />
          Apple Silicon
        </span>
        <span className="flex items-center gap-1.5">
          <AppleLogo className="size-3.5 -translate-y-px" />
          Intel
        </span>
        <span className="text-white/45">macOS 14+</span>
      </div>
    </div>
  );
}

export function DownloadButtons({ className = "" }: { className?: string }) {
  const pill = "flex h-11 items-center gap-2.5 rounded-full px-5 text-[15px] font-medium transition-colors";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {DOWNLOAD_URL ? (
        <a href={DOWNLOAD_URL} className={`${pill} bg-white text-black hover:bg-white/90`}>
          <AppleLogo className="size-[18px] -translate-y-px" />
          Download for Mac
        </a>
      ) : (
        <span
          aria-disabled
          title="Clipt is being notarized by Apple. It'll be here soon."
          className={`${pill} cursor-default bg-white/90 pr-2 text-black`}
        >
          <AppleLogo className="size-[18px] -translate-y-px" />
          Download for Mac
          <span className="rounded-full bg-black/8 px-2.5 py-1 text-[11.5px] font-semibold text-black/55">Coming soon</span>
        </span>
      )}
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className={`${pill} border border-white/20 bg-black/35 text-white backdrop-blur-md hover:bg-black/50`}
      >
        <GitHubLogo className="size-[18px]" />
        GitHub
      </a>
    </div>
  );
}

/** Where the Dock would be: getting Clipt for real. */
export function Dock() {
  useViewport();
  const tall = dockHeight() > 100;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex flex-col items-center justify-end gap-4 pb-5"
      style={{ height: dockHeight() }}
    >
      <div className="pointer-events-auto">
        <DownloadButtons />
      </div>
      {tall ? <Available /> : null}
    </div>
  );
}

export { Available };
