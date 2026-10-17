# Clipt

A tiny macOS screen recorder for clean demo videos to post on X. Record your
screen, a window or a dragged area, then give it a background, padding,
rounded corners, a shadow and an optional browser frame, and export an MP4
that X takes as is.

![Clipt's compositor turning a raw recording into a framed demo](docs/demo.gif)

<sub>The GIF above is rendered by Clipt's own compositor from a generated
recording (`cargo test --release --test export demo -- --ignored`), stepping
through the styles.</sub>

## What it does

- **Record** the whole screen or one window (the system picker), or drag to
  select an area. Optional microphone and camera. Stop with <kbd>⌘⇧2</kbd> or
  the menu bar icon.
- **Trim** on a filmstrip. Playback respects the trim.
- **Crop** with a rectangle you drag and resize on the preview.
- **Style**: eight background presets or any colour, padding, corners, shadow,
  and Auto, 16:9, 1:1 or 4:5 output.
- **Browser frame**: minimal chrome with traffic lights and an editable address.
- **Camera bubble**: a round camera overlay in any corner, any size.
- **Export**: H.264 + AAC, at most 1080p, 30 or 60 fps. Clipt warns (without
  stopping you) when the clip is longer than X's 2:20. The file is revealed in
  Finder and copied to the clipboard, ready to paste into a post.
- **Import**: drop any .mov or .mp4, including ⌘⇧5 recordings.

Recordings are *takes*: raw files kept in Clipt's working folder
(`~/Library/Application Support/com.clipt.desktop/takes`). Your edits are a
recipe on top, with full undo. An MP4 only exists once you export, into
`~/Movies/Clipt`, and exports never overwrite a file. Clipt asks before
throwing away a take that was never exported; a take left over when you quit
is offered back on the next launch.

## Shortcuts

| Key | Action |
| --- | --- |
| <kbd>⌘N</kbd> | New recording |
| <kbd>⌘⇧2</kbd> | Stop recording |
| <kbd>Space</kbd> | Play / pause |
| <kbd>I</kbd> / <kbd>O</kbd> | Set trim in / out at the playhead |
| <kbd>C</kbd> | Crop mode (<kbd>Esc</kbd> or <kbd>C</kbd> to finish) |
| <kbd>⌘E</kbd> | Export |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo (trim, crop, style, frame text) |

## Requirements

macOS 14 (Sonoma) or later. Built and tested on Apple Silicon.

## Build

```sh
npm install
npm run tauri build          # → src-tauri/target/release/bundle/macos/Clipt.app
```

Run the bundled `Clipt.app`, not the bare binary from a terminal: macOS
grants Screen Recording to whichever app launched the process.

### Keep permissions across rebuilds

Unsigned (ad-hoc) builds get a new signature every time, and macOS then
forgets the Screen Recording, Microphone and Camera permissions. Give the app
a stable identity once:

```sh
scripts/setup-signing.sh     # uses your Apple Development cert, or makes "Clipt Dev"
APPLE_SIGNING_IDENTITY="Clipt Dev" npm run tauri build
```

## Checks

```sh
npm run typecheck && npm run lint
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

`cargo test` includes two end-to-end checks:

- **export**: generates a clip in code (video and a tone), exports it with
  known settings and reads the file back with AVFoundation: duration,
  resolution, frame rate and codecs (`avc1`, `aac `).
- **parity**: plays a generated take through the preview's own `AVPlayerItem`
  on the main thread and compares the frame with the export path: the
  unencoded frames must be identical, and the encoded MP4 must be within
  H.264's loss of the preview.

## How it works

Tauri 2 with a Rust core and a React 19 + Tailwind v4 page. The page only
draws controls and keeps the undo history; all media work is in Rust through
`objc2` bindings to Apple's frameworks. There is no ffmpeg.

One source of truth: the recipe becomes a Rust `Scene` (canvas size, video
rect, crop, radius, padding, frame, camera bubble, fill). A custom
`AVVideoCompositing` compositor draws a `Scene` with Core Image. The preview
is an `AVPlayer` with that compositor, shown in a native layer under the
transparent webview; export reads the same composition through an
`AVAssetReader` into an `AVAssetWriter` (hardware H.264). Preview and export
run the same code, so they can't drift.

```
src-tauri/src/
  scene.rs    recipe → Scene layout (pure, unit-tested), presets
  render.rs   Core Image compositing; the custom compositor
  media.rs    a take's files as one composition; filmstrip thumbnails
  preview.rs  the AVPlayer layer under the webview
  export.rs   reader → writer, X-friendly settings, naming
  record.rs   ScreenCaptureKit, area selection, mic and camera
  take.rs     the working folder
  macos.rs    window glass, traffic lights, Finder and clipboard
  tray.rs     the menu bar icon
src/
  App.tsx, components/   launcher, editor, preview, inspector, timeline
  lib/                   recipe types, undo history, IPC, settings
```

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
