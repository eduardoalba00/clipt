/** Popover, modal, tooltip and colour picker, after MonoCode's (MIT). */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { clamp } from "../../lib/geometry";
import { Kbd } from "./controls";

const FRAME = "isolate overflow-hidden border border-content/10 shadow-xl";

function Glass() {
  return (
    <div
      aria-hidden
      className="popover-backdrop pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-xl"
    />
  );
}

/** A floating panel anchored below or beside an element. */
export function Popover({
  anchor,
  side = "bottom",
  align = "start",
  onDismiss,
  children,
  className = "",
  width,
}: {
  anchor: HTMLElement | null;
  side?: "bottom" | "left";
  align?: "start" | "end";
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
  width?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const el = frame.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = el;
    const gap = 6;
    const pad = 8;
    let left: number;
    let top: number;
    if (side === "left") {
      left = a.left - gap - w;
      top = align === "start" ? a.top : a.bottom - h;
    } else {
      left = align === "start" ? a.left : a.right - w;
      top = a.bottom + gap;
      if (top + h > window.innerHeight - pad) top = a.top - gap - h;
    }
    setPos({
      left: clamp(left, pad, window.innerWidth - w - pad),
      top: clamp(top, pad, window.innerHeight - h - pad),
    });
  }, [anchor, side, align]);

  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(place);
    if (frame.current) observer.observe(frame.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (frame.current?.contains(t) || anchor?.contains(t)) return;
      onDismiss();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [anchor, onDismiss]);

  return createPortal(
    <div
      ref={frame}
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width,
        visibility: pos ? "visible" : "hidden",
        zIndex: 40,
      }}
      className={`${FRAME} rounded-xl`}
    >
      <Glass />
      <div
        data-popover-side={side}
        className={`${pos ? "popover-open " : ""}relative z-[1] ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A small confirm dialog. Escape and the backdrop cancel. */
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

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="modal-backdrop absolute inset-0 bg-black/35" onMouseDown={onClose} />
      <div className="absolute top-[26%] left-1/2 w-[min(340px,calc(100vw-32px))] -translate-x-1/2">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          className={`modal-panel relative ${FRAME} rounded-2xl`}
        >
          <Glass />
          <div className="relative z-[1] p-4">
            <h2 className="text-[13px] font-semibold text-content">{title}</h2>
            {description ? (
              <p className="mt-1 text-[12px] leading-snug text-content/55">{description}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">{children}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A label, with its shortcut, after a short hover. */
export function Tooltip({
  label,
  keys,
  children,
  side = "bottom",
}: {
  label: string;
  keys?: string[];
  children: ReactElement;
  side?: "bottom" | "top";
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (el: HTMLElement) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnchor(el.getBoundingClientRect()), 450);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setAnchor(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span
      className="contents"
      onPointerEnter={(e) => show(e.target as HTMLElement)}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {anchor
        ? createPortal(
            <div
              role="tooltip"
              data-popover-side={side}
              className="popover-open pointer-events-none fixed z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-content/10 bg-background-base/95 px-2 py-1 text-[11.5px] whitespace-nowrap text-content/85 shadow-lg"
              style={{
                left: clamp(anchor.left + anchor.width / 2, 60, window.innerWidth - 60),
                top: side === "bottom" ? anchor.bottom + 6 : anchor.top - 30,
              }}
            >
              {label}
              {keys?.map((k) => <Kbd key={k}>{k}</Kbd>)}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#808080";
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const sat = s / 100;
  const val = v / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const byte = (ch: number) =>
    Math.round(clamp((ch + m) * 255, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Saturation/brightness square, hue strip and hex field. */
export function ColorPicker({
  value,
  onInput,
  onCommit,
}: {
  value: string;
  onInput: (hex: string) => void;
  onCommit: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const sv = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onInput(hex);
  };

  const drag = (
    e: ReactPointerEvent<HTMLDivElement>,
    el: HTMLDivElement | null,
    update: (x: number, y: number) => void,
  ) => {
    if (!el) return;
    e.preventDefault();
    const move = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      update(clamp((cx - r.left) / r.width, 0, 1), clamp((cy - r.top) / r.height, 0, 1));
    };
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pure = hsvToHex({ h: hsv.h, s: 100, v: 100 });
  const current = hsvToHex(hsv);

  return (
    <div className="w-52 p-2.5">
      <div
        ref={sv}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv.s)}
        className="relative h-28 w-full cursor-crosshair touch-none rounded-md"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
        onPointerDown={(e) => drag(e, sv.current, (x, y) => apply({ ...hsv, s: x * 100, v: (1 - y) * 100 }))}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: current }}
        />
      </div>
      <div
        ref={hue}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        className="relative mt-2.5 h-3 w-full touch-none rounded-full"
        style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
        onPointerDown={(e) => drag(e, hue.current, (x) => apply({ ...hsv, h: Math.min(x * 360, 359.9) }))}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }}
        />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="size-6 shrink-0 rounded-md border border-content/10" style={{ background: current }} />
        <input
          value={text}
          spellCheck={false}
          aria-label="Hex color"
          onChange={(e) => {
            setText(e.target.value);
            const raw = e.target.value.trim();
            const hex = raw.startsWith("#") ? raw : `#${raw}`;
            if (/^#[0-9a-f]{6}$/i.test(hex)) {
              setHsv(hexToHsv(hex));
              onInput(hex.toLowerCase());
            }
          }}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="min-w-0 flex-1 rounded-md border border-content/10 bg-selection-subtle px-2 py-1 font-mono text-[11.5px] text-content outline-none focus:border-accent/60"
        />
      </div>
    </div>
  );
}
