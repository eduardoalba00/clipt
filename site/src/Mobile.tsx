/** Phones and small windows: Clipt's launcher as a picture, and the links. */
import { Launcher } from "../../src/components/Launcher";
import { Available, DownloadButtons } from "./desktop/Chrome";
import { useViewport } from "./desktop/hooks";
import { LAUNCHER } from "./backend/layout";

export function Mobile() {
  const { w, h } = useViewport();
  // Leave room for the buttons and the note below the window.
  const scale = Math.min(1, (w - 48) / LAUNCHER.w, (h - 300) / LAUNCHER.h);
  return (
    <main className="desktop absolute inset-0 flex flex-col items-center justify-center gap-7 overflow-hidden px-6 pt-4 pb-8">
      <div style={{ width: LAUNCHER.w * scale, height: LAUNCHER.h * scale }} className="shrink-0">
        <div
          inert
          aria-hidden
          className="window-frame is-key glass relative origin-top-left overflow-hidden rounded-[12px]"
          style={{ width: LAUNCHER.w, height: LAUNCHER.h, transform: `scale(${scale})` }}
        >
          <Launcher notice={null} onNotice={() => {}} recording={false} onOpenTake={() => {}} />
          <div className="absolute top-[13px] left-[14px] flex gap-1.5">
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span key={c} className="size-3.5 rounded-full" style={{ background: c }} />
            ))}
          </div>
          <div aria-hidden className="window-edge pointer-events-none absolute inset-0 rounded-[inherit]" />
        </div>
      </div>
      <p className="max-w-[300px] text-center text-[13px] leading-relaxed text-white/60">
        Clipt is a tiny screen recorder for Mac. Open this page on your Mac to try it right here.
      </p>
      <DownloadButtons className="flex-wrap justify-center" />
      <Available />
    </main>
  );
}
