# Wasm ReadyToRun compression measurements

The source baseline is [`b057fce5aa4cc17b10f001f3f71192e4c01af77d`](https://github.com/dotnet/runtime/commit/b057fce5aa4cc17b10f001f3f71192e4c01af77d) from `release/11.0`. Keep `baseline` at that revision, put shared tooling on `setup`, and branch `original`, `david`, and `isfandyar` from the same setup commit. [Upstream issue](https://github.com/dotnet/runtime/issues/135796)

## Build and measure stock CoreLib

On a Linux x64 host with the [runtime build dependencies](../../docs/workflow/requirements/linux-requirements.md) and Node.js, run from the repository root.

```sh
bash eng/wasm-r2r-compression/run-corelib.sh
```

The script builds browser-Wasm CoreCLR and its host tools and packs in Release, using the same subset and host flags as the repository's [performance pipeline](../pipelines/performance/templates/perf-wasm-build-jobs.yml). The build's [CoreLib target](../../src/coreclr/crossgen-corelib.proj) emits the R2R image as `artifacts/bin/coreclr/browser.wasm.Release/System.Private.CoreLib.wasm`. The script records the build log, elapsed time, peak RSS, environment, commit SHA, and CoreLib measurements under `artifacts/wasm-r2r-compression/`. Use a fresh build tree for build-cost comparisons.

The fork's `Wasm R2R CoreLib baseline` workflow runs the same script on a Linux GitHub-hosted runner when `original` is pushed, provided Actions is enabled. It publishes the measurements and log as a run artifact. The repository's Wasm devcontainer currently prebuilds Mono and requires a separate CoreCLR build for this experiment.

## Measure an existing image

```sh
node eng/wasm-r2r-compression/measure.mjs path/to/System.Private.CoreLib.wasm path/to/composite-code.wasm
```

Pass the Wasm image that owns the runtime-function table. For a composite, use the Wasm code image containing the table. The tool reads the physical table bytes through the Webcil and R2R headers, checks the sentinel, records the minimum table index, and reports SHA-256 plus raw and Brotli sizes. It preserves the bytes emitted by each variant. The table measurement excludes the eight-byte trailer. Whole-image and table results are independent measurements. Brotli quality 11, window 22, and generic mode match the historical settings. Each compressed stream is decompressed and checked against its input. Use the same Node and Brotli versions across variants.

```sh
node --test eng/wasm-r2r-compression/measure.test.mjs
```

## Verification status

The extractor and Brotli round trips pass on synthetic raw Webcil and Wasm-wrapped fixtures. The fixtures also cover truncated input and an incorrect sentinel. A cloud CoreCLR build, real-image validation against R2RDump, representative composite generation, targeted R2R tests, startup/allocation measurements, and runtime timings are pending. Keep default function order for the primary comparisons. This checklist and the runner setup can evolve as the first build exposes additional requirements.
