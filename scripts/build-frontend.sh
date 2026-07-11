#!/usr/bin/env sh

set -eu

BUILD_YEAR=$(date +%Y)

if [ ! -x "./node_modules/.bin/esbuild" ]; then
  echo "esbuild not found. Install it with: pnpm add -D esbuild" >&2
  exit 1
fi

./node_modules/.bin/esbuild \
  ./frontend/styles/tapoo.css \
  --minify \
  --outfile=./public/css/tapoo.min.css

./node_modules/.bin/esbuild \
  ./frontend/page-meta.ts \
  --bundle \
  --minify \
  --platform=browser \
  --target=es2022 \
  --define:__TAPOO_BUILD_YEAR__=${BUILD_YEAR} \
  --outfile=./public/js/page-meta.min.js

./node_modules/.bin/esbuild \
  ./frontend/top-menu.ts \
  --bundle \
  --minify \
  --platform=browser \
  --target=es2022 \
  --outfile=./public/js/top-menu.min.js

./node_modules/.bin/esbuild \
  ./frontend/tapoo.ts \
  --bundle \
  --minify \
  --platform=browser \
  --target=es2022 \
  --outfile=./public/js/tapoo.min.js
