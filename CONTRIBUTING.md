# Contributing to Clipt

Thanks for wanting to help. Clipt is a small app on purpose: fast to start,
frictionless to use, and easy to understand. Contributions that keep it that
way are the most welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected, what
  happened, and your macOS version and Mac model.
- **Features:** open an issue to discuss it first. Clipt deliberately does a
  few things well, so not every good idea will fit, and it's better to find
  that out before you write code.
- **Small fixes** (typos, copy, obvious bugs) can go straight to a pull
  request.

## Setting up

You need macOS 14 or later, [Rust](https://rustup.rs), Node.js 20 or newer,
and Xcode's command line tools.

```sh
git clone https://github.com/eduardoalba00/clipt.git
cd clipt
npm install
npm run tauri dev
```

Recording needs Screen Recording permission, which macOS ties to the app's
code signature. For a permission that survives rebuilds, run
`scripts/setup-signing.sh` once and build with
`APPLE_SIGNING_IDENTITY="Clipt Dev" npm run tauri build`.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. One pull request, one idea.
3. Match the code around you: its naming, comment density and idioms.
4. Run the checks:

   ```sh
   npm run check
   ```

   That's the TypeScript typecheck, ESLint, `cargo clippy` with warnings as
   errors, and `cargo test`, which includes the export and preview/export
   parity tests. Run `cargo fmt` in `src-tauri` too.
5. Open a pull request describing what changed and why. Include a screenshot
   or short recording for anything visible.

## Guidelines

- **All media work happens in Rust**, through Apple's frameworks. The React
  side draws controls and sends settings.
- **One source of truth.** Anything that changes how a frame looks belongs in
  the `Scene` (`src-tauri/src/scene.rs`) and is drawn by `render.rs`, so the
  preview and the export can't drift.
- **Every edit is undoable** and shows in the preview right away.
- **Copy is short, plain and in sentence case.** Buttons are verbs.
- **Ask before adding a dependency.** Clipt stays small by keeping its
  dependency list short.
- **Respect reduced motion.** Animations explain changes; they never block.
- **The website renders the app.** `site/` (useclipt.dev) imports Clipt's
  real components and swaps the Tauri bridge for an in-browser stand-in. If
  you change the `Scene` or an IPC call, keep `site/src/backend` in step; see
  [site/README.md](site/README.md).

## Code of Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
