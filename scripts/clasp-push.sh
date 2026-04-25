#!/usr/bin/env bash
set -euo pipefail

if ! command -v clasp >/dev/null 2>&1; then
  echo "Error: clasp is not installed. Install it with: npm i -g @google/clasp"
  exit 1
fi

if [[ ! -f ".clasp.json" ]]; then
  echo "Error: .clasp.json not found in the current directory."
  echo "Run 'clasp login' and 'clasp create' (or 'clasp clone <SCRIPT_ID>') first."
  exit 1
fi

echo "Pushing local files to Google Apps Script..."
clasp push
echo "Done."
