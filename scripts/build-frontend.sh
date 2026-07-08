#!/usr/bin/env sh

set -eu

if [ ! -f "./node_modules/typescript/bin/tsc" ]; then
  echo "TypeScript compiler not found. Install it with: npm install -D typescript" >&2
  exit 1
fi

if [ ! -f "./node_modules/terser/bin/terser" ]; then
  echo "Terser not found. Install it with: pnpm add -D terser" >&2
  exit 1
fi

node ./node_modules/typescript/bin/tsc --project tsconfig.json
node ./node_modules/terser/bin/terser \
  ./public/js/tapoo.js \
  --compress \
  --mangle \
  --output ./public/js/tapoo.min.js
