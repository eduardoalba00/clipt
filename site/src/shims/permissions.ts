/** Stands in for src/lib/permissions.ts, reading the pretend Mac's settings. */
import { useCallback } from "react";
import type { Permission } from "../../../src/lib/ipc";
import { requestPermission } from "../backend/clipt";
import { useDesktop } from "../backend/state";

export function usePermissions() {
  const permissions = useDesktop((s) => s.permissions);
  const request = useCallback(async (what: Permission) => {
    await requestPermission(what);
  }, []);
  const refresh = useCallback(() => {}, []);
  return { permissions, request, refresh };
}
