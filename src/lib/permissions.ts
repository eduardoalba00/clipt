import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { ipc, type Permission, type Permissions } from "./ipc";

/** Clipt's permissions, re-read whenever the window comes back to the front
 * (the user may have just changed them in System Settings). */
export function usePermissions() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);

  const refresh = useCallback(() => {
    void ipc.permissions().then(setPermissions);
  }, []);

  useEffect(() => {
    refresh();
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWindow()
      .onFocusChanged(({ payload }) => {
        if (payload) refresh();
      })
      .then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, [refresh]);

  const request = useCallback(async (what: Permission) => {
    setPermissions(await ipc.requestPermission(what));
  }, []);

  return { permissions, request, refresh };
}
