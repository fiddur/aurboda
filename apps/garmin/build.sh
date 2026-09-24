#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
: "${CIQ_SDK:?path to the Connect IQ SDK}"
: "${CIQ_DEVELOPER_KEY:?path to the developer key .der}"
DEVICE="${1:-fr255}"
mkdir -p bin
"$CIQ_SDK/bin/monkeyc" -d "$DEVICE" -f monkey.jungle -o "bin/aurboda-$DEVICE.prg" -y "$CIQ_DEVELOPER_KEY" -w -l 3
