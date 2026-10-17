import { useState, type ReactNode } from "react";
import type { Access, Permission } from "../lib/ipc";
import { ipc } from "../lib/ipc";
import { usePermissions } from "../lib/permissions";
import { PrimaryButton, SecondaryButton } from "./ui/controls";
import { Camera, Check, Mic, Screen } from "./ui/icons";

const ROWS: { what: Permission; label: string; detail: string; icon: ReactNode }[] = [
  {
    what: "screen",
    label: "Screen recording",
    detail: "To record an area you select",
    icon: <Screen size={16} />,
  },
  { what: "mic", label: "Microphone", detail: "Optional, for a voiceover", icon: <Mic size={16} /> },
  { what: "camera", label: "Camera", detail: "Optional, for the camera bubble", icon: <Camera size={16} /> },
];

/** First run: ask for everything recording needs, up front. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { permissions, request } = usePermissions();
  // macOS says nothing about Screen Recording until Clipt is reopened.
  const [askedScreen, setAskedScreen] = useState(false);

  const action = (what: Permission, access: Access): ReactNode => {
    if (access === "granted") {
      return (
        <span className="flex items-center gap-1 text-[12px] text-content/55">
          <Check size={14} className="text-emerald-400" />
          Allowed
        </span>
      );
    }
    if (access === "denied" || (what === "screen" && askedScreen)) {
      return <SecondaryButton onClick={() => void ipc.openPrivacy(what)}>Open Settings</SecondaryButton>;
    }
    return (
      <SecondaryButton
        onClick={() => {
          if (what === "screen") setAskedScreen(true);
          void request(what);
        }}
      >
        Allow
      </SecondaryButton>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 px-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Set up Clipt</h1>
        <p className="mt-1 text-[12px] leading-snug text-content/50">
          Allow what you'll use. You can change these later in System Settings.
        </p>
      </div>
      <div className="mt-3 flex flex-col">
        {ROWS.map((row) => (
          <div key={row.what} className="flex min-h-12 items-center gap-3 rounded-lg px-3">
            <span className="grid size-5 place-items-center text-content/60">{row.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-content/85">{row.label}</div>
              <div className="truncate text-[11.5px] text-content/45">{row.detail}</div>
            </div>
            {permissions ? action(row.what, permissions[row.what]) : null}
          </div>
        ))}
      </div>
      {askedScreen && permissions?.screen !== "granted" ? (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-selection-subtle px-3 py-2 text-[11.5px] leading-snug text-content/60">
          <span className="flex-1">Once Clipt is on in System Settings, reopen it to finish.</span>
          <SecondaryButton onClick={() => void ipc.relaunch()}>Reopen</SecondaryButton>
        </div>
      ) : null}
      <div className="mt-auto pb-4">
        <PrimaryButton className="h-9 w-full text-[13px]" onClick={onDone}>
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
}
