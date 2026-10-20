#!/usr/bin/env bash
# Maintainers only. Uploads everything the Release workflow needs to sign,
# notarize and publish Clipt into the repository's `release` environment.
# The secrets go straight from your Mac to GitHub's encrypted store; nothing
# is written into the repository or printed.
#
#   APPLE_API_KEY_PATH=~/.private_keys/AuthKey_XXXXXXXXXX.p8 \
#   APPLE_API_ISSUER=<issuer id> \
#   scripts/setup-release-secrets.sh
#
# DRY_RUN=1 does everything except the upload.
#
# Also needs, on this Mac:
# - a "Developer ID Application" identity in the login keychain (macOS asks
#   you to allow exporting it),
# - the updater signing key at ~/.tauri/clipt-updater.key (override with
#   TAURI_KEY_PATH), with its password in the keychain item
#   "Clipt updater signing key" or in TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
set -euo pipefail
umask 077

: "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH to your App Store Connect .p8 key}"
: "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER to your App Store Connect issuer ID}"
TAURI_KEY_PATH=${TAURI_KEY_PATH:-$HOME/.tauri/clipt-updater.key}
ENVIRONMENT=release

api_key_id=$(basename "$APPLE_API_KEY_PATH" | sed -nE 's/^AuthKey_([A-Z0-9]+)\.p8$/\1/p')
[[ -n "$api_key_id" ]] || { echo "Expected a file named AuthKey_<KEY ID>.p8" >&2; exit 1; }
[[ -f "$TAURI_KEY_PATH" ]] || { echo "No updater key at $TAURI_KEY_PATH" >&2; exit 1; }
updater_password=${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s "Clipt updater signing key" -a clipt -w)}

identity=$(security find-identity -v -p codesigning | sed -nE 's/.*"(Developer ID Application: .*)"/\1/p' | head -1)
[[ -n "$identity" ]] || { echo "No Developer ID Application identity in the keychain" >&2; exit 1; }
echo "Signing identity: $identity"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

# `security export` takes every identity in the keychain; keep only this one.
export EXPORT_PASS NEW_PASS
EXPORT_PASS=$(openssl rand -hex 24)
NEW_PASS=$(openssl rand -hex 24)
echo "Exporting it (allow the keychain prompt)..."
security export -k "$HOME/Library/Keychains/login.keychain-db" -t identities -f pkcs12 \
  -P "$EXPORT_PASS" -o "$dir/all.p12"
openssl pkcs12 -in "$dir/all.p12" -passin env:EXPORT_PASS -nodes -out "$dir/all.pem" 2>/dev/null
IDENTITY="$identity" python3 -I - "$dir" <<'PY'
import os, re, sys
d = sys.argv[1]
pem = open(f"{d}/all.pem").read()
blocks = re.findall(r"(Bag Attributes.*?-----END [A-Z ]+-----\n)", pem, re.S)
key_id = lambda b: (re.search(r"localKeyID: ([0-9A-F ]+)", b) or [None, None])[1]
certs = [b for b in blocks if "CERTIFICATE" in b and f"friendlyName: {os.environ['IDENTITY']}\n" in b]
keys = [b for b in blocks if "PRIVATE KEY" in b and certs and key_id(b) == key_id(certs[0])]
if len(certs) != 1 or len(keys) != 1:
    sys.exit("Couldn't find exactly one certificate and key for the identity")
body = lambda b: b[b.index("-----BEGIN"):]
open(f"{d}/cert.pem", "w").write(body(certs[0]))
open(f"{d}/key.pem", "w").write(body(keys[0]))
PY
issuer=$(openssl x509 -in "$dir/cert.pem" -noout -issuer | sed -E 's/.*CN ?= ?([^,/]*).*/\1/')
security find-certificate -a -c "$issuer" -p /Library/Keychains/System.keychain \
  "$HOME/Library/Keychains/login.keychain-db" >"$dir/chain.pem" 2>/dev/null || true
# SHA-1/3DES, because `security import` on the CI runner can't read newer PKCS#12.
chain=()
[[ -s "$dir/chain.pem" ]] && chain=(-certfile "$dir/chain.pem")
openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" ${chain[@]+"${chain[@]}"} \
  -name "$identity" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout env:NEW_PASS -out "$dir/identity.p12"

# Prove a fresh keychain, like the runner's, can import and sign with it.
keychain="$dir/check.keychain-db"
security create-keychain -p check "$keychain"
imported=0
security import "$dir/identity.p12" -k "$keychain" -P "$NEW_PASS" -T /usr/bin/codesign >/dev/null &&
  security find-identity -v -p codesigning "$keychain" | grep -qF "$identity" && imported=1
security delete-keychain "$keychain"
[[ $imported == 1 ]] || { echo "The exported identity didn't import cleanly" >&2; exit 1; }
echo "Exported identity imports and signs cleanly."
[[ -n "${DRY_RUN:-}" ]] && { echo "Dry run: nothing uploaded."; exit 0; }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
put() { gh secret set "$1" --env "$ENVIRONMENT" --repo "$repo"; }
base64 -i "$dir/identity.p12" | put APPLE_CERTIFICATE
printf %s "$NEW_PASS" | put APPLE_CERTIFICATE_PASSWORD
printf %s "$identity" | put APPLE_SIGNING_IDENTITY
printf %s "$api_key_id" | put APPLE_API_KEY
printf %s "$APPLE_API_ISSUER" | put APPLE_API_ISSUER
put APPLE_API_KEY_P8 <"$APPLE_API_KEY_PATH"
put TAURI_SIGNING_PRIVATE_KEY <"$TAURI_KEY_PATH"
printf %s "$updater_password" | put TAURI_SIGNING_PRIVATE_KEY_PASSWORD

echo "Uploaded 8 secrets to the '$ENVIRONMENT' environment of $repo:"
gh secret list --env "$ENVIRONMENT" --repo "$repo"
