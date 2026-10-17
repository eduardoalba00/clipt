/** Small controls: button, switch, segmented control, slider, shimmer, keys. */
import { motion, useReducedMotion } from "motion/react";
import {
  memo,
  useId,
  useRef,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { clamp } from "../../lib/geometry";

export const SPRING = { type: "spring", bounce: 0.12, duration: 0.42 } as const;

/** MonoCode's secondary button. */
export function SecondaryButton({
  danger = false,
  type = "button",
  className = "",
  children,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "className"> & {
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] ${
        danger
          ? "text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
          : "text-content/75 hover:bg-content/10 hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}

/** The one filled button per screen. */
export function PrimaryButton({
  type = "button",
  className = "",
  children,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "className"> & { className?: string }) {
  return (
    <button
      {...props}
      type={type}
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-content px-3 py-1 text-[12px] font-medium text-background-base hover:bg-content/90 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex min-w-4 items-center justify-center rounded-[4px] border border-content/10 px-1 font-sans text-[10.5px] leading-[15px] text-content/55 ${className}`}
    >
      {children}
    </kbd>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ${
        checked ? "bg-accent" : "bg-selection-emphasis"
      }`}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? 12 : 0 }}
        transition={reduce ? { duration: 0 } : SPRING}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-selection-subtle p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative h-6 flex-1 rounded-[5px] px-1.5 text-[11.5px] tabular ${
              on ? "text-content" : "text-content/55 hover:text-content/85"
            }`}
          >
            {on ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[5px] bg-selection-emphasis shadow-sm"
                transition={reduce ? { duration: 0 } : SPRING}
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A drag-friendly slider. `onInput` fires while dragging (live preview),
 * `onCommit` once when the drag or key press is done (one undo step).
 */
export function Slider({
  value,
  onInput,
  onCommit,
  label,
  format = (v) => `${Math.round(v * 100)}`,
}: {
  value: number;
  onInput: (v: number) => void;
  onCommit: () => void;
  label: string;
  format?: (v: number) => string;
}) {
  const track = useRef<HTMLDivElement>(null);

  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return value;
    return clamp((clientX - r.left) / r.width, 0, 1);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    onInput(at(e.clientX));
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? value + step
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? value - step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? 1
              : null;
    if (next == null) return;
    e.preventDefault();
    onInput(clamp(next, 0, 1));
  };

  return (
    <div className="flex items-center gap-2.5">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={down}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onInput(at(e.clientX));
        }}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyDown={key}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") onCommit();
        }}
        className="group relative h-5 flex-1 touch-none rounded-full outline-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-selection-strong" />
        <div
          className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-content/45"
          style={{ width: `${value * 100}%` }}
        />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-accent group-focus-visible:ring-2"
          style={{ left: `${value * 100}%` }}
        />
      </div>
      <span className="w-7 text-right text-[11px] text-content/50 tabular">{format(value)}</span>
    </div>
  );
}

function ShimmerComponent({
  children,
  className = "",
  duration = 2,
  spread = 2,
}: {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}) {
  return (
    <span
      className={`shimmer-text relative inline-block ${className}`}
      style={
        {
          "--spread": `${children.length * spread}px`,
          "--shimmer-duration": `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}

export const Shimmer = memo(ShimmerComponent);
