#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -gt 0 ]]; then
  echo "Usage: ./clasp-push.sh"
  exit 2
fi

require_private_file() {
  local path="$1"

  if [[ ! -f "$path" ]]; then
    return
  fi

  local mode
  mode="$(stat -c "%a" "$path" 2>/dev/null || stat -f "%Lp" "$path")"

  if [[ "$mode" != "600" ]]; then
    echo "Error: $path must be chmod 600, currently $mode."
    echo "Fix it with: chmod 600 '$path'"
    exit 1
  fi
}

require_private_file ".clasp.json"
require_private_file "$HOME/.clasprc.json"

if [[ ! -f ".clasp.json" ]]; then
  echo "Error: .clasp.json not found in the current directory."
  echo "Run 'clasp login' and 'clasp create' (or 'clasp clone <SCRIPT_ID>') first."
  exit 1
fi

CLASP_CMD=()
if command -v clasp >/dev/null 2>&1; then
  CLASP_CMD=(clasp)
else
  CLASP_CMD=(npx -y @google/clasp)
fi

echo "Pushing local files to Google Apps Script..."
"${CLASP_CMD[@]}" push --force
echo "Done."
