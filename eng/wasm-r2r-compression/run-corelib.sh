#!/usr/bin/env bash
# Licensed to the .NET Foundation under one or more agreements.
# The .NET Foundation licenses this file to you under the MIT license.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
results=artifacts/wasm-r2r-compression
image=artifacts/bin/coreclr/browser.wasm.Release/System.Private.CoreLib.wasm
mkdir -p "$results"
rm -f "$results/corelib-sizes.json" "$results/corelib-sizes.json.tmp"

{
    git rev-parse HEAD
    uname -a
    lscpu
    free -h
    df -h .
    node --version
    clang --version
    cmake --version
} > "$results/environment.txt"

node --test eng/wasm-r2r-compression/measure.test.mjs
build=(./build.sh clr+libs+host+packs -os browser -c Release /p:AotHostArchitecture=x64 /p:AotHostOS=linux)
printf '%q ' "${build[@]}" | tee "$results/build.log"
printf '\n' | tee -a "$results/build.log"
/usr/bin/time -v "${build[@]}" 2>&1 | tee -a "$results/build.log"
./.dotnet/dotnet --info >> "$results/environment.txt"

node eng/wasm-r2r-compression/measure.mjs "$image" > "$results/corelib-sizes.json.tmp"
mv "$results/corelib-sizes.json.tmp" "$results/corelib-sizes.json"
cat "$results/corelib-sizes.json"
