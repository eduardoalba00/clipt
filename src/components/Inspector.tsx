import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { isFull } from "../lib/geometry";
import { PRESETS, swatch } from "../lib/presets";
import type { Aspect, Corner, Fps, Recipe } from "../lib/recipe";
import { Kbd, SecondaryButton, Segmented, Slider, Switch } from "./ui/controls";
import { Crop, Pipette } from "./ui/icons";
import { ColorPicker, Popover, Tooltip } from "./ui/overlays";

function Section({ label, children, trailing }: { label: string; children?: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="px-4 py-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-[12px] text-content/60">{label}</h3>
        {trailing}
      </div>
      {children ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}

/** Reveals extra controls when a switch turns on. */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ height: 0, opacity: 0, filter: "blur(3px)" }}
          animate={{ height: "auto", opacity: 1, filter: "blur(0px)" }}
          exit={{ height: 0, opacity: 0, filter: "blur(3px)" }}
          transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.32 }}
          className="overflow-hidden"
        >
          <div className="pt-2">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
];

const CORNERS: { value: Corner; label: string; className: string }[] = [
  { value: "topLeft", label: "Top left", className: "top-1 left-1" },
  { value: "topRight", label: "Top right", className: "top-1 right-1" },
  { value: "bottomLeft", label: "Bottom left", className: "bottom-1 left-1" },
  { value: "bottomRight", label: "Bottom right", className: "bottom-1 right-1" },
];

export function Inspector({
  recipe,
  hasCamera,
  cropping,
  onApply,
  onInput,
  onCommit,
  onToggleCrop,
}: {
  recipe: Recipe;
  hasCamera: boolean;
  cropping: boolean;
  onApply: (r: Recipe) => void;
  onInput: (r: Recipe) => void;
  onCommit: () => void;
  onToggleCrop: () => void;
}) {
  const { style, frame, camera, output } = recipe;
  const [customEl, setCustomEl] = useState<HTMLButtonElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const bg = style.background;
  const custom = bg.kind === "solid" ? bg.color : "#5b6cff";

  const setStyle = (next: Partial<Recipe["style"]>, live = false) =>
    (live ? onInput : onApply)({ ...recipe, style: { ...style, ...next } });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-4">
      <div className={cropping ? "pointer-events-none opacity-35 transition-opacity" : "transition-opacity"}>
        <Section label="Background">
          <div className="grid grid-cols-9 gap-1.5">
            {PRESETS.map((p) => {
              const on = bg.kind === "preset" && bg.id === p.id;
              return (
                <Tooltip key={p.id} label={p.name}>
                  <button
                    type="button"
                    aria-label={p.name}
                    aria-pressed={on}
                    onClick={() => setStyle({ background: { kind: "preset", id: p.id } })}
                    className={`aspect-square rounded-full border border-content/10 ${
                      on ? "ring-2 ring-content/80 ring-offset-2 ring-offset-transparent" : "hover:scale-110"
                    } transition-transform`}
                    style={{ background: swatch(p) }}
                  />
                </Tooltip>
              );
            })}
            <Tooltip label="Custom color">
              <button
                ref={setCustomEl}
                type="button"
                aria-label="Custom color"
                aria-pressed={bg.kind === "solid"}
                aria-expanded={picking}
                onClick={() => {
                  if (bg.kind !== "solid") setStyle({ background: { kind: "solid", color: custom } });
                  setPicking((v) => !v);
                }}
                className={`grid aspect-square place-items-center rounded-full border border-content/10 ${
                  bg.kind === "solid" ? "ring-2 ring-content/80 ring-offset-2 ring-offset-transparent" : "hover:scale-110"
                } transition-transform`}
                style={{
                  background:
                    bg.kind === "solid" ? bg.color : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                }}
              >
                {bg.kind !== "solid" ? <Pipette size={10} strokeWidth={2.25} className="text-white drop-shadow" /> : null}
              </button>
            </Tooltip>
          </div>
          {picking ? (
            <Popover anchor={customEl} side="left" align="start" onDismiss={() => setPicking(false)}>
              <ColorPicker
                value={custom}
                onInput={(color) => setStyle({ background: { kind: "solid", color } }, true)}
                onCommit={onCommit}
              />
            </Popover>
          ) : null}
        </Section>

        <Section label="Padding">
          <Slider
            label="Padding"
            value={style.padding}
            onInput={(padding) => setStyle({ padding }, true)}
            onCommit={onCommit}
          />
        </Section>

        <Section label="Corners">
          <Slider
            label="Corner radius"
            value={style.radius}
            onInput={(radius) => setStyle({ radius }, true)}
            onCommit={onCommit}
          />
        </Section>

        <Section
          label="Shadow"
          trailing={<Switch label="Shadow" checked={style.shadow} onChange={(shadow) => setStyle({ shadow })} />}
        />

        <Section
          label="Browser frame"
          trailing={
            <Switch
              label="Browser frame"
              checked={frame.enabled}
              onChange={(enabled) => onApply({ ...recipe, frame: { ...frame, enabled } })}
            />
          }
        >
          <Reveal open={frame.enabled}>
            <div className="flex flex-col gap-2">
              <input
                value={url ?? frame.url}
                spellCheck={false}
                aria-label="Address"
                placeholder="myapp.com"
                onFocus={() => setUrl(frame.url)}
                onChange={(e) => {
                  setUrl(e.target.value);
                  onInput({ ...recipe, frame: { ...frame, url: e.target.value } });
                }}
                onBlur={() => {
                  setUrl(null);
                  onCommit();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                }}
                className="h-7 w-full rounded-full border border-content/10 bg-selection-subtle px-3 text-center text-[12px] text-content outline-none placeholder:text-content/30 focus:border-accent/60"
              />
              <Segmented
                label="Frame color"
                value={frame.dark ? "dark" : "light"}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(v) => onApply({ ...recipe, frame: { ...frame, dark: v === "dark" } })}
              />
            </div>
          </Reveal>
        </Section>

        {hasCamera ? (
          <Section
            label="Camera"
            trailing={
              <Switch
                label="Camera"
                checked={camera.visible}
                onChange={(visible) => onApply({ ...recipe, camera: { ...camera, visible } })}
              />
            }
          >
            <Reveal open={camera.visible}>
              <div className="flex items-center gap-3">
                <div
                  role="radiogroup"
                  aria-label="Camera corner"
                  className="relative h-9 w-14 shrink-0 rounded-md border border-content/12 bg-selection-subtle"
                >
                  {CORNERS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={camera.corner === c.value}
                      aria-label={c.label}
                      onClick={() => onApply({ ...recipe, camera: { ...camera, corner: c.value } })}
                      className={`absolute size-3 rounded-full ${c.className} ${
                        camera.corner === c.value ? "bg-content" : "bg-content/20 hover:bg-content/45"
                      }`}
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <Slider
                    label="Camera size"
                    value={camera.size}
                    onInput={(size) => onInput({ ...recipe, camera: { ...camera, size } })}
                    onCommit={onCommit}
                  />
                </div>
              </div>
            </Reveal>
          </Section>
        ) : null}

        <Section label="Aspect">
          <Segmented
            label="Aspect ratio"
            value={output.aspect}
            options={ASPECTS}
            onChange={(aspect) => onApply({ ...recipe, output: { ...output, aspect } })}
          />
        </Section>

        <Section label="Frame rate">
          <Segmented<Fps>
            label="Frame rate"
            value={output.fps}
            options={[
              { value: 30, label: "30 fps" },
              { value: 60, label: "60 fps" },
            ]}
            onChange={(fps) => onApply({ ...recipe, output: { ...output, fps } })}
          />
        </Section>
      </div>

      <Section
        label="Crop"
        trailing={
          <div className="flex items-center gap-1.5">
            {!isFull(recipe.crop) && !cropping ? (
              <button
                type="button"
                onClick={() => onApply({ ...recipe, crop: null })}
                className="rounded-md px-1.5 py-0.5 text-[11.5px] text-content/50 hover:bg-selection hover:text-content"
              >
                Reset
              </button>
            ) : null}
            <Tooltip label={cropping ? "Done" : "Crop"} keys={["C"]}>
              <SecondaryButton onClick={onToggleCrop} aria-pressed={cropping} className={cropping ? "border-accent/60 text-content" : ""}>
                <Crop size={13} />
                {cropping ? "Done" : "Crop"}
              </SecondaryButton>
            </Tooltip>
          </div>
        }
      >
        {cropping ? (
          <p className="text-[11.5px] leading-snug text-content/45">
            Drag the frame or its handles. Press <Kbd>C</Kbd> or <Kbd>Esc</Kbd> when done.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
