#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then npm install; fi
if command -v open >/dev/null 2>&1; then (sleep 1; open "http://127.0.0.1:5173") & fi
exec npm run dev -- --host 127.0.0.1
