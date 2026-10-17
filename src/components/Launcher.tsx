import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ipc, message, type Leftover, type RecordKind, type TakeInfo } from "../lib/ipc";
import { loadRecordOptions, saveRecordOptions, type RecordOptions } from "../lib/settings";
import { Kbd, PrimaryButton, SecondaryButton, Shimmer, Switch } from "./ui/controls";
import { Back, Camera, Close, Folder, Forward, Mic, Resume, Screen, Selection, WindowIcon } from "./ui/icons";
import { Modal } from "./ui/overlays";

const KINDS: { kind: RecordKind; label: string; icon: ReactNode }[] = [
  { kind: "screen", label: "Record screen", icon: <Screen size={16} /> },
  { kind: "selection", label: "Record selection", icon: <Selection size={16} /> },
  { kind: "window", label: "Record window", icon: <WindowIcon size={16} /> },
];

function Row({
  icon,
  label,
  detail,
  onClick,
  trailing,
  autoFocus,
}: {
  icon: ReactNode;
  label: string;
  detail?: ReactNode;
  onClick: () => void;
  trailing?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        autoFocus={autoFocus}
        onClick={onClick}
        className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] text-content/85 hover:bg-selection hover:text-content focus-visible:bg-selection"
      >
        <span className="grid size-5 place-items-center text-content/60 group-hover:text-content/85">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {detail ? <span className="text-[11.5px] text-content/40 tabular">{detail}</span> : null}
        {trailing}
      </button>
    </div>
  );
}

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function Launcher({
  notice,
  onNotice,
  recording,
  onOpenTake,
}: {
  notice: string | null;
  onNotice: (n: string | null) => void;
  recording: boolean;
  onOpenTake: (info: TakeInfo) => void;
}) {
  const reduce = useReducedMotion();
  const [kind, setKind] = useState<RecordKind | null>(null);
  const [options, setOptions] = useState<RecordOptions>({ mic: false, camera: false });
  const [leftover, setLeftover] = useState<Leftover | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void loadRecordOptions().then(setOptions);
    void ipc.leftoverTake().then(setLeftover).catch(() => setLeftover(null));
  }, []);

  // ⌘N from the menu while the launcher is up: straight to recording the screen.
  useEffect(() => {
    const open = () => setKind((k) => k ?? "screen");
    window.addEventListener("clipt:new-recording", open);
    return () => window.removeEventListener("clipt:new-recording", open);
  }, []);

  const setOption = (next: RecordOptions) => {
    setOptions(next);
    void saveRecordOptions(next);
  };

  const start = useCallback(async () => {
    if (!kind || starting) return;
    setStarting(true);
    onNotice(null);
    try {
      await ipc.startRecording(kind, options.mic, options.camera);
    } catch (e) {
      onNotice(message(e));
    } finally {
      setStarting(false);
    }
  }, [kind, options, starting, onNotice]);

  useEffect(() => {
    if (!kind) return;
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("[role=alertdialog]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setKind(null);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void start();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [kind, start]);

  const resume = async () => {
    if (!leftover) return;
    try {
      onOpenTake(await ipc.resumeTake(leftover.id));
    } catch (e) {
      onNotice(message(e));
      setLeftover(null);
    }
  };

  const step = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, x: kind ? 14 : -14, filter: "blur(4px)" },
        animate: { opacity: 1, x: 0, filter: "blur(0px)" },
        exit: { opacity: 0, x: kind ? -14 : 14, filter: "blur(4px)" },
        transition: { type: "spring", bounce: 0.1, duration: 0.36 } as const,
      };

  const title = KINDS.find((k) => k.kind === kind)?.label;

  return (
    <div className="flex h-full flex-col">
      <div data-tauri-drag-region className="h-10 shrink-0" />

      <div className="relative min-h-0 flex-1 px-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {recording ? (
            <motion.div key="recording" {...step} className="flex h-full flex-col items-center justify-center gap-3 pb-10">
              <span className="record-pulse size-3 rounded-full bg-record" />
              <Shimmer className="text-[13px]">Recording</Shimmer>
              <SecondaryButton onClick={() => void ipc.stopRecording()} className="mt-1">
                <span className="size-2 rounded-[2px] bg-record" />
                Stop recording
              </SecondaryButton>
              <p className="text-[11.5px] text-content/45">
                Or press <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>2</Kbd>
              </p>
            </motion.div>
          ) : kind ? (
            <motion.div key="options" {...step} className="flex h-full flex-col">
              <div className="mb-3 flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setKind(null)}
                  className="grid size-7 place-items-center rounded-md text-content/55 hover:bg-selection hover:text-content"
                >
                  <Back size={15} />
                </button>
                <h1 className="text-[13px] font-medium">{title}</h1>
              </div>

              <div className="flex flex-col">
                <label className="flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] text-content/85">
                  <Mic size={16} className="text-content/60" />
                  <span className="flex-1">Microphone</span>
                  <Switch checked={options.mic} label="Microphone" onChange={(mic) => setOption({ ...options, mic })} />
                </label>
                <label className="flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] text-content/85">
                  <Camera size={16} className="text-content/60" />
                  <span className="flex-1">Camera</span>
                  <Switch
                    checked={options.camera}
                    label="Camera"
                    onChange={(camera) => setOption({ ...options, camera })}
                  />
                </label>
              </div>

              <div className="mt-auto pb-4">
                <PrimaryButton className="h-9 w-full text-[13px]" onClick={() => void start()} disabled={starting}>
                  <span className="size-2 rounded-full bg-record" />
                  {kind === "selection" ? "Select area" : kind === "window" ? "Choose window" : "Record"}
                </PrimaryButton>
                <p className="mt-2.5 text-center text-[11.5px] text-content/45">
                  Stop with <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>2</Kbd> or the menu bar icon
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="home" {...step} className="flex h-full flex-col">
              <div className="mb-4 flex items-center gap-2.5 px-3">
                <img src="/icon.svg" alt="" className="size-7" draggable={false} />
                <h1 className="text-[15px] font-semibold tracking-tight">Clipt</h1>
              </div>
              {KINDS.map((k, i) => (
                <Row
                  key={k.kind}
                  autoFocus={i === 0}
                  icon={k.icon}
                  label={k.label}
                  onClick={() => setKind(k.kind)}
                  trailing={<Forward size={14} className="text-content/30" />}
                />
              ))}
              <div className="mx-3 my-2 h-px bg-stroke" />
              <Row icon={<Folder size={16} />} label="Open recordings" onClick={() => void ipc.openRecordings()} />
              {leftover ? (
                <div className="group relative">
                  <Row
                    icon={<Resume size={16} />}
                    label="Continue last take"
                    detail={<span className="group-hover:opacity-0">{ago(leftover.created)}</span>}
                    onClick={() => void resume()}
                  />
                  <button
                    type="button"
                    aria-label="Discard last take"
                    title="Discard"
                    onClick={() => setConfirmDiscard(true)}
                    className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-content/45 opacity-0 group-hover:opacity-100 hover:bg-selection-hover hover:text-content focus-visible:opacity-100"
                  >
                    <Close size={13} />
                  </button>
                </div>
              ) : null}

              <div className="mt-auto pb-4 text-center">
                <AnimatePresence initial={false}>
                  {notice ? (
                    <motion.p
                      key={notice}
                      initial={{ opacity: 0, filter: "blur(3px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0 }}
                      className="mb-2 px-3 text-[11.5px] text-warning"
                    >
                      {notice}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
                <p className="text-[11.5px] text-content/45">
                  Drop a video, or press <Kbd>⌘</Kbd> <Kbd>N</Kbd> to record
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {confirmDiscard && leftover ? (
        <Modal
          title="Discard this take?"
          description="It hasn't been exported yet."
          onClose={() => setConfirmDiscard(false)}
        >
          <SecondaryButton onClick={() => setConfirmDiscard(false)}>Keep</SecondaryButton>
          <PrimaryButton
            autoFocus
            onClick={() => {
              setConfirmDiscard(false);
              void ipc.discardLeftover(leftover.id).then(() => setLeftover(null));
            }}
          >
            Discard
          </PrimaryButton>
        </Modal>
      ) : null}
    </div>
  );
}
