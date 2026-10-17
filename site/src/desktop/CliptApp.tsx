/**
 * src/App.tsx for the browser: the same launcher/editor switch, with files
 * dropped through the DOM instead of Tauri's webview.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Editor } from "../../../src/components/Editor";
import { Launcher } from "../../../src/components/Launcher";
import { PrimaryButton, SecondaryButton } from "../../../src/components/ui/controls";
import { Modal } from "../../../src/components/ui/overlays";
import { history } from "../../../src/lib/history";
import { useLatest } from "../../../src/lib/hooks";
import { ipc, message, on, type TakeInfo } from "../../../src/lib/ipc";
import { freshRecipe, type Recipe } from "../../../src/lib/recipe";
import { loadLook } from "../../../src/lib/settings";
import { registerFile } from "../backend/clipt";

type Confirm = { kind: "discard"; then: () => void };

function kindOf(e: DragEvent): "video" | "picture" | null {
  const types = [...e.dataTransfer.items].filter((i) => i.kind === "file").map((i) => i.type);
  if (types.some((t) => t.startsWith("video/"))) return "video";
  if (types.some((t) => t.startsWith("image/"))) return "picture";
  return null;
}

export function CliptApp() {
  const reduce = useReducedMotion();
  const [take, setTake] = useState<TakeInfo | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dragging, setDragging] = useState<"video" | "picture" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const takeRef = useLatest(take);
  const depth = useRef(0);

  const openTake = useCallback(async (info: TakeInfo) => {
    const look = await loadLook();
    const saved = info.recipe;
    const recipe: Recipe = saved
      ? {
          ...saved,
          trim: {
            start: Math.min(saved.trim.start, info.duration),
            end: Math.min(saved.trim.end, info.duration),
          },
        }
      : freshRecipe(look, info.duration);
    history.reset(recipe);
    setNotice(null);
    setTake(info);
    await ipc.setMode("editor");
  }, []);

  const leaveTake = useCallback(async () => {
    await ipc.discardTake();
    history.reset(null);
    setTake(null);
    await ipc.setMode("launcher");
  }, []);

  const whenTakeMayGo = useCallback(
    (then: () => void) => {
      const current = takeRef.current;
      if (current && !current.exported) setConfirm({ kind: "discard", then });
      else then();
    },
    [takeRef],
  );

  const importPath = useCallback(
    (path: string) => {
      whenTakeMayGo(async () => {
        try {
          if (takeRef.current) await ipc.discardTake();
          await openTake(await ipc.importVideo(path));
        } catch (e) {
          setNotice(message(e));
          if (takeRef.current) await leaveTake();
        }
      });
    },
    [whenTakeMayGo, openTake, leaveTake, takeRef],
  );

  // Drag a video in anywhere; a picture, while editing, becomes the background.
  const drag = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      depth.current += 1;
      const kind = kindOf(e);
      setDragging(kind === "video" ? "video" : kind === "picture" && takeRef.current ? "picture" : null);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: () => {
      depth.current -= 1;
      if (depth.current <= 0) setDragging(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(null);
      const list = [...e.dataTransfer.files];
      const video = list.find((f) => f.type.startsWith("video/"));
      const picture = list.find((f) => f.type.startsWith("image/"));
      if (video) {
        const url = URL.createObjectURL(video);
        registerFile(url, video.name);
        importPath(url);
      } else if (picture && takeRef.current) {
        window.dispatchEvent(new CustomEvent("clipt:picture", { detail: URL.createObjectURL(picture) }));
      } else if (list.length) setNotice("Clipt opens .mov and .mp4 files");
    },
  };

  const newRecording = useCallback(() => {
    if (recording) return;
    if (!takeRef.current) {
      window.dispatchEvent(new CustomEvent("clipt:new-recording"));
      return;
    }
    whenTakeMayGo(() => void leaveTake());
  }, [whenTakeMayGo, leaveTake, recording, takeRef]);

  useEffect(
    () =>
      on("menu", (action) => {
        if (action === "new") newRecording();
        else if (action === "stop") void ipc.stopRecording();
        else if (action === "undo") history.undo();
        else if (action === "redo") history.redo();
        else if (action === "export") window.dispatchEvent(new CustomEvent("clipt:export"));
      }),
    [newRecording],
  );

  useEffect(
    () =>
      on("recording", (e) => {
        if (e.state === "started") setRecording(true);
        else {
          setRecording(false);
          if (e.state === "finished") void openTake(e.take);
          else if (e.state === "failed") setNotice(e.message);
        }
      }),
    [openTake],
  );

  useEffect(
    () =>
      on("export-done", (e) => {
        if (takeRef.current?.id === e.id) {
          setTake((t) => (t ? { ...t, exported: true } : t));
        }
      }),
    [takeRef],
  );

  const view = take ? "editor" : "launcher";
  const fade = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, filter: "blur(6px)" },
        animate: { opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } },
        exit: { opacity: 0, filter: "blur(6px)" },
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <div className="h-full w-full" {...drag}>
      <AnimatePresence mode="wait" initial={false}>
        {view === "editor" && take ? (
          <motion.div key={`editor-${take.id}`} className="h-full" {...fade}>
            <Editor take={take} onNew={newRecording} />
          </motion.div>
        ) : (
          <motion.div key="launcher" className="h-full" {...fade}>
            <Launcher
              notice={notice}
              onNotice={setNotice}
              recording={recording}
              onOpenTake={(info) => void openTake(info)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragging ? (
          <motion.div
            key="drop"
            className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent/70 bg-accent/10 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
          >
            <span className="text-[13px] font-medium text-content">
              {dragging === "picture" ? "Drop to use as background" : "Drop to edit"}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {confirm?.kind === "discard" ? (
        <Modal title="Discard this take?" description="It hasn't been exported yet." onClose={() => setConfirm(null)}>
          <SecondaryButton onClick={() => setConfirm(null)}>Keep editing</SecondaryButton>
          <PrimaryButton
            autoFocus
            onClick={() => {
              const then = confirm.then;
              setConfirm(null);
              then();
            }}
          >
            Discard
          </PrimaryButton>
        </Modal>
      ) : null}
    </div>
  );
}
