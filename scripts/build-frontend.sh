#!/usr/bin/env sh

set -eu

BUILD_YEAR=$(date +%Y)

node ./scripts/build-html.mjs

if [ ! -x "./node_modules/.bin/esbuild" ]; then
  echo "esbuild not found. Install it with: pnpm add -D esbuild" >&2
  exit 1
fi

./node_modules/.bin/esbuild \
  ./frontend/styles/tapoo.css \
  --minify \
  --outfile=./public/css/tapoo.min.css

./node_modules/.bin/esbuild \
  ./frontend/page-chrome.ts \
  --bundle \
  --minify \
  --mangle-props=^__ \
  --platform=browser \
  --target=es2022 \
  --define:__TAPOO_BUILD_YEAR__=${BUILD_YEAR} \
  --outfile=./public/js/page-chrome.min.js

./node_modules/.bin/esbuild \
  ./frontend/tapoo.ts \
  --bundle \
  --minify \
  --mangle-props=^__ \
  --platform=browser \
  --target=es2022 \
  --outfile=./public/js/tapoo.min.js
