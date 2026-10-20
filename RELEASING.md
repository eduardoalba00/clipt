# Releasing Clipt

This is for maintainers. Releases are built, signed, notarized and drafted
by [the Release workflow](.github/workflows/release.yml); a person publishes
them.

## Cutting a release

1. Pick the version, say `0.2.0`, and set it in `package.json`,
   `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Run `cargo check`
   in `src-tauri` so `Cargo.lock` follows. The workflow refuses to build if
   the three disagree, or if the tag doesn't match them.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.2.0] - YYYY-MM-DD`
   and start a fresh `## [Unreleased]` above it. That section becomes the
   release notes.
3. Commit, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```

4. Wait for the Release workflow. It drafts a release with
   `Clipt_0.2.0_universal.dmg`, the same image as `Clipt.dmg` (the README and
   useclipt.dev link to `releases/latest/download/Clipt.dmg`), the updater
   archive and `latest.json`.
5. Download the disk image from the draft, open it on a Mac, and check that
   Clipt launches without a Gatekeeper warning.
6. Publish the draft. Installed copies find the update within a few hours,
   or straight away from **Check for Updates…**.

A tag that was pushed by mistake can be deleted along with its draft; nothing
reaches users until a release is published.

To try the pipeline without drafting anything, run the workflow by hand from
the Actions tab on `main`. It does the same build and keeps the files as a
workflow artifact for three days.

## How updates work

The app reads
`https://github.com/eduardoalba00/clipt/releases/latest/download/latest.json`,
which always points at the newest published release. That file names the
version and the signed archive to download. The app installs the archive only
if its signature matches the public key in `src-tauri/tauri.conf.json` and the
signed version matches the announced one, so a tampered or replayed release is
refused.

## Keys and secrets

None of these are in the repository, and none should ever be. `.gitignore`
blocks the usual key file types as a backstop.

| What | Where it lives | Used for |
| --- | --- | --- |
| Developer ID Application certificate | the maintainer's login keychain | signing the app and disk image |
| App Store Connect API key (`AuthKey_*.p8`) | `~/.private_keys/` | notarizing |
| Updater signing key | `~/.tauri/clipt-updater.key`, password in the keychain item "Clipt updater signing key" | signing updates |

The workflow gets copies through secrets in the repository's `release`
environment, which only `main` and `v*` tags can use. Pull requests,
including ones from forks, never see them. To upload or refresh them all:

```sh
APPLE_API_KEY_PATH=~/.private_keys/AuthKey_XXXXXXXXXX.p8 \
APPLE_API_ISSUER=<issuer id> \
scripts/setup-release-secrets.sh
```

Run it with `DRY_RUN=1` first to check the export without uploading.

**Back up the updater key and its password** somewhere safe, like a password
manager. Every installed copy of Clipt trusts only that key. If it's lost,
those copies can't update and their users have to download the next version
by hand. If it leaks, generate a new pair with `npx tauri signer generate`,
put the new public key in `tauri.conf.json`, and ship a release signed with
the old key that carries the new one, then retire the old key.
