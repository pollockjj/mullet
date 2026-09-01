import type { PortraitReferenceImage } from '../portrait.ts';
import { assertComfyIdentityReference } from './comfy-portrait.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const REFERENCE_IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ASPECT_RATIO_PATTERN = /^[1-9]\d{0,3}:[1-9]\d{0,3}$/;
const MANAGED_REFERENCE_NAME_PATTERN = /^body-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{8})-([0-9a-f]{64})\.png$/;
const MANAGED_REFERENCE_WIDTH = 576;
const MANAGED_REFERENCE_HEIGHT = 1024;
const MANAGED_REFERENCE_ASPECT_RATIO = '9:16';
const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UNAVAILABLE_MESSAGE = 'ComfyUI identity reference is unavailable';

const CRC32_TABLE = (() => {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function assertReferenceMetadata(reference: PortraitReferenceImage): void {
  if (!isRecord(reference)
    || typeof reference.name !== 'string'
    || !REFERENCE_IMAGE_PATTERN.test(reference.name)
    || reference.subfolder !== 'mullet/identity'
    || reference.type !== 'input'
    || typeof reference.sha256 !== 'string'
    || !SHA256_PATTERN.test(reference.sha256)
    || !Number.isSafeInteger(reference.width)
    || reference.width < 1
    || reference.width > 8192
    || !Number.isSafeInteger(reference.height)
    || reference.height < 1
    || reference.height > 8192
    || typeof reference.aspectRatio !== 'string'
    || !ASPECT_RATIO_PATTERN.test(reference.aspectRatio)) {
    throw new Error('managed identity reference metadata is invalid');
  }
  const divisor = greatestCommonDivisor(reference.width, reference.height);
  if (reference.aspectRatio !== `${reference.width / divisor}:${reference.height / divisor}`) {
    throw new Error('managed identity reference aspect ratio does not match its dimensions');
  }
}

function sameReference(left: PortraitReferenceImage, right: PortraitReferenceImage): boolean {
  return left.name === right.name
    && left.subfolder === right.subfolder
    && left.type === right.type
    && left.sha256 === right.sha256
    && left.width === right.width
    && left.height === right.height
    && left.aspectRatio === right.aspectRatio;
}

function uniqueReferences(requested: readonly PortraitReferenceImage[]): PortraitReferenceImage[] {
  if (!Array.isArray(requested)) throw new Error('managed identity references must be an array');
  const bySha = new Map<string, PortraitReferenceImage>();
  const byName = new Map<string, PortraitReferenceImage>();
  for (const reference of requested) {
    assertReferenceMetadata(reference);
    const existingSha = bySha.get(reference.sha256);
    if (existingSha) {
      if (!sameReference(existingSha, reference)) {
        throw new Error('managed identity reference hash has conflicting metadata');
      }
      continue;
    }
    const existingName = byName.get(reference.name);
    if (existingName && existingName.sha256 !== reference.sha256) {
      throw new Error('managed identity reference path has conflicting hashes');
    }
    bySha.set(reference.sha256, reference);
    byName.set(reference.name, reference);
  }
  return [...bySha.values()];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  const values = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  if (values.some((value) => !(
    (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a)
  ))) throw new Error('managed identity reference attachment has an invalid PNG chunk type');
  return String.fromCharCode(...values);
}

function validPngBitDepth(bitDepth: number, colorType: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (colorType === 2) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return [1, 2, 4, 8].includes(bitDepth);
  if (colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

async function inflateManagedPngScanlines(
  compressed: Uint8Array,
  expectedBytes: number
): Promise<Uint8Array> {
  const reader = new Blob([compressed.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (total + result.value.byteLength > expectedBytes) {
        exceeded = true;
        try {
          await reader.cancel('managed PNG decompression exceeded its exact scanline size');
        } catch {
          // The size failure below remains authoritative even if cancellation races decompression.
        }
        break;
      }
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  } catch {
    throw new Error('managed identity reference attachment PNG has invalid compressed image data');
  } finally {
    reader.releaseLock();
  }
  if (exceeded || total !== expectedBytes) {
    throw new Error('managed identity reference attachment PNG scanline length is invalid');
  }
  const scanlines = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    scanlines.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return scanlines;
}

async function validateCompleteManagedPng(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength < 45 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('managed identity reference attachment has an invalid PNG signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let chunks = 0;
  let bitDepth = -1;
  let colorType = -1;
  let paletteSeen = false;
  let idatSeen = false;
  let idatEnded = false;
  let idatBytes = 0;
  const idatParts: Uint8Array[] = [];
  let iendSeen = false;

  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) {
      throw new Error('managed identity reference attachment has a truncated PNG chunk');
    }
    const length = view.getUint32(offset, false);
    if (length > 0x7fffffff || length > bytes.byteLength - offset - 12) {
      throw new Error('managed identity reference attachment has a truncated PNG chunk');
    }
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    const type = pngChunkType(bytes, typeOffset);
    if (view.getUint32(crcOffset, false) !== crc32(bytes, typeOffset, crcOffset)) {
      throw new Error(`managed identity reference attachment PNG ${type} CRC is invalid`);
    }

    if (chunks === 0) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error('managed identity reference attachment PNG must begin with one IHDR');
      }
      const width = view.getUint32(dataOffset, false);
      const height = view.getUint32(dataOffset + 4, false);
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      if (
        width !== MANAGED_REFERENCE_WIDTH
        || height !== MANAGED_REFERENCE_HEIGHT
        || !validPngBitDepth(bitDepth, colorType)
        || bytes[dataOffset + 10] !== 0
        || bytes[dataOffset + 11] !== 0
        || bytes[dataOffset + 12] !== 0
      ) throw new Error('managed identity reference attachment PNG has an invalid IHDR');
    } else if (type === 'IHDR') {
      throw new Error('managed identity reference attachment PNG contains multiple IHDR chunks');
    } else if (type === 'PLTE') {
      if (
        idatSeen
        || paletteSeen
        || length < 3
        || length > 768
        || length % 3 !== 0
        || colorType === 0
        || colorType === 4
      ) throw new Error('managed identity reference attachment PNG has an invalid PLTE');
      paletteSeen = true;
    } else if (type === 'IDAT') {
      if (idatEnded || (colorType === 3 && !paletteSeen)) {
        throw new Error('managed identity reference attachment PNG has invalid IDAT ordering');
      }
      idatSeen = true;
      idatBytes += length;
      idatParts.push(bytes.slice(dataOffset, dataOffset + length));
    } else if (type === 'IEND') {
      if (length !== 0 || !idatSeen || idatBytes === 0 || nextOffset !== bytes.byteLength) {
        throw new Error('managed identity reference attachment PNG has an invalid terminal IEND');
      }
      iendSeen = true;
      offset = nextOffset;
      break;
    } else {
      if (idatSeen) idatEnded = true;
      if (bytes[typeOffset] >= 0x41 && bytes[typeOffset] <= 0x5a) {
        throw new Error(`managed identity reference attachment PNG has unsupported critical chunk ${type}`);
      }
    }
    chunks += 1;
    offset = nextOffset;
  }
  if (!iendSeen || offset !== bytes.byteLength) {
    throw new Error('managed identity reference attachment PNG is incomplete');
  }

  const channels = colorType === 0 || colorType === 3 ? 1
    : colorType === 2 ? 3
      : colorType === 4 ? 2
        : colorType === 6 ? 4
          : 0;
  const rowBytes = Math.ceil((MANAGED_REFERENCE_WIDTH * channels * bitDepth) / 8);
  const expectedBytes = (rowBytes + 1) * MANAGED_REFERENCE_HEIGHT;
  const compressed = new Uint8Array(idatBytes);
  let compressedOffset = 0;
  for (const part of idatParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.byteLength;
  }
  const scanlines = await inflateManagedPngScanlines(compressed, expectedBytes);
  for (let row = 0; row < MANAGED_REFERENCE_HEIGHT; row += 1) {
    if (scanlines[row * (rowBytes + 1)] > 4) {
      throw new Error('managed identity reference attachment PNG has an invalid scanline filter');
    }
  }
}

function validateAttachedReferenceMetadata(reference: PortraitReferenceImage, digest: string): void {
  const name = MANAGED_REFERENCE_NAME_PATTERN.exec(reference.name);
  if (!name || name[1].length > 100) {
    throw new Error('managed identity reference attachment target name is not content-addressed');
  }
  if (name[3] !== reference.sha256 || name[3] !== digest) {
    throw new Error('managed identity reference attachment target name does not match its SHA-256');
  }
  if (
    reference.width !== MANAGED_REFERENCE_WIDTH
    || reference.height !== MANAGED_REFERENCE_HEIGHT
    || reference.aspectRatio !== MANAGED_REFERENCE_ASPECT_RATIO
  ) throw new Error('managed identity reference attachment metadata must be exactly 576x1024 (9:16)');
}

async function validatedAttachments(
  attachments: readonly Blob[],
  references: readonly PortraitReferenceImage[]
): Promise<Map<string, Uint8Array>> {
  if (!Array.isArray(attachments)) throw new Error('managed identity reference attachments must be an array');
  const requestedBySha = new Map(references.map((reference) => [reference.sha256, reference]));
  const bySha = new Map<string, Uint8Array>();
  for (const attachment of attachments) {
    if (!(attachment instanceof Blob)) throw new Error('managed identity reference attachment must be a Blob');
    if (attachment.size < 33 || attachment.size > MAX_REFERENCE_BYTES) {
      throw new Error('managed identity reference attachment has an invalid size');
    }
    if (attachment.type !== '' && attachment.type.toLowerCase() !== 'image/png') {
      throw new Error('managed identity reference attachment must have PNG media type');
    }
    const bytes = new Uint8Array(await attachment.arrayBuffer());
    const digest = await sha256(bytes);
    const reference = requestedBySha.get(digest);
    if (!reference) throw new Error('managed identity reference attachment was not requested');
    if (bySha.has(digest)) throw new Error('managed identity reference attachment is duplicated');
    validateAttachedReferenceMetadata(reference, digest);
    await validateCompleteManagedPng(bytes);
    bySha.set(digest, bytes);
  }
  return bySha;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === UNAVAILABLE_MESSAGE;
}

async function uploadManagedReference(
  fetcher: Fetcher,
  baseUrl: string,
  reference: PortraitReferenceImage,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData();
  form.append('image', new Blob([bytes.slice().buffer], { type: 'image/png' }), reference.name);
  form.append('subfolder', reference.subfolder);
  form.append('type', reference.type);
  form.append('overwrite', 'false');
  const response = await fetcher(endpoint(baseUrl, '/upload/image'), {
    method: 'POST',
    body: form,
    signal
  });
  if (!response.ok) throw new Error(`ComfyUI managed identity reference upload failed (${response.status})`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('ComfyUI returned an invalid managed identity reference upload response');
  }
  if (!isRecord(body)
    || body.name !== reference.name
    || body.subfolder !== reference.subfolder
    || body.type !== reference.type) {
    throw new Error('ComfyUI returned an unexpected managed identity reference upload location');
  }
}

/**
 * Ensures the requested identity references are resident without overwriting any ComfyUI input.
 * Attachments are matched to requested references by SHA-256, so a Blob filename is not trusted.
 */
export async function ensureComfyManagedReferences(
  fetcher: Fetcher,
  baseUrl: string,
  requested: readonly PortraitReferenceImage[],
  attachments: readonly Blob[],
  signal?: AbortSignal
): Promise<void> {
  const references = uniqueReferences(requested);
  const attachmentBytes = await validatedAttachments(attachments, references);

  for (const reference of references) {
    try {
      await assertComfyIdentityReference(fetcher, baseUrl, reference, signal);
      continue;
    } catch (error) {
      if (!isUnavailable(error)) throw error;
    }

    const bytes = attachmentBytes.get(reference.sha256);
    if (!bytes) throw new Error(`managed identity reference is unavailable: ${reference.name}`);
    await uploadManagedReference(fetcher, baseUrl, reference, bytes, signal);
    await assertComfyIdentityReference(fetcher, baseUrl, reference, signal);
  }
}
