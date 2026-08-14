#!/usr/bin/env sh

set -eu

BUILD_YEAR=$(date +%Y)
ASSET_VERSION=${GITHUB_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || date +%s)}
STYLESHEET_FILENAME="tapoo-${ASSET_VERSION}.min.css"
PAGE_CHROME_FILENAME="page-chrome-${ASSET_VERSION}.min.js"
TAPOO_FILENAME="tapoo-${ASSET_VERSION}.min.js"

if [ ! -x "./node_modules/.bin/esbuild" ]; then
  echo "esbuild not found. Install it with: pnpm add -D esbuild" >&2
  exit 1
fi

mkdir -p ./public ./public/css ./public/js

# Clear only generated browser outputs before rebuilding so Pages never ships stale HTML or
# versioned bundles from an earlier build, while static assets like fonts and images remain intact.
rm -f ./public/*.html
rm -f ./public/css/tapoo*.min.css
rm -f ./public/js/page-chrome*.min.js
rm -f ./public/js/tapoo*.min.js

./node_modules/.bin/esbuild \
  ./frontend/styles/tapoo.css \
  --minify \
  --outfile="./public/css/${STYLESHEET_FILENAME}"

./node_modules/.bin/esbuild \
  ./frontend/page-chrome.ts \
  --bundle \
  --minify \
  --mangle-props=^__ \
  --platform=browser \
  --target=es2022 \
  --define:__TAPOO_BUILD_YEAR__=${BUILD_YEAR} \
  --outfile="./public/js/${PAGE_CHROME_FILENAME}"

./node_modules/.bin/esbuild \
  ./frontend/tapoo.ts \
  --bundle \
  --minify \
  --mangle-props=^__ \
  --platform=browser \
  --target=es2022 \
  --outfile="./public/js/${TAPOO_FILENAME}"

TAPOO_STYLESHEET_HREF="./css/${STYLESHEET_FILENAME}" \
TAPOO_PAGE_CHROME_SRC="./js/${PAGE_CHROME_FILENAME}" \
TAPOO_GAME_SRC="./js/${TAPOO_FILENAME}" \
node ./scripts/build-html.mjs
