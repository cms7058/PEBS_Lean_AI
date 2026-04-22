#!/bin/sh
# =========================================================================
# LeanAI Docker entrypoint
# - Ensures /data subdirs exist and are writable
# - Seeds bundled skills into /data/skills/node_modules on first boot
#   or when image has a newer version than the installed copy
# - Execs the server (PID 2 under tini)
# =========================================================================
set -e

DATA_DIR="${LEANAI_DATA_DIR:-/data}"
SKILLS_DIR="$DATA_DIR/skills/node_modules"
BUNDLED="/app/bundled-skills"

mkdir -p "$DATA_DIR/vector" "$DATA_DIR/skills/node_modules" \
         "$DATA_DIR/uploads" "$DATA_DIR/exports" "$DATA_DIR/logs"

# Seed bundled skills. We copy if (a) skill missing, or (b) bundled version
# differs from the installed one. Users can still `lean-ai skill remove ...`
# and that removal will persist across restarts (we only re-seed missing).
if [ -d "$BUNDLED" ]; then
  for src in "$BUNDLED"/*; do
    [ -d "$src" ] || continue
    name=$(basename "$src")
    # @lean-ai-scoped layout: /data/skills/node_modules/@lean-ai/<pkg>
    # but our bundled dirs are already flat (skill-charts, skill-diagnosis, ...)
    # Resolve real package name from package.json.
    pkg_name=$(node -e "console.log(require('$src/package.json').name)" 2>/dev/null || echo "$name")
    dest_parent="$SKILLS_DIR"
    case "$pkg_name" in
      @*/*) scope=${pkg_name%%/*}; mkdir -p "$SKILLS_DIR/$scope"; dest="$SKILLS_DIR/$pkg_name" ;;
      *)    dest="$SKILLS_DIR/$pkg_name" ;;
    esac
    # Copy only if missing (first boot). Upgrades happen through image rebuild
    # + user running `lean-ai skill install <name>` if they want the new version.
    if [ ! -d "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp -R "$src" "$dest"
      echo "[entrypoint] seeded skill: $pkg_name"
    fi
  done
fi

exec "$@"
