#!/usr/bin/env bash
# Licensed to the .NET Foundation under one or more agreements.
# The .NET Foundation licenses this file to you under the MIT license.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
runtime="$PWD/artifacts/bin/coreclr/browser.wasm.Release"
test_root="$PWD/artifacts/tests/coreclr/browser.wasm.Release"
core_root="$test_root/Tests/Core_Root"
results="$PWD/artifacts/wasm-r2r-compression"
output="$PWD/artifacts/obj/wasm-r2r-compression/composite"
image="$output/corelib-module-initializer.wasm"

mapfile -t test_inputs < <(find "$test_root/readytorun/ModuleInitializer" -type d -name IL-CG2)
if (( ${#test_inputs[@]} != 1 )); then
    printf 'Expected one module initializer input directory. Run run-focused-tests.sh first.\n' >&2
    exit 1
fi

test_input=${test_inputs[0]}
shopt -s nullglob
export LC_ALL=C
assemblies=("$test_input"/*.dll)
if (( ${#assemblies[@]} == 0 )); then
    printf 'No module initializer assemblies found in %s\n' "$test_input" >&2
    exit 1
fi

inputs=("$runtime/IL/System.Private.CoreLib.dll" "${assemblies[@]}")
mkdir -p "$results" "$output"
rm -f "$image" "$results/default-order-composite-sizes.json" "$results/default-order-composite-sizes.json.tmp"
sha256sum "${inputs[@]}" > "$results/default-order-composite-inputs.sha256"

compile=("$runtime/x64/crossgen2/crossgen2" --targetos:browser --targetarch:wasm --obj-format:wasm
    --codegenopt:JitWasmNyiToR2RUnsupported=1 -O --composite
    --compositerootpath "$test_input" "-r:$core_root/*.dll" "-o:$image" "${inputs[@]}")
printf '%q ' "${compile[@]}" | tee "$results/default-order-composite-build.log"
printf '\n' | tee -a "$results/default-order-composite-build.log"
"${compile[@]}" 2>&1 | tee -a "$results/default-order-composite-build.log"

node eng/wasm-r2r-compression/measure.mjs "$image" > "$results/default-order-composite-sizes.json.tmp"
mv "$results/default-order-composite-sizes.json.tmp" "$results/default-order-composite-sizes.json"
cat "$results/default-order-composite-sizes.json"
cp "$image" "$results/corelib-module-initializer.wasm"
