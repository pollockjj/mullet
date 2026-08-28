import { parseCharacterCardJson, type ImportedCharacterCard } from './character-card.ts';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const MAX_CHARACTER_CARD_PNG_BYTES = 25 * 1024 * 1024;
const latin1Decoder = new TextDecoder('latin1');

function decodeBase64Utf8(encoded: string): string {
  let binary: string;
  try {
    binary = atob(encoded.trim());
  } catch {
    throw new Error('character card PNG metadata is not valid base64');
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('character card PNG metadata is not valid UTF-8');
  }
}

function readChunkLength(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

export function extractPngCharacterCard(input: ArrayBuffer | Uint8Array): ImportedCharacterCard {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_CHARACTER_CARD_PNG_BYTES) {
    throw new Error(`character card PNG exceeds ${MAX_CHARACTER_CARD_PNG_BYTES / 1024 / 1024} MB`);
  }
  if (bytes.byteLength < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error('character card file is not a PNG');
  }

  let offset = PNG_SIGNATURE.length;
  let v2Payload = '';
  let v3Payload = '';

  while (offset + 12 <= bytes.byteLength) {
    const length = readChunkLength(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > bytes.byteLength) throw new Error('character card PNG has a malformed chunk');

    const type = latin1Decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0) {
        const keyword = latin1Decoder.decode(data.subarray(0, separator)).toLowerCase();
        const payload = latin1Decoder.decode(data.subarray(separator + 1));
        if (keyword === 'ccv3' && !v3Payload) v3Payload = payload;
        if (keyword === 'chara' && !v2Payload) v2Payload = payload;
      }
    }

    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  const payload = v3Payload || v2Payload;
  if (!payload) throw new Error('PNG does not contain ccv3 or chara character-card metadata');
  return parseCharacterCardJson(decodeBase64Utf8(payload));
}
