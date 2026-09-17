#!/bin/zsh
set -euo pipefail

PREVIEW_ONLY=0
if [[ "${1:-}" == "--preview" ]]; then
  PREVIEW_ONLY=1
  shift
fi
PATCH_NAME="${1:?Usage: $0 [--preview] <patch-name.md> [downloads-file.md]}"
DOWNLOAD_NAME="${2:-}"
PROJECT_DIR="${0:A:h:h}"
PATCH_DIR="$PROJECT_DIR/../study_plans/special_course/patches"
PATCH_PATH="$PATCH_DIR/$PATCH_NAME"

# Both arguments are filenames, not paths. Preserve the original download.
if [[ "$PATCH_NAME" != *.md || "$PATCH_NAME" == */* || "$DOWNLOAD_NAME" == */* ]]; then
  echo "Use Markdown filenames without directory components."
  exit 2
fi
SOURCE_PATH="$PATCH_PATH"
if [[ -n "$DOWNLOAD_NAME" ]]; then
  SOURCE_PATH="$HOME/Downloads/$DOWNLOAD_NAME"
  if [[ -f "$PATCH_PATH" ]] && ! cmp -s "$SOURCE_PATH" "$PATCH_PATH"; then
    echo "Destination already exists with different content: $PATCH_PATH"
    echo "Choose a new patch filename to preserve both versions."
    exit 1
  fi
fi
if [[ ! -f "$SOURCE_PATH" ]]; then
  echo "Patch not found: $SOURCE_PATH"
  exit 1
fi

make -C "$PROJECT_DIR" plan-validate PLAN="$SOURCE_PATH"
make -C "$PROJECT_DIR" plan-preview PLAN="$SOURCE_PATH"
if (( PREVIEW_ONLY )); then
  echo "Preview passed. No patch was applied."
  exit 0
fi
if [[ -n "$DOWNLOAD_NAME" && ! -f "$PATCH_PATH" ]]; then
  mkdir -p "$PATCH_DIR"
  cp -n "$SOURCE_PATH" "$PATCH_PATH"
fi
# The CLI revalidates, takes a consistent backup, and applies one transaction.
make -C "$PROJECT_DIR" plan-patch PATCH="$PATCH_PATH"
echo "Applied: $PATCH_NAME"
