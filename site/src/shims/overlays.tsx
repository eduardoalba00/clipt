/**
 * Clipt's overlays, unchanged, except that a Modal covers Clipt's window
 * rather than the whole page (on a Mac the page *is* the window).
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export { ColorPicker, Popover, Tooltip } from "../../../src/components/ui/overlays";

const FRAME = "isolate overflow-hidden border border-content/10 shadow-xl";

export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  const host = document.getElementById("clipt-window") ?? document.body;
  return createPortal(
    <div className="absolute inset-0 z-50">
      <div className="modal-backdrop absolute inset-0 bg-black/35" onMouseDown={onClose} />
      <div className="absolute top-[26%] left-1/2 w-[min(340px,calc(100%-32px))] -translate-x-1/2">
        <div role="alertdialog" aria-modal="true" aria-label={title} className={`modal-panel relative ${FRAME} rounded-2xl`}>
          <div
            aria-hidden
            className="popover-backdrop pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-xl"
          />
          <div className="relative z-[1] p-4">
            <h2 className="text-[13px] font-semibold text-content">{title}</h2>
            {description ? <p className="mt-1 text-[12px] leading-snug text-content/55">{description}</p> : null}
            <div className="mt-4 flex justify-end gap-2">{children}</div>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}
