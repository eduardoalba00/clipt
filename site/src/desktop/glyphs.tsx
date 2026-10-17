/** Small SVGs for the pretend Mac: menu bar extras, logos, Clipt's tray icon. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

export function AppleLogo(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function GitHubLogo(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/** src-tauri/src/tray.rs, idle: a screen outline with a record dot. */
export function TrayIdle(props: P) {
  return (
    <svg viewBox="0 0 36 36" fill="currentColor" aria-hidden {...props}>
      <rect x="3" y="6.5" width="30" height="23" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="18" cy="18" r="4.5" />
    </svg>
  );
}

/** src-tauri/src/tray.rs, recording: a disc with a stop square cut out. */
export function TrayRecording(props: P) {
  return (
    <svg viewBox="0 0 36 36" fill="currentColor" aria-hidden {...props}>
      <path
        fillRule="evenodd"
        d="M18 3a15 15 0 1 1 0 30a15 15 0 1 1 0-30ZM14.5 13a1.5 1.5 0 0 0-1.5 1.5v7a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5Z"
      />
    </svg>
  );
}

export function Wifi(props: P) {
  return (
    <svg viewBox="0 0 20 16" fill="currentColor" aria-hidden {...props}>
      <path d="M10 13.6a1.6 1.6 0 1 1 0 .01Z" />
      <path d="M5.9 10.2a6 6 0 0 1 8.2 0l-1.3 1.4a4.1 4.1 0 0 0-5.6 0Z" />
      <path d="M3 7.2a10.2 10.2 0 0 1 14 0l-1.3 1.4a8.3 8.3 0 0 0-11.4 0Z" />
      <path d="M.2 4.3a14.4 14.4 0 0 1 19.6 0l-1.3 1.4a12.5 12.5 0 0 0-17 0Z" />
    </svg>
  );
}

export function Battery(props: P) {
  return (
    <svg viewBox="0 0 27 13" fill="none" aria-hidden {...props}>
      <rect x="0.5" y="0.5" width="22.5" height="12" rx="3.2" stroke="currentColor" strokeOpacity="0.45" />
      <rect x="2" y="2" width="16.5" height="9" rx="1.9" fill="currentColor" />
      <path d="M24.5 4.4v4.2a2.2 2.2 0 0 0 0-4.2Z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

export function Search(props: P) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden {...props}>
      <circle cx="6.8" cy="6.8" r="5" />
      <path d="m10.6 10.6 4 4" />
    </svg>
  );
}

export function ControlCenter(props: P) {
  return (
    <svg viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden {...props}>
      <rect x="1" y="1.5" width="16" height="5.5" rx="2.75" />
      <rect x="1" y="9" width="16" height="5.5" rx="2.75" />
      <circle cx="13.6" cy="4.25" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="11.75" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Chevron({ dir, ...props }: P & { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d={dir === "left" ? "M7.5 2 2.5 8l5 6" : "m2.5 2 5 6-5 6"} />
    </svg>
  );
}

export function FolderGlyph(props: P) {
  return (
    <svg viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M1.5 3.2A1.7 1.7 0 0 1 3.2 1.5h4l1.8 2h7.8a1.7 1.7 0 0 1 1.7 1.7v8.1a1.7 1.7 0 0 1-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7Z" />
    </svg>
  );
}
