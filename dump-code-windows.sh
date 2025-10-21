#!/usr/bin/env bash

# Usage:  bash ./dump-code-windows.sh > code_dump.txt
# Dump developer-written source files with relative paths.
# Works on GNU find (Git Bash/MSYS2/Cygwin/WSL) and BSD find (macOS).
# Skips lockfiles, build outputs, and generated code.

set -Eeuo pipefail

ROOT="${1:-.}"
cd "$ROOT"

# Ensure consistent sort order across locales
export LC_ALL=C

# --- Pre-run cleanup: remove all ".history" directories under ROOT ---
# This deletes the .history folder and all its contents (root-level or nested).
# Works with GNU/BSD find.
find . -type d -name .history -prune -exec rm -rf {} + || true

# Print each matching file with its contents
find . \
  -type d \( -name node_modules -o -name .next -o -name .vscode -o -name .git -o -name dist -o -name build -o -name out -o -name coverage -o -name .cache -o -name tmp \) -prune -o \
  -type f \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
     -name "*.json" -o -name "*.css" -o -name "*.scss" -o -name "*.html" \
     -o -name "*.md" -o -name "*.yml" -o -name "*.yaml" \) \
  ! -name "yarn.lock" \
  ! -name "package-lock.json" \
  ! -name "pnpm-lock.yaml" \
  ! -name "bun.lockb" \
  ! -name ".gitignore" \
  ! -name ".env" \
  ! -name ".env.*" \
  ! -name ".DS_Store" \
  ! -name "tsconfig.tsbuildinfo" \
  ! -name ".dump-script-for-chatgpt.sh" \
  -print0 \
| sort -z \
| while IFS= read -r -d '' f; do
    rel="${f#./}"
    printf '===== FILE: %s =====\n' "$rel"
    cat -- "$f"
    printf '\n===== END FILE: %s =====\n\n' "$rel"
  done