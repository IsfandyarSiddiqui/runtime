#!/usr/bin/env bash
# Licensed to the .NET Foundation under one or more agreements.
# The .NET Foundation licenses this file to you under the MIT license.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
results=artifacts/wasm-r2r-compression
runtime=artifacts/bin/coreclr/browser.wasm.Release
image="$runtime/System.Private.CoreLib.wasm"
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

./.dotnet/dotnet "$runtime/R2RDump/R2RDump.dll" --in "$image" --section RuntimeFunctions --raw --sc \
    > "$results/corelib-r2rdump.txt" 2>&1
python3 - "$results/corelib-sizes.json" "$results/corelib-r2rdump.txt" <<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path

image = json.loads(Path(sys.argv[1]).read_text())["images"][0]
dump = Path(sys.argv[2]).read_text(encoding="utf-8-sig")
lines = re.findall(r"^ {4}[0-9A-F]{8}:( +[0-9A-F]{2}(?: [0-9A-F]{2})*)\r?$", dump, re.MULTILINE)
records = bytes.fromhex(" ".join(lines))
minimum = re.search(r"^MinFunctionTableIndex: (\d+)\r?$", dump, re.MULTILINE)
if (
    not records
    or hashlib.sha256(records).hexdigest() != image["runtimeFunctionTable"]["sha256"]
    or "Sentinel: 0xFFFFFFFF" not in dump
    or minimum is None
    or int(minimum[1]) != image["minimumFunctionTableIndex"]
):
    sys.exit("R2RDump output does not match the extracted runtime-function table and trailer")
print("R2RDump confirms the CoreLib runtime-function table SHA-256, sentinel, and minimum index.")
PY
