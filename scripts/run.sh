#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
CONFIG_FILE="$SCRIPT_DIR/config.json"

if [[ $# -lt 1 ]]; then
  echo "Usage: ./run.sh <script.js> [extra k6 args...]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env not found at $ENV_FILE" >&2
  exit 1
fi
set -a

source "$ENV_FILE"
set +a
TARGET="$1"
shift
if [[ "$TARGET" != */* ]]; then
  TARGET="$SCRIPT_DIR/$TARGET"
fi
if [[ ! -f "$TARGET" ]]; then
  echo "Error: target script not found: $TARGET" >&2
  exit 1
fi

echo "+ k6 run --config $CONFIG_FILE --include-system-env-vars $TARGET $*"
exec k6 run --config "$CONFIG_FILE" --include-system-env-vars "$TARGET" "$@"
