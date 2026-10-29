#!/usr/bin/env bash
# Runs the packed @vigilon/cli through its installed bin, as a CI pipeline
# would: injects into a small build output, then checks the script and its
# map carry the same debug ID and that a second run changes nothing.
set -euo pipefail

mkdir -p cli-dist
printf 'console.log("smoke");\n//# sourceMappingURL=app.js.map\n' > cli-dist/app.js
printf '{"version":3,"sources":["app.ts"],"names":[],"mappings":"AAAA"}' > cli-dist/app.js.map

npx --no-install vigilon --version > /dev/null
npx --no-install vigilon sourcemaps inject cli-dist > /dev/null
id=$(grep -o 'debugId=[0-9a-f-]*' cli-dist/app.js | cut -d= -f2)
map_id=$(node -p 'JSON.parse(require("fs").readFileSync("cli-dist/app.js.map", "utf8")).debugId')
[ -n "$id" ] && [ "$id" = "$map_id" ] || { echo "smoke [cli]: FAILED — script and map debug IDs differ ($id, $map_id)"; exit 1; }
before=$(cat cli-dist/app.js)
npx --no-install vigilon sourcemaps inject cli-dist > /dev/null
[ "$before" = "$(cat cli-dist/app.js)" ] || { echo "smoke [cli]: FAILED — a second inject changed the script"; exit 1; }
echo "smoke [cli]: OK — the packed vigilon bin injects debug ID $id and is idempotent"
