import { normalizeLorebook, type ImportedLorebook, type LorebookOrigin } from './lorebook.ts';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const latin1Decoder = new TextDecoder('latin1');
export const MAX_LOREBOOK_PNG_BYTES = 25 * 1024 * 1024;

function readChunkLength(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function decodeBase64Json(encoded: string): unknown {
  let binary: string;
  try {
    binary = atob(encoded.trim());
  } catch {
    throw new Error('lorebook PNG naidata is not valid base64');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('lorebook PNG naidata is not valid UTF-8');
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('lorebook PNG naidata is not valid JSON');
  }
}

export function extractPngLorebook(
  input: ArrayBuffer | Uint8Array,
  fallbackName = 'Imported lorebook',
  origin: LorebookOrigin = 'imported'
): ImportedLorebook {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_LOREBOOK_PNG_BYTES) throw new Error('lorebook PNG exceeds 25 MB');
  if (bytes.byteLength < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error('lorebook file is not a PNG');
  }

  let offset = PNG_SIGNATURE.length;
  let payload = '';
  while (offset + 12 <= bytes.byteLength) {
    const length = readChunkLength(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.byteLength) throw new Error('lorebook PNG has a malformed chunk');
    const type = latin1Decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0 && latin1Decoder.decode(data.subarray(0, separator)).toLowerCase() === 'naidata') {
        payload = latin1Decoder.decode(data.subarray(separator + 1));
        break;
      }
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  if (!payload) throw new Error('PNG does not contain naidata lorebook metadata');
  return normalizeLorebook(decodeBase64Json(payload), fallbackName, origin);
}
