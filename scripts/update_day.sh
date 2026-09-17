#!/bin/zsh
set -euo pipefail
# Compatibility alias. Require a filename so yesterday's patch is never implied.
exec "${0:A:h}/apply-patch.sh" "$@"
