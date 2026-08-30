function concat(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function id(value) {
  const bytes = [];
  let current = value;
  while (current > 0) {
    bytes.unshift(current & 0xff);
    current = Math.floor(current / 256);
  }
  return Uint8Array.from(bytes);
}

function size(value) {
  for (let length = 1; length <= 4; length += 1) {
    if (value < 2 ** (7 * length) - 1) {
      const result = new Uint8Array(length);
      let current = value;
      for (let index = length - 1; index >= 0; index -= 1) {
        result[index] = current & 0xff;
        current = Math.floor(current / 256);
      }
      result[0] |= 1 << (8 - length);
      return result;
    }
  }
  throw new Error('fixture element is too large');
}

function element(identifier, payload) {
  return concat([id(identifier), size(payload.byteLength), payload]);
}

function unsigned(value, length) {
  const result = new Uint8Array(length);
  let current = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = current & 0xff;
    current = Math.floor(current / 256);
  }
  return result;
}

function float64(value) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setFloat64(0, value, false);
  return result;
}

function string(value) {
  return new TextEncoder().encode(value);
}

function block(timestamp, trackNumber = 1) {
  const payload = new Uint8Array(5);
  payload[0] = 0x80 | trackNumber;
  new DataView(payload.buffer).setInt16(1, timestamp, false);
  payload[3] = 0x80;
  payload[4] = 0;
  return element(0xa3, payload);
}

function malformedXiphLacedBlock(frameCount) {
  const payload = new Uint8Array(5);
  payload[0] = 0x81;
  new DataView(payload.buffer).setInt16(1, 0, false);
  payload[3] = 0x82;
  payload[4] = frameCount - 1;
  return element(0xa3, payload);
}

export function buildVp9WebmFixture({
  width = 1024,
  height = 576,
  frames = 49,
  fps = 24,
  durationUnits = Math.round(frames * 1000 / fps),
  timestamps = Array.from({ length: frames }, (_, index) => Math.round(index * 1000 / fps)),
  malformedXiphLacing = false,
  includeAudio = false
} = {}) {
  const ebml = element(0x1a45dfa3, element(0x4282, string('webm')));
  const info = element(0x1549a966, concat([
    element(0x2ad7b1, unsigned(1_000_000, 3)),
    element(0x4489, float64(durationUnits))
  ]));
  const video = element(0xe0, concat([
    element(0xb0, unsigned(width, 2)),
    element(0xba, unsigned(height, 2))
  ]));
  const track = element(0xae, concat([
    element(0xd7, unsigned(1, 1)),
    element(0x83, unsigned(1, 1)),
    element(0x86, string('V_VP9')),
    element(0x23e383, unsigned(Math.floor(1_000_000_000 / fps), 4)),
    video
  ]));
  const audioTrack = element(0xae, concat([
    element(0xd7, unsigned(2, 1)),
    element(0x83, unsigned(2, 1)),
    element(0x86, string('A_OPUS')),
    element(0xe1, concat([
      element(0xb5, float64(48_000)),
      element(0x9f, unsigned(2, 1))
    ]))
  ]));
  const tracks = element(0x1654ae6b, concat([track, ...(includeAudio ? [audioTrack] : [])]));
  const cluster = element(0x1f43b675, concat([
    element(0xe7, unsigned(0, 1)),
    ...(malformedXiphLacing
      ? [malformedXiphLacedBlock(frames)]
      : timestamps.map((timestamp) => block(timestamp))),
    ...(includeAudio ? [block(0, 2)] : [])
  ]));
  return element(0x18538067, concat([info, tracks, cluster]))
    .reduce((parts, byte, index, source) => {
      if (index === 0) return concat([ebml, source]);
      return parts;
    }, new Uint8Array());
}
