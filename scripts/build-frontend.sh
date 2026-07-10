#!/usr/bin/env sh

set -eu

if [ ! -x "./node_modules/.bin/esbuild" ]; then
  echo "esbuild not found. Install it with: pnpm add -D esbuild" >&2
  exit 1
fi

./node_modules/.bin/esbuild \
  ./frontend/tapoo.ts \
  --bundle \
  --minify \
  --platform=browser \
  --target=es2022 \
  --outfile=./public/js/tapoo.min.js
