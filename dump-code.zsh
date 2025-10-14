#!/usr/bin/env zsh
# Dump developer-written source files with relative paths.
# Works on macOS (BSD find). Skips lockfiles, build outputs, and generated code.

set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

# Print each matching file with its contents
find . \
  -type d \( -name node_modules -o -name .next -o -name .vscode -o -name .git -o -name dist -o -name build -o -name out -o -name coverage -o -name .cache -o -name tmp \) -prune -o \
  -type f \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
     -o -name "*.json" -o -name "*.css" -o -name "*.scss" -o -name "*.html" \
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
  -print \
| LC_ALL=C sort \
| while IFS= read -r f; do
    rel="${f#./}"
    printf '===== FILE: %s =====\n' "$rel"
    cat "$f"
    printf '\n===== END FILE: %s =====\n\n' "$rel"
  done
