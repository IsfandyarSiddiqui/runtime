#!/usr/bin/env bash
# Licensed to the .NET Foundation under one or more agreements.
# The .NET Foundation licenses this file to you under the MIT license.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
results=artifacts/wasm-r2r-compression
test_tree=readytorun/ModuleInitializer
test_output=artifacts/tests/coreclr/browser.wasm.Release/$test_tree
mkdir -p "$results"
rm -f "$results/test-composite-sizes.json" "$results/test-composite-sizes.json.tmp"

# This upstream test always uses composite R2R and its generated script uses Node.js.
bash src/tests/build.sh -browser -release -coreclr -priority1 "-test:$test_tree/UnsafeAccessorModuleInitializer.csproj" \
    2>&1 | tee "$results/focused-test-build.log"
bash src/tests/run.sh wasm release --node --runcrossgen2tests "--tree=$test_tree" --verbose \
    2>&1 | tee "$results/focused-test-run.log"

mapfile -t images < <(find "$test_output" -name composite-r2r.wasm -type f)
if (( ${#images[@]} != 1 )); then
    printf 'Expected one Crossgen2 composite under %s, found %d\n' "$test_output" "${#images[@]}" >&2
    exit 1
fi

node eng/wasm-r2r-compression/measure.mjs "${images[0]}" > "$results/test-composite-sizes.json.tmp"
mv "$results/test-composite-sizes.json.tmp" "$results/test-composite-sizes.json"
cat "$results/test-composite-sizes.json"
