#!/usr/bin/env bash
# bundle-check — Build the viewer and report bundle size.
#
# Usage: ./scripts/bundle-check.sh [max_kb]
# Default max: 512 KB
#
# Exit codes: 0 = within budget, 1 = over budget or build failure

set -euo pipefail

MAX_KB="${1:-512}"
SCAFFOLD_DIR="scaffold"
VIEWER_DIR="map-viewer"

# Use whichever exists
if [ -d "$VIEWER_DIR" ]; then
  BUILD_DIR="$VIEWER_DIR"
elif [ -d "$SCAFFOLD_DIR" ]; then
  BUILD_DIR="$SCAFFOLD_DIR"
else
  echo "ERR  No viewer directory found (tried map-viewer/ and scaffold/)"
  exit 1
fi

echo "── Bundle Check ──"
echo ""
echo "  Building: $BUILD_DIR"
echo "  Budget:   ${MAX_KB} KB"
echo ""

# Install deps if needed
if [ ! -d "$BUILD_DIR/node_modules" ]; then
  echo "  Installing dependencies..."
  (cd "$BUILD_DIR" && npm install --silent) || {
    echo "ERR  npm install failed"
    exit 1
  }
fi

# Build
echo "  Running vite build..."
(cd "$BUILD_DIR" && npx vite build --logLevel error) || {
  echo "ERR  vite build failed"
  exit 1
}

# Measure dist/ size
DIST_DIR="$BUILD_DIR/dist"
if [ ! -d "$DIST_DIR" ]; then
  echo "ERR  No dist/ directory after build"
  exit 1
fi

# Total size of all files in dist/assets/
TOTAL_BYTES=0
JS_BYTES=0
CSS_BYTES=0

while IFS= read -r file; do
  SIZE=$(wc -c < "$file" | tr -d ' ')
  TOTAL_BYTES=$((TOTAL_BYTES + SIZE))

  if [[ "$file" == *.js ]]; then
    JS_BYTES=$((JS_BYTES + SIZE))
  elif [[ "$file" == *.css ]]; then
    CSS_BYTES=$((CSS_BYTES + SIZE))
  fi
done < <(find "$DIST_DIR" -type f -name '*.js' -o -name '*.css')

TOTAL_KB=$((TOTAL_BYTES / 1024))
JS_KB=$((JS_BYTES / 1024))
CSS_KB=$((CSS_BYTES / 1024))

echo ""
echo "  JS:    ${JS_KB} KB"
echo "  CSS:   ${CSS_KB} KB"
echo "  Total: ${TOTAL_KB} KB"

if [ "$TOTAL_KB" -gt "$MAX_KB" ]; then
  echo ""
  echo "  OVER BUDGET by $((TOTAL_KB - MAX_KB)) KB"
  echo ""

  # Show largest files
  echo "  Largest files:"
  find "$DIST_DIR" -type f \( -name '*.js' -o -name '*.css' \) -exec wc -c {} + | sort -rn | head -5 | while read -r size file; do
    echo "    $(( size / 1024 )) KB  $file"
  done

  echo ""
  echo "FAILED"
  exit 1
fi

echo ""
echo "PASSED (${TOTAL_KB}/${MAX_KB} KB)"
