#!/usr/bin/env bash
# Licensed to the .NET Foundation under one or more agreements.
# The .NET Foundation licenses this file to you under the MIT license.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
results=artifacts/wasm-r2r-compression
test_tree=readytorun/ModuleInitializer
assembly=UnsafeAccessorModuleInitializer
test_output=artifacts/tests/coreclr/browser.wasm.Release/$test_tree/$assembly
mkdir -p "$results"

# Export the setting to the nested MSBuild process that actually builds the test.
BuildAllTestsAsStandalone=true \
    bash src/tests/build.sh -browser -release -coreclr -priority1 "-test:$test_tree/$assembly.csproj" \
    2>&1 | tee "$results/focused-test-build.log"

# The runner discovers this marker, even when the test assembly was successfully compiled.
marker="$test_output/$assembly.StandaloneTestRunner"
if [[ ! -s "$marker" ]]; then
    printf 'The standalone test discovery marker is missing: %s\n' "$marker" >&2
    exit 1
fi
rm -rf "$test_output/IL-CG2"
rm -f "$test_output/composite-r2r.wasm"
bash src/tests/run.sh wasm release --node --runcrossgen2tests "--tree=$test_tree" --verbose \
    2>&1 | tee "$results/focused-test-run.log"

test -s "$test_output/composite-r2r.wasm"
