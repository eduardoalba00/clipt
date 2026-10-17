#!/usr/bin/env bash
# Gives Clipt a stable code-signing identity, so macOS keeps the Screen
# Recording, Microphone and Camera permissions across rebuilds. (Ad-hoc
# signatures change every build, and macOS then forgets the permission.)
#
# Uses an Apple Development certificate if you have one. Otherwise it creates
# a self-signed "Clipt Dev" code-signing certificate in your login keychain;
# macOS asks for your password once to trust it.
#
# Then build with:
#   APPLE_SIGNING_IDENTITY="<the identity printed below>" npm run tauri build
set -euo pipefail

NAME="Clipt Dev"

existing=$(security find-identity -v -p codesigning | grep -E '"Apple Development|"'"$NAME"'"' | head -1 || true)
if [[ -n "$existing" ]]; then
  identity=$(sed -E 's/.*"(.*)"/\1/' <<<"$existing")
  echo "Using existing identity: $identity"
  echo "export APPLE_SIGNING_IDENTITY=\"$identity\""
  exit 0
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

cat >"$dir/cert.conf" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CONF

openssl req -new -newkey rsa:2048 -nodes -x509 -days 3650 \
  -config "$dir/cert.conf" -keyout "$dir/key.pem" -out "$dir/cert.pem" >/dev/null 2>&1
pass=$(openssl rand -hex 16)
openssl pkcs12 -export -legacy -inkey "$dir/key.pem" -in "$dir/cert.pem" \
  -name "$NAME" -out "$dir/cert.p12" -passout "pass:$pass" 2>/dev/null ||
  openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" \
    -name "$NAME" -out "$dir/cert.p12" -passout "pass:$pass"

keychain="$HOME/Library/Keychains/login.keychain-db"
security import "$dir/cert.p12" -k "$keychain" -P "$pass" -T /usr/bin/codesign
echo "Trusting the certificate for code signing (macOS will ask for your password)..."
security add-trusted-cert -r trustRoot -p codeSign -k "$keychain" "$dir/cert.pem"

echo "Created identity: $NAME"
echo "export APPLE_SIGNING_IDENTITY=\"$NAME\""
