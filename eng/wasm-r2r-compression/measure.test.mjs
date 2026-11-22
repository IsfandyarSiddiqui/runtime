// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRuntimeFunctionTable, measureImage } from './measure.mjs';

const records = Buffer.from('12000080000001001400008008000100', 'hex');

function fixture() {
    const sectionOffset = 48;
    const sectionRva = 0x1000;
    const native = sectionOffset + 72;
    const table = native + 28;
    const image = Buffer.alloc(table + records.length + 8);
    image.write('WbIL');
    image.writeUInt16LE(1, 4); // Webcil major version
    image.writeUInt16LE(1, 8); // Webcil section count
    image.writeUInt32LE(sectionRva, 12); // CLI header RVA
    image.writeUInt32LE(72, 16); // CLI header size
    image.writeUInt32LE(image.length - sectionOffset, 32); // virtual size
    image.writeUInt32LE(sectionRva, 36);
    image.writeUInt32LE(image.length - sectionOffset, 40); // raw size
    image.writeUInt32LE(sectionOffset, 44);
    image.writeUInt32LE(sectionRva + 72, sectionOffset + 64); // native header RVA
    image.writeUInt32LE(28, sectionOffset + 68);
    image.writeUInt32LE(0x00525452, native);
    image.writeUInt16LE(26, native + 4);
    image.writeUInt16LE(1, native + 6);
    image.writeUInt32LE(1, native + 12); // R2R section count
    image.writeUInt32LE(102, native + 16); // RuntimeFunctions
    image.writeUInt32LE(sectionRva + 100, native + 20);
    image.writeUInt32LE(records.length, native + 24);
    records.copy(image, table);
    image.writeUInt32LE(0xffffffff, table + records.length);
    image.writeUInt32LE(9, table + records.length + 4);
    return image;
}

function wrapWasm(webcil) {
    function uleb(value) {
        return value < 128 ? [value] : [(value & 0x7f) | 0x80, ...uleb(value >>> 7)];
    }
    const data = Buffer.concat([Buffer.from([2, 1, 8]), Buffer.alloc(8), Buffer.from([1, ...uleb(webcil.length)]), webcil]);
    return Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 11, ...uleb(data.length)]), data]);
}

test('extracts only the records from raw and wrapped Webcil', () => {
    const webcil = fixture();
    for (const image of [webcil, wrapWasm(webcil)]) {
        const table = getRuntimeFunctionTable(image);
        assert.deepEqual(table.records, records);
        assert.equal(table.minimumFunctionTableIndex, 9);
        assert.equal(table.readyToRunVersion, '26.1');
        const sizes = measureImage(image);
        assert.equal(sizes.wholeImage.rawBytes, image.length);
        assert.equal(sizes.runtimeFunctionTable.rawBytes, records.length);
        assert.equal(sizes.recordCount, 2);
    }
});

test('rejects an invalid sentinel or truncated payload', () => {
    const image = fixture();
    image.writeUInt32LE(0, image.length - 8);
    assert.throws(() => getRuntimeFunctionTable(image), /sentinel/);
    assert.throws(() => getRuntimeFunctionTable(image.subarray(0, -1)), /Truncated/);
    assert.throws(() => getRuntimeFunctionTable(wrapWasm(image).subarray(0, -1)), /Truncated/);
});
