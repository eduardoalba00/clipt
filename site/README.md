# useclipt.dev

Clipt's website: a pretend Mac in the browser, running Clipt. Visitors can
record the screen, a window or an area, edit the take and export it, the
same way the app works.

## How it works

The site renders Clipt's **real** components from `../src`: the launcher,
onboarding, editor, inspector and timeline. `vite.config.ts` swaps the
modules that talk to Tauri for in-browser stand-ins in `src/shims`:

| App module | Stand-in | What it does instead |
| --- | --- | --- |
| `lib/ipc.ts` | `shims/ipc.ts` | Answers every command from `src/backend` |
| `lib/settings.ts` | `shims/settings.ts` | Remembers for as long as the page is open |
| `lib/permissions.ts` | `shims/permissions.ts` | Shows macOS-style permission prompts |
| `lib/pictures.ts` | `shims/pictures.ts` | Uses the browser's file picker |
| `components/ui/overlays.tsx` | `shims/overlays.tsx` | Keeps dialogs inside Clipt's window |
| `@tauri-apps/api/core` | `shims/tauri-core.ts` | `convertFileSrc` passes URLs through |

`src/backend` plays the Rust side. `scene.ts` is a port of
`src-tauri/src/scene.rs` and `render.ts` draws a scene with canvas the way
`render.rs` composes it. A take is a redraw of the pretend screen, pointer
included (`clip.ts`), or a real video dropped on the window. `src/desktop` is
the Mac around it: the menu bar, windows, Finder, the picker and the
recording overlays. Narrow or short screens get `Mobile.tsx` instead.

When the app changes:

- **UI changes** show up here on their own.
- **`Scene` or `render.rs` changes** need the same change in `scene.ts` and
  `render.ts`.
- **A new IPC command or event** needs an answer in `shims/ipc.ts`.

## Develop

The typecheck reads the app's own types, so install both packages:

```sh
npm install              # in the repository root
cd site
npm install
npm run dev
npm run typecheck
```

## Settings

`src/config.ts`:

- `DOWNLOAD_URL`: the notarized DMG. While it's `null`, the button reads
  "Coming soon".
- `GITHUB_URL`: the repository.
- `DEMO_VIDEO`: a real screen recording in `public/` to open after a pretend
  recording, instead of the redrawn screen.

The wallpaper is `wallpaper.svg`, rendered to `public/wallpaper*.webp`.

## Deploy (Railway)

The site builds from the repository root, because it needs `../src`:

1. Create a service from this repository and leave **Root Directory** empty.
2. Set **Config File Path** to `/site/railway.json`. It builds
   `site/Dockerfile` and serves the result with `server.js` (no dependencies)
   on `$PORT`.
3. Add the custom domain `useclipt.dev`.

To build the image locally:

```sh
docker build -f site/Dockerfile -t clipt-site .
docker run -p 3000:3000 clipt-site
```
