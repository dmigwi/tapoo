#!/usr/bin/env sh

set -eu

BUILD_YEAR=$(date +%Y)
# One instant per build, shared by the footer's "updated" date and JSON-LD's dateModified, so the
# two can never disagree about when this deployment was cut. UTC because it is read by machines
# (structured data) as well as humans in unknown timezones.
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ASSET_VERSION=${GITHUB_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || date +%s)}
# The revision this deployment was built from, trimmed to the conventional 7 characters for semver
# build metadata. Prefers GITHUB_SHA like ASSET_VERSION above, and stays empty when neither source
# is available so a build from a source tarball still succeeds without a git binary.
COMMIT_HASH=$(printf '%.7s' "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo '')}")
STYLESHEET_FILENAME="tapoo-${ASSET_VERSION}.min.css"
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
  ./frontend/tapoo.ts \
  --bundle \
  --minify \
  --mangle-props=^__ \
  --platform=browser \
  --target=es2022 \
  --define:__TAPOO_BUILD_YEAR__=${BUILD_YEAR} \
  --define:__TAPOO_BUILD_DATE__="\"${BUILD_DATE}\"" \
  --outfile="./public/js/${TAPOO_FILENAME}"

TAPOO_STYLESHEET_HREF="./css/${STYLESHEET_FILENAME}" \
TAPOO_SCRIPT_SRC="./js/${TAPOO_FILENAME}" \
TAPOO_BUILD_DATE="${BUILD_DATE}" \
TAPOO_COMMIT_HASH="${COMMIT_HASH}" \
node ./scripts/build-html.mjs
