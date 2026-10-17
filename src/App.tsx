import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Editor } from "./components/Editor";
import { Launcher } from "./components/Launcher";
import { PrimaryButton, SecondaryButton } from "./components/ui/controls";
import { Modal } from "./components/ui/overlays";
import { history } from "./lib/history";
import { useLatest } from "./lib/hooks";
import { ipc, message, on, type TakeInfo } from "./lib/ipc";
import { freshRecipe, type Recipe } from "./lib/recipe";
import { loadLook } from "./lib/settings";

const VIDEO = /\.(mov|mp4|m4v)$/i;

type Confirm = { kind: "discard"; then: () => void };

/** Keeps the page and the native window in the system's light or dark. */
function useAppearance() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.classList.toggle("theme-light", !media.matches);
      void ipc.setAppearance(media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
}

export function App() {
  useAppearance();
  const reduce = useReducedMotion();
  const [take, setTake] = useState<TakeInfo | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const takeRef = useLatest(take);

  // The window starts hidden and shows once the page has mounted. (A hidden
  // WKWebView never fires animation frames, so this can't wait for one.)
  useEffect(() => {
    void ipc.ready();
  }, []);

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

  /** Runs `then` once the open take may go, asking first if it was never exported. */
  const whenTakeMayGo = useCallback((then: () => void) => {
    const current = takeRef.current;
    if (current && !current.exported) setConfirm({ kind: "discard", then });
    else then();
  }, [takeRef]);

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

  // Drag a .mov or .mp4 in anywhere.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let gone = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") setDragging(p.paths.some((x) => VIDEO.test(x)));
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          const video = p.paths.find((x) => VIDEO.test(x));
          if (video) importPath(video);
          else if (p.paths.length) setNotice("Clipt opens .mov and .mp4 files");
        }
      })
      .then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [importPath]);

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
    <div className="h-full w-full">
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
            className="pointer-events-none fixed inset-2 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent/70 bg-accent/10 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
          >
            <span className="text-[13px] font-medium text-content">Drop to edit</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {confirm?.kind === "discard" ? (
        <Modal
          title="Discard this take?"
          description="It hasn't been exported yet."
          onClose={() => setConfirm(null)}
        >
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
