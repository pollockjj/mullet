export type WebmVideoMetadata = {
  codecId: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  containerDurationSeconds: number;
};

export type ExpectedWebmVideo = {
  width: number;
  height: number;
  frames: number;
  fps: number;
};

type Element = {
  id: number;
  dataStart: number;
  dataEnd: number;
};

type BlockMetadata = {
  trackNumber: number;
  frameCount: number;
  relativeTimestamp: number;
};

type ParseBudget = {
  remainingElements: number;
};

const EBML_ID = 0x1a45dfa3;
const DOC_TYPE_ID = 0x4282;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
const TRACKS_ID = 0x1654ae6b;
const TRACK_ENTRY_ID = 0xae;
const TRACK_NUMBER_ID = 0xd7;
const TRACK_TYPE_ID = 0x83;
const CODEC_ID = 0x86;
const DEFAULT_DURATION_ID = 0x23e383;
const VIDEO_ID = 0xe0;
const PIXEL_WIDTH_ID = 0xb0;
const PIXEL_HEIGHT_ID = 0xba;
const CLUSTER_ID = 0x1f43b675;
const CLUSTER_TIMESTAMP_ID = 0xe7;
const SIMPLE_BLOCK_ID = 0xa3;
const BLOCK_GROUP_ID = 0xa0;
const BLOCK_ID = 0xa1;
const MINIMUM_ELEMENT_BUDGET = 4_096;
const MAXIMUM_ELEMENT_BUDGET = 200_000;

function safeInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(name + ' is invalid');
  return value;
}

function readVint(
  bytes: Uint8Array,
  offset: number,
  stripMarker: boolean,
  maximumLength: number
): { length: number; value: bigint; unknown: boolean } {
  if (offset < 0 || offset >= bytes.byteLength) throw new Error('WebM contains a truncated variable integer');
  const first = bytes[offset];
  let length = 1;
  let marker = 0x80;
  while (length <= maximumLength && (first & marker) === 0) {
    length += 1;
    marker >>= 1;
  }
  if (length > maximumLength || marker === 0 || offset + length > bytes.byteLength) {
    throw new Error('WebM contains an invalid variable integer');
  }
  let value = BigInt(stripMarker ? first & (marker - 1) : first);
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  const unknown = stripMarker && value === (1n << BigInt(7 * length)) - 1n;
  return { length, value, unknown };
}

function elements(bytes: Uint8Array, start: number, end: number, budget: ParseBudget): Element[] {
  const result: Element[] = [];
  let offset = start;
  while (offset < end) {
    if (budget.remainingElements < 1) throw new Error('WebM structural element count exceeds the parser limit');
    budget.remainingElements -= 1;
    const id = readVint(bytes, offset, false, 4);
    const size = readVint(bytes, offset + id.length, true, 8);
    if (id.value > BigInt(Number.MAX_SAFE_INTEGER) || size.value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebM element exceeds the safe parser range');
    }
    const numericId = Number(id.value);
    const dataStart = offset + id.length + size.length;
    if (size.unknown && numericId !== SEGMENT_ID && numericId !== CLUSTER_ID) {
      throw new Error('WebM contains an unexpected unknown-size element');
    }
    const dataEnd = size.unknown ? end : dataStart + Number(size.value);
    if (dataStart > end || dataEnd < dataStart || dataEnd > end) throw new Error('WebM element exceeds its parent');
    result.push({ id: numericId, dataStart, dataEnd });
    offset = dataEnd;
  }
  if (offset !== end) throw new Error('WebM element boundaries are invalid');
  return result;
}

function exactlyOne(entries: readonly Element[], id: number, name: string): Element {
  const matching = entries.filter((entry) => entry.id === id);
  if (matching.length !== 1) throw new Error('WebM must contain exactly one ' + name);
  return matching[0];
}

function unsignedInteger(bytes: Uint8Array, element: Element, name: string): number {
  const length = element.dataEnd - element.dataStart;
  if (length < 1 || length > 8) throw new Error('WebM ' + name + ' is invalid');
  let value = 0n;
  for (let offset = element.dataStart; offset < element.dataEnd; offset += 1) {
    value = (value << 8n) | BigInt(bytes[offset]);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebM ' + name + ' exceeds the safe parser range');
  return Number(value);
}

function floatingPoint(bytes: Uint8Array, element: Element, name: string): number {
  const length = element.dataEnd - element.dataStart;
  const view = new DataView(bytes.buffer, bytes.byteOffset + element.dataStart, length);
  const value = length === 4
    ? view.getFloat32(0, false)
    : length === 8
      ? view.getFloat64(0, false)
      : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) throw new Error('WebM ' + name + ' is invalid');
  return value;
}

function text(bytes: Uint8Array, element: Element): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(element.dataStart, element.dataEnd));
}

function signedInt16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new Error('WebM block timestamp is truncated');
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getInt16(0, false);
}

function validateLacing(
  bytes: Uint8Array,
  start: number,
  end: number,
  lacing: number,
  frameCount: number
): void {
  let offset = start;
  const sizes: number[] = [];
  if (lacing === 1) {
    for (let frame = 0; frame < frameCount - 1; frame += 1) {
      let size = 0;
      let part = 255;
      while (part === 255) {
        if (offset >= end) throw new Error('WebM Xiph lacing is truncated');
        part = bytes[offset];
        offset += 1;
        size += part;
        if (!Number.isSafeInteger(size)) throw new Error('WebM Xiph lace size is invalid');
      }
      sizes.push(size);
    }
  } else if (lacing === 2) {
    const payloadLength = end - offset;
    if (payloadLength < frameCount || payloadLength % frameCount !== 0) {
      throw new Error('WebM fixed lacing payload is invalid');
    }
    sizes.push(...Array.from({ length: frameCount - 1 }, () => payloadLength / frameCount));
  } else if (lacing === 3) {
    const first = readVint(bytes, offset, true, 8);
    if (first.unknown || first.value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebM EBML lace size is invalid');
    }
    offset += first.length;
    sizes.push(Number(first.value));
    for (let frame = 1; frame < frameCount - 1; frame += 1) {
      const encoded = readVint(bytes, offset, true, 8);
      if (encoded.unknown) throw new Error('WebM EBML lace delta is invalid');
      offset += encoded.length;
      const bias = (1n << BigInt(7 * encoded.length - 1)) - 1n;
      const nextSize = BigInt(sizes[frame - 1]) + encoded.value - bias;
      if (nextSize < 1n || nextSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('WebM EBML lace size is invalid');
      }
      sizes.push(Number(nextSize));
    }
  } else {
    throw new Error('WebM block lacing mode is invalid');
  }
  const declaredPayload = sizes.reduce((total, size) => total + size, 0);
  const finalSize = end - offset - declaredPayload;
  if (sizes.some((size) => size < 1) || finalSize < 1) {
    throw new Error('WebM lacing frame payload is invalid');
  }
}

function blockMetadata(bytes: Uint8Array, element: Element): BlockMetadata {
  const track = readVint(bytes, element.dataStart, true, 8);
  if (track.unknown || track.value < 1n || track.value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('WebM block track is invalid');
  }
  const timestampOffset = element.dataStart + track.length;
  const flagsOffset = timestampOffset + 2;
  if (flagsOffset >= element.dataEnd) throw new Error('WebM block is truncated');
  const flags = bytes[flagsOffset];
  const lacing = (flags & 0x06) >> 1;
  let frameCount = 1;
  const payloadStart = flagsOffset + 1;
  if (lacing === 0) {
    if (payloadStart >= element.dataEnd) throw new Error('WebM block frame payload is truncated');
  } else {
    if (payloadStart >= element.dataEnd) throw new Error('WebM laced block is truncated');
    frameCount = bytes[payloadStart] + 1;
    validateLacing(bytes, payloadStart + 1, element.dataEnd, lacing, frameCount);
  }
  return {
    trackNumber: Number(track.value),
    frameCount,
    relativeTimestamp: signedInt16(bytes, timestampOffset)
  };
}

function clusterBlocks(
  bytes: Uint8Array,
  cluster: Element,
  budget: ParseBudget
): Array<BlockMetadata & { clusterTimestamp: number }> {
  const children = elements(bytes, cluster.dataStart, cluster.dataEnd, budget);
  const timestampElement = exactlyOne(children, CLUSTER_TIMESTAMP_ID, 'cluster timestamp');
  const clusterTimestamp = unsignedInteger(bytes, timestampElement, 'cluster timestamp');
  const blocks: Array<BlockMetadata & { clusterTimestamp: number }> = [];
  for (const child of children) {
    if (child.id === SIMPLE_BLOCK_ID) {
      blocks.push({ ...blockMetadata(bytes, child), clusterTimestamp });
    } else if (child.id === BLOCK_GROUP_ID) {
      const group = elements(bytes, child.dataStart, child.dataEnd, budget);
      const block = exactlyOne(group, BLOCK_ID, 'block-group block');
      blocks.push({ ...blockMetadata(bytes, block), clusterTimestamp });
    }
  }
  return blocks;
}

export function validateVp9Webm(
  bytes: Uint8Array,
  expected: ExpectedWebmVideo
): WebmVideoMetadata {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) throw new Error('WebM is truncated');
  const expectedWidth = safeInteger(expected.width, 'expected WebM width', 1, 16_384);
  const expectedHeight = safeInteger(expected.height, 'expected WebM height', 1, 16_384);
  const expectedFrames = safeInteger(expected.frames, 'expected WebM frame count', 1, 100_000);
  const expectedFps = safeInteger(expected.fps, 'expected WebM frame rate', 1, 1_000);
  const budget: ParseBudget = {
    remainingElements: Math.min(
      MAXIMUM_ELEMENT_BUDGET,
      Math.max(MINIMUM_ELEMENT_BUDGET, expectedFrames * 4 + 1_024)
    )
  };
  const root = elements(bytes, 0, bytes.byteLength, budget);
  const ebml = exactlyOne(root, EBML_ID, 'EBML header');
  const segment = exactlyOne(root, SEGMENT_ID, 'segment');
  const ebmlChildren = elements(bytes, ebml.dataStart, ebml.dataEnd, budget);
  if (text(bytes, exactlyOne(ebmlChildren, DOC_TYPE_ID, 'EBML document type')) !== 'webm') {
    throw new Error('EBML document type is not WebM');
  }
  const segmentChildren = elements(bytes, segment.dataStart, segment.dataEnd, budget);
  const infoElement = exactlyOne(segmentChildren, INFO_ID, 'segment info');
  const infoChildren = elements(
    bytes,
    infoElement.dataStart,
    infoElement.dataEnd,
    budget
  );
  const timecodeScale = unsignedInteger(
    bytes,
    exactlyOne(infoChildren, TIMECODE_SCALE_ID, 'timecode scale'),
    'timecode scale'
  );
  if (timecodeScale < 1 || timecodeScale > 1_000_000_000) throw new Error('WebM timecode scale is invalid');
  const durationUnits = floatingPoint(bytes, exactlyOne(infoChildren, DURATION_ID, 'duration'), 'duration');
  const tracksElement = exactlyOne(segmentChildren, TRACKS_ID, 'tracks');
  const trackEntries = elements(bytes, tracksElement.dataStart, tracksElement.dataEnd, budget)
    .filter((entry) => entry.id === TRACK_ENTRY_ID);
  const parsedTracks = trackEntries.map((entry) => {
    const children = elements(bytes, entry.dataStart, entry.dataEnd, budget);
    const trackType = unsignedInteger(bytes, exactlyOne(children, TRACK_TYPE_ID, 'track type'), 'track type');
    return { children, trackType };
  });
  if (parsedTracks.some(({ trackType }) => trackType !== 1)) {
    throw new Error('WebM must not contain audio or extra non-video media tracks');
  }
  const videoTracks = parsedTracks.map(({ children }) => {
    const video = exactlyOne(children, VIDEO_ID, 'video settings');
    const videoChildren = elements(bytes, video.dataStart, video.dataEnd, budget);
    return {
      trackNumber: unsignedInteger(bytes, exactlyOne(children, TRACK_NUMBER_ID, 'track number'), 'track number'),
      codecId: text(bytes, exactlyOne(children, CODEC_ID, 'video codec')),
      defaultDuration: unsignedInteger(
        bytes,
        exactlyOne(children, DEFAULT_DURATION_ID, 'video default duration'),
        'video default duration'
      ),
      width: unsignedInteger(bytes, exactlyOne(videoChildren, PIXEL_WIDTH_ID, 'pixel width'), 'pixel width'),
      height: unsignedInteger(bytes, exactlyOne(videoChildren, PIXEL_HEIGHT_ID, 'pixel height'), 'pixel height')
    };
  });
  if (videoTracks.length !== 1) throw new Error('WebM must contain exactly one video track');
  const videoTrack = videoTracks[0];
  if (videoTrack.codecId !== 'V_VP9') throw new Error('WebM video codec is not VP9');
  if (videoTrack.width !== expectedWidth || videoTrack.height !== expectedHeight) {
    throw new Error('WebM video dimensions do not match the request');
  }
  const expectedDefaultDuration = Math.floor(1_000_000_000 / expectedFps);
  if (Math.abs(videoTrack.defaultDuration - expectedDefaultDuration) > 1) {
    throw new Error('WebM video frame rate does not match the request');
  }
  const clusters = segmentChildren.filter((entry) => entry.id === CLUSTER_ID);
  if (clusters.length < 1) throw new Error('WebM contains no clusters');
  const videoBlocks = clusters
    .flatMap((cluster) => clusterBlocks(bytes, cluster, budget))
    .filter((block) => block.trackNumber === videoTrack.trackNumber);
  const frameCount = videoBlocks.reduce((total, block) => total + block.frameCount, 0);
  if (frameCount !== expectedFrames) throw new Error('WebM frame count does not match the request');
  const frameTimestampsNs = videoBlocks.flatMap((block) => {
    const firstTimestamp = (block.clusterTimestamp + block.relativeTimestamp) * timecodeScale;
    return Array.from(
      { length: block.frameCount },
      (_, frame) => firstTimestamp + frame * videoTrack.defaultDuration
    );
  });
  if (frameTimestampsNs.some((timestamp) => !Number.isSafeInteger(timestamp) || timestamp < 0)) {
    throw new Error('WebM video timestamp is invalid');
  }
  const expectedFrameDurationNs = 1_000_000_000 / expectedFps;
  const timestampToleranceNs = Math.max(timecodeScale, 2);
  for (let frame = 0; frame < frameTimestampsNs.length; frame += 1) {
    const timestamp = frameTimestampsNs[frame];
    if (Math.abs(timestamp - frame * expectedFrameDurationNs) > timestampToleranceNs) {
      throw new Error('WebM video timestamps do not match the request');
    }
    if (
      frame > 0
      && (
        timestamp <= frameTimestampsNs[frame - 1]
        || Math.abs(timestamp - frameTimestampsNs[frame - 1] - expectedFrameDurationNs) > timestampToleranceNs
      )
    ) throw new Error('WebM video cadence does not match the request');
  }
  const containerDurationNs = durationUnits * timecodeScale;
  const expectedContainerDurationNs = expectedFrames * 1_000_000_000 / expectedFps;
  if (Math.abs(containerDurationNs - expectedContainerDurationNs) > timecodeScale * 2) {
    throw new Error('WebM container duration does not match the request');
  }
  return {
    codecId: videoTrack.codecId,
    width: videoTrack.width,
    height: videoTrack.height,
    frameCount,
    fps: expectedFps,
    durationSeconds: (expectedFrames - 1) / expectedFps,
    containerDurationSeconds: containerDurationNs / 1_000_000_000
  };
}
