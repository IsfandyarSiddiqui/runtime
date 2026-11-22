// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { platform, arch } from 'node:os';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const webcilMagic = 0x4c496257; // WbIL
const wasmMagic = 0x6d736100;
const readyToRunSignature = 0x00525452;
const runtimeFunctionsSection = 102;
const recordSize = 8;
const trailerSize = 8;
const brotli = { quality: 11, window: 22, mode: 'generic' };

function requireFormat(condition, reason) {
    if (!condition) {
        throw new Error(reason);
    }
}

function readUleb32(bytes, cursor) {
    let value = 0;
    for (let shift = 0; shift <= 28 && cursor.offset < bytes.length; shift += 7) {
        const byte = bytes[cursor.offset++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0 && value <= 0xffffffff) {
            return value;
        }
    }
    throw new Error('Invalid WebAssembly ULEB128');
}

function getWebcilPayload(image) {
    requireFormat(image.length >= 8, 'Truncated image header');
    if (image.readUInt32LE(0) === webcilMagic) {
        return image;
    }
    requireFormat(image.readUInt32LE(0) === wasmMagic && image.readUInt32LE(4) === 1,
        'Expected a Webcil image or a WebAssembly v1 module');

    const cursor = { offset: 8 };
    while (cursor.offset < image.length) {
        const sectionId = image[cursor.offset++];
        const size = readUleb32(image, cursor);
        const end = cursor.offset + size;
        requireFormat(end <= image.length, 'Truncated WebAssembly section');
        if (sectionId === 11) {
            const data = image.subarray(cursor.offset, end);
            const position = { offset: 0 };
            const count = readUleb32(data, position);
            // The R2R Wasm object writer emits passive data segments, including the Webcil payload.
            for (let index = 0; index < count; index++) {
                requireFormat(readUleb32(data, position) === 1, 'Expected a passive WebAssembly data segment');
                const length = readUleb32(data, position);
                const segmentEnd = position.offset + length;
                requireFormat(segmentEnd <= data.length, 'Truncated WebAssembly data segment');
                if (length >= 4 && data.readUInt32LE(position.offset) === webcilMagic) {
                    return data.subarray(position.offset, segmentEnd);
                }
                position.offset = segmentEnd;
            }
            break;
        }
        cursor.offset = end;
    }
    throw new Error('No Webcil payload found');
}

export function getRuntimeFunctionTable(image) {
    const webcil = getWebcilPayload(image);
    requireFormat(webcil.length >= 28, 'Truncated Webcil header');
    const major = webcil.readUInt16LE(4);
    requireFormat((major === 0 || major === 1) && webcil.readUInt16LE(6) === 0, 'Unsupported Webcil version');
    const directory = major === 0 ? 28 : 32;
    const directoryEnd = directory + webcil.readUInt16LE(8) * 16;
    requireFormat(directoryEnd <= webcil.length, 'Truncated Webcil section directory');

    function offsetForRva(rva, size) {
        for (let offset = directory; offset < directoryEnd; offset += 16) {
            const relative = rva - webcil.readUInt32LE(offset + 4);
            const backedSize = Math.min(webcil.readUInt32LE(offset), webcil.readUInt32LE(offset + 8));
            if (relative >= 0 && relative + size <= backedSize) {
                const start = webcil.readUInt32LE(offset + 12) + relative;
                requireFormat(start + size <= webcil.length, 'Truncated Webcil section data');
                return start;
            }
        }
        throw new Error(`No Webcil section contains RVA 0x${rva.toString(16)} (${size} bytes)`);
    }

    const cliSize = 72;
    requireFormat(webcil.readUInt32LE(16) >= cliSize, 'Missing or short CLI header');
    const cli = offsetForRva(webcil.readUInt32LE(12), cliSize);
    const nativeSize = webcil.readUInt32LE(cli + 68);
    requireFormat(nativeSize >= 16, 'No managed native header');
    const native = offsetForRva(webcil.readUInt32LE(cli + 64), nativeSize);
    requireFormat(webcil.readUInt32LE(native) === readyToRunSignature, 'Invalid ReadyToRun signature');
    const sectionCount = webcil.readUInt32LE(native + 12);
    requireFormat(16 + sectionCount * 12 <= nativeSize, 'Truncated ReadyToRun section directory');
    for (let entry = native + 16; entry < native + 16 + sectionCount * 12; entry += 12) {
        if (webcil.readUInt32LE(entry) !== runtimeFunctionsSection) {
            continue;
        }
        const size = webcil.readUInt32LE(entry + 8);
        requireFormat(size % recordSize === 0, 'Runtime-function table size is not a multiple of 8');
        const start = offsetForRva(webcil.readUInt32LE(entry + 4), size + trailerSize);
        const trailer = start + size;
        requireFormat(webcil.readUInt32LE(trailer) === 0xffffffff, 'Invalid runtime-function sentinel');
        return {
            records: webcil.subarray(start, trailer),
            minimumFunctionTableIndex: webcil.readUInt32LE(trailer + 4),
            readyToRunVersion: `${webcil.readUInt16LE(native + 4)}.${webcil.readUInt16LE(native + 6)}`,
            readyToRunFlags: webcil.readUInt32LE(native + 8),
        };
    }
    throw new Error('No runtime-function table in the ReadyToRun header');
}

function measureBytes(bytes) {
    const compressed = brotliCompressSync(bytes, { params: {
        [constants.BROTLI_PARAM_QUALITY]: brotli.quality,
        [constants.BROTLI_PARAM_LGWIN]: brotli.window,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
    } });
    requireFormat(brotliDecompressSync(compressed).equals(bytes), 'Brotli round trip failed');
    return {
        rawBytes: bytes.length,
        brotliBytes: compressed.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}

export function measureImage(image) {
    const { records, ...metadata } = getRuntimeFunctionTable(image);
    return {
        ...metadata,
        recordCount: records.length / recordSize,
        wholeImage: measureBytes(image),
        runtimeFunctionTable: measureBytes(records),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const paths = process.argv.slice(2);
    if (paths.length === 0) {
        console.error('Usage: node measure.mjs IMAGE.wasm [IMAGE.wasm ...]');
        process.exitCode = 2;
    } else {
        try {
            const images = paths.map((path) => {
                try {
                    return { path, ...measureImage(readFileSync(path)) };
                } catch (error) {
                    throw new Error(`${path}: ${error.message}`, { cause: error });
                }
            });
            console.log(JSON.stringify({
                nodeVersion: process.version,
                brotliVersion: process.versions.brotli,
                platform: platform(),
                architecture: arch(),
                brotli,
                images,
            }, null, 2));
        } catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
}
