import { deflateSync } from 'node:zlib';

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = new Uint8Array()) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.from(data);
  const result = Buffer.alloc(12 + payload.byteLength);
  result.writeUInt32BE(payload.byteLength, 0);
  typeBytes.copy(result, 4);
  payload.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + payload.byteLength)), 8 + payload.byteLength);
  return result;
}

export function buildPngFixture(width = 576, height = 1024, marker = 0, options = {}) {
  if (!Number.isSafeInteger(width) || width < 1 || width > 8192
    || !Number.isSafeInteger(height) || height < 1 || height > 8192) {
    throw new Error('PNG fixture dimensions are invalid');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = options.interlace ?? 0;

  const stride = width + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) pixels[row * stride] = 0;
  pixels[1] = marker & 0xff;

  return new Uint8Array(Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND')
  ]));
}

export function pngWithoutIdat(bytes) {
  const source = Buffer.from(bytes);
  const idatOffset = 33;
  const idatLength = source.readUInt32BE(idatOffset);
  const iendOffset = idatOffset + 12 + idatLength;
  if (source.toString('ascii', idatOffset + 4, idatOffset + 8) !== 'IDAT'
    || source.toString('ascii', iendOffset + 4, iendOffset + 8) !== 'IEND') {
    throw new Error('PNG fixture does not have the expected chunk layout');
  }
  return new Uint8Array(Buffer.concat([source.subarray(0, idatOffset), source.subarray(iendOffset)]));
}

export function pngWithReplacementIdat(bytes, replacement) {
  const source = Buffer.from(bytes);
  const idatOffset = 33;
  const idatLength = source.readUInt32BE(idatOffset);
  const iendOffset = idatOffset + 12 + idatLength;
  if (source.toString('ascii', idatOffset + 4, idatOffset + 8) !== 'IDAT'
    || source.toString('ascii', iendOffset + 4, iendOffset + 8) !== 'IEND') {
    throw new Error('PNG fixture does not have the expected chunk layout');
  }
  return new Uint8Array(Buffer.concat([
    source.subarray(0, idatOffset),
    chunk('IDAT', replacement),
    source.subarray(iendOffset)
  ]));
}
