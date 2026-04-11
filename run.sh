#!/bin/bash
# Run any JS file with x86_64 Node (required for x86_64 MVS SDK on Apple Silicon)
# Usage: ./run.sh example.js
#        ./run.sh scripts/test-sdk.js
cd "$(dirname "$0")"
SCRIPT="${1:-example.js}"
exec arch -x86_64 .node-x64/bin/node "$SCRIPT" "${@:2}"
