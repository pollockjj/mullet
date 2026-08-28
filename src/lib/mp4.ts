export type Mp4VideoMetadata = {
  videoCodec: 'avc1' | 'avc3';
  audioCodec: 'mp4a';
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  audioSampleCount: number;
  audioDurationSeconds: number;
  presentationDurationSeconds: number;
};

export type ExpectedMp4Video = {
  width: number;
  height: number;
  frames: number;
  fps: number;
};

type Box = {
  type: string;
  dataStart: number;
  dataEnd: number;
};

type ParseBudget = {
  remainingBoxes: number;
  remainingTableVisits: number;
};

type SampleSizeTable = {
  count: number;
  uniformSize: number;
  entriesStart: number;
};

type SampleToChunkTable = {
  entryCount: number;
  entriesStart: number;
};

type ChunkOffsetTable = {
  count: number;
  entriesStart: number;
  width: 4 | 8;
};

type Track = {
  handler: string;
  codec: string;
  width: number;
  height: number;
  presentationDuration: number;
  timescale: number;
  duration: number;
  sampleCount: number;
  sampleDuration: number;
  sampleSizes: SampleSizeTable | null;
  sampleToChunk: SampleToChunkTable | null;
  chunkOffsets: ChunkOffsetTable | null;
};

const MINIMUM_BOX_BUDGET = 4_096;
const MAXIMUM_BOX_BUDGET = 200_000;
const MAXIMUM_SAMPLE_COUNT = 1_000_000;
const MAXIMUM_TABLE_VISITS = 4_000_000;

function safeInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(name + ' is invalid');
  return value;
}

function safeAdd(left: number, right: number, name: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error('MP4 ' + name + ' exceeds the safe parser range');
  return value;
}

function safeMultiply(left: number, right: number, name: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new Error('MP4 ' + name + ' exceeds the safe parser range');
  return value;
}

function spendTableVisits(budget: ParseBudget, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > budget.remainingTableVisits) {
    throw new Error('MP4 sample-table work exceeds the parser limit');
  }
  budget.remainingTableVisits -= count;
}

function uint32(bytes: Uint8Array, offset: number, name: string): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error('MP4 ' + name + ' is truncated');
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint64(bytes: Uint8Array, offset: number, name: string): number {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new Error('MP4 ' + name + ' is truncated');
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 ' + name + ' exceeds the safe parser range');
  return Number(value);
}

function fourcc(bytes: Uint8Array, offset: number, name: string): string {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error('MP4 ' + name + ' is truncated');
  const value = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (!/^[\x20-\x7e]{4}$/.test(value)) throw new Error('MP4 ' + name + ' is invalid');
  return value;
}

function boxes(bytes: Uint8Array, start: number, end: number, budget: ParseBudget): Box[] {
  const result: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (budget.remainingBoxes < 1) throw new Error('MP4 structural box count exceeds the parser limit');
    budget.remainingBoxes -= 1;
    const compactSize = uint32(bytes, offset, 'box size');
    const type = fourcc(bytes, offset + 4, 'box type');
    let headerSize = 8;
    let size = compactSize;
    if (compactSize === 1) {
      size = uint64(bytes, offset + 8, 'extended box size');
      headerSize = 16;
    } else if (compactSize === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end || !Number.isSafeInteger(offset + size)) {
      throw new Error('MP4 box exceeds its parent');
    }
    result.push({ type, dataStart: offset + headerSize, dataEnd: offset + size });
    offset += size;
  }
  if (offset !== end) throw new Error('MP4 box boundaries are invalid');
  return result;
}

function exactlyOne(entries: readonly Box[], type: string, name: string): Box {
  const matching = entries.filter((entry) => entry.type === type);
  if (matching.length !== 1) throw new Error('MP4 must contain exactly one ' + name);
  return matching[0];
}

function childBoxes(bytes: Uint8Array, parent: Box, budget: ParseBudget): Box[] {
  return boxes(bytes, parent.dataStart, parent.dataEnd, budget);
}

function fullBoxVersion(bytes: Uint8Array, box: Box, name: string): number {
  if (box.dataEnd - box.dataStart < 4) throw new Error('MP4 ' + name + ' is truncated');
  return bytes[box.dataStart];
}

function fullBoxTiming(bytes: Uint8Array, box: Box, name: string): { timescale: number; duration: number } {
  const version = fullBoxVersion(bytes, box, name);
  if (version === 0) {
    return {
      timescale: uint32(bytes, box.dataStart + 12, name + ' timescale'),
      duration: uint32(bytes, box.dataStart + 16, name + ' duration')
    };
  }
  if (version === 1) {
    return {
      timescale: uint32(bytes, box.dataStart + 20, name + ' timescale'),
      duration: uint64(bytes, box.dataStart + 24, name + ' duration')
    };
  }
  throw new Error('MP4 ' + name + ' version is unsupported');
}

function trackHeaderMetadata(
  bytes: Uint8Array,
  tkhd: Box
): { width: number; height: number; presentationDuration: number } {
  const version = fullBoxVersion(bytes, tkhd, 'track header');
  const minimumLength = version === 0 ? 84 : version === 1 ? 96 : 0;
  if (minimumLength === 0 || tkhd.dataEnd - tkhd.dataStart < minimumLength) {
    throw new Error('MP4 track header is invalid');
  }
  const widthFixed = uint32(bytes, tkhd.dataEnd - 8, 'track width');
  const heightFixed = uint32(bytes, tkhd.dataEnd - 4, 'track height');
  if (widthFixed % 65_536 !== 0 || heightFixed % 65_536 !== 0) {
    throw new Error('MP4 track dimensions are not integral');
  }
  const presentationDuration = version === 0
    ? uint32(bytes, tkhd.dataStart + 20, 'track presentation duration')
    : uint64(bytes, tkhd.dataStart + 28, 'track presentation duration');
  if (presentationDuration < 1) throw new Error('MP4 track presentation duration is invalid');
  return { width: widthFixed / 65_536, height: heightFixed / 65_536, presentationDuration };
}

function sampleDescriptionCodec(bytes: Uint8Array, stsd: Box, budget: ParseBudget): string {
  if (stsd.dataEnd - stsd.dataStart < 8) throw new Error('MP4 sample description is truncated');
  const entryCount = uint32(bytes, stsd.dataStart + 4, 'sample-description entry count');
  const entries = boxes(bytes, stsd.dataStart + 8, stsd.dataEnd, budget);
  if (entryCount !== 1 || entries.length !== 1) throw new Error('MP4 must contain exactly one sample description');
  return entries[0].type;
}

function sampleTiming(
  bytes: Uint8Array,
  stts: Box,
  budget: ParseBudget
): { sampleCount: number; sampleDuration: number } {
  if (stts.dataEnd - stts.dataStart < 8) throw new Error('MP4 time-to-sample table is truncated');
  const entryCount = uint32(bytes, stts.dataStart + 4, 'time-to-sample entry count');
  if (
    entryCount < 1
    || entryCount > MAXIMUM_SAMPLE_COUNT
    || stts.dataStart + 8 + entryCount * 8 !== stts.dataEnd
  ) {
    throw new Error('MP4 time-to-sample table is invalid');
  }
  spendTableVisits(budget, entryCount);
  let sampleCount = 0;
  let sampleDuration = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const offset = stts.dataStart + 8 + entry * 8;
    const count = uint32(bytes, offset, 'time-to-sample count');
    const delta = uint32(bytes, offset + 4, 'time-to-sample delta');
    if (count < 1 || delta < 1) throw new Error('MP4 time-to-sample entry is invalid');
    sampleCount = safeAdd(sampleCount, count, 'time-to-sample count');
    sampleDuration = safeAdd(
      sampleDuration,
      safeMultiply(count, delta, 'time-to-sample duration'),
      'time-to-sample duration'
    );
    if (sampleCount > MAXIMUM_SAMPLE_COUNT) throw new Error('MP4 time-to-sample sample count is invalid');
  }
  return { sampleCount, sampleDuration };
}

function requireZeroFullBoxWord(bytes: Uint8Array, box: Box, name: string): void {
  if (uint32(bytes, box.dataStart, name + ' version and flags') !== 0) {
    throw new Error('MP4 ' + name + ' version or flags are unsupported');
  }
}

function sampleSizeTable(bytes: Uint8Array, stsz: Box): SampleSizeTable {
  if (stsz.dataEnd - stsz.dataStart < 12) throw new Error('MP4 sample-size table is truncated');
  requireZeroFullBoxWord(bytes, stsz, 'sample-size table');
  const uniformSize = uint32(bytes, stsz.dataStart + 4, 'uniform sample size');
  const count = uint32(bytes, stsz.dataStart + 8, 'sample-size count');
  if (count < 1 || count > MAXIMUM_SAMPLE_COUNT) throw new Error('MP4 sample-size count is invalid');
  const expectedLength = uniformSize === 0 ? 12 + count * 4 : 12;
  if (stsz.dataEnd - stsz.dataStart !== expectedLength) throw new Error('MP4 sample-size table is invalid');
  return { count, uniformSize, entriesStart: stsz.dataStart + 12 };
}

function sampleToChunkTable(bytes: Uint8Array, stsc: Box): SampleToChunkTable {
  if (stsc.dataEnd - stsc.dataStart < 8) throw new Error('MP4 sample-to-chunk table is truncated');
  requireZeroFullBoxWord(bytes, stsc, 'sample-to-chunk table');
  const entryCount = uint32(bytes, stsc.dataStart + 4, 'sample-to-chunk entry count');
  if (
    entryCount < 1
    || entryCount > MAXIMUM_SAMPLE_COUNT
    || stsc.dataStart + 8 + entryCount * 12 !== stsc.dataEnd
  ) throw new Error('MP4 sample-to-chunk table is invalid');
  return { entryCount, entriesStart: stsc.dataStart + 8 };
}

function chunkOffsetTable(bytes: Uint8Array, entries: readonly Box[]): ChunkOffsetTable {
  const compact = entries.filter((entry) => entry.type === 'stco');
  const extended = entries.filter((entry) => entry.type === 'co64');
  if (compact.length + extended.length !== 1) {
    throw new Error('MP4 must contain exactly one chunk-offset table');
  }
  const box = compact[0] ?? extended[0];
  const width: 4 | 8 = box.type === 'stco' ? 4 : 8;
  const name = width === 4 ? 'chunk-offset table' : '64-bit chunk-offset table';
  if (box.dataEnd - box.dataStart < 8) throw new Error('MP4 ' + name + ' is truncated');
  requireZeroFullBoxWord(bytes, box, name);
  const count = uint32(bytes, box.dataStart + 4, name + ' entry count');
  if (
    count < 1
    || count > MAXIMUM_SAMPLE_COUNT
    || box.dataStart + 8 + count * width !== box.dataEnd
  ) throw new Error('MP4 ' + name + ' is invalid');
  return { count, entriesStart: box.dataStart + 8, width };
}

function sampleToChunkEntry(
  bytes: Uint8Array,
  table: SampleToChunkTable,
  index: number
): { firstChunk: number; samplesPerChunk: number; descriptionIndex: number } {
  const offset = table.entriesStart + index * 12;
  return {
    firstChunk: uint32(bytes, offset, 'sample-to-chunk first chunk'),
    samplesPerChunk: uint32(bytes, offset + 4, 'sample-to-chunk samples per chunk'),
    descriptionIndex: uint32(bytes, offset + 8, 'sample-to-chunk description index')
  };
}

function validateSampleToChunkMapping(
  bytes: Uint8Array,
  table: SampleToChunkTable,
  chunkOffsets: ChunkOffsetTable,
  sampleCount: number,
  budget: ParseBudget
): void {
  spendTableVisits(budget, table.entryCount);
  let previousFirstChunk = 0;
  let mappedSamples = 0;
  for (let index = 0; index < table.entryCount; index += 1) {
    const entry = sampleToChunkEntry(bytes, table, index);
    if (
      entry.firstChunk < 1
      || (index === 0 && entry.firstChunk !== 1)
      || entry.firstChunk <= previousFirstChunk
      || entry.firstChunk > chunkOffsets.count
      || entry.samplesPerChunk < 1
      || entry.descriptionIndex !== 1
    ) throw new Error('MP4 sample-to-chunk table is invalid');
    const nextFirstChunk = index + 1 < table.entryCount
      ? uint32(bytes, table.entriesStart + (index + 1) * 12, 'sample-to-chunk next first chunk')
      : chunkOffsets.count + 1;
    const runChunks = nextFirstChunk - entry.firstChunk;
    if (runChunks < 1) throw new Error('MP4 sample-to-chunk table is invalid');
    mappedSamples = safeAdd(
      mappedSamples,
      safeMultiply(runChunks, entry.samplesPerChunk, 'sample-to-chunk sample count'),
      'sample-to-chunk sample count'
    );
    previousFirstChunk = entry.firstChunk;
  }
  if (mappedSamples !== sampleCount) throw new Error('MP4 media sample tables disagree');
}

function chunkOffsetAt(bytes: Uint8Array, table: ChunkOffsetTable, index: number): number {
  const offset = table.entriesStart + index * table.width;
  return table.width === 4
    ? uint32(bytes, offset, 'chunk offset')
    : uint64(bytes, offset, '64-bit chunk offset');
}

function sampleSizeAt(bytes: Uint8Array, table: SampleSizeTable, index: number): number {
  const size = table.uniformSize || uint32(bytes, table.entriesStart + index * 4, 'sample size');
  if (size < 1) throw new Error('MP4 sample-size table contains an empty sample');
  return size;
}

function mediaDataContains(mediaData: readonly Box[], start: number, end: number): boolean {
  let low = 0;
  let high = mediaData.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (mediaData[middle].dataStart <= start) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate >= 0
    && start >= mediaData[candidate].dataStart
    && end <= mediaData[candidate].dataEnd;
}

function validateTrackMediaData(
  bytes: Uint8Array,
  track: Track,
  mediaData: readonly Box[],
  budget: ParseBudget
): number {
  const sizes = track.sampleSizes;
  const mapping = track.sampleToChunk;
  const offsets = track.chunkOffsets;
  if (!sizes || !mapping || !offsets) throw new Error('MP4 media sample layout is missing');
  spendTableVisits(budget, offsets.count);
  let mappingIndex = 0;
  let mappingEntry = sampleToChunkEntry(bytes, mapping, 0);
  let sampleIndex = 0;
  let referencedBytes = 0;
  for (let chunkIndex = 0; chunkIndex < offsets.count; chunkIndex += 1) {
    const chunkNumber = chunkIndex + 1;
    while (
      mappingIndex + 1 < mapping.entryCount
      && uint32(
        bytes,
        mapping.entriesStart + (mappingIndex + 1) * 12,
        'sample-to-chunk next first chunk'
      ) <= chunkNumber
    ) {
      mappingIndex += 1;
      mappingEntry = sampleToChunkEntry(bytes, mapping, mappingIndex);
    }
    if (sampleIndex + mappingEntry.samplesPerChunk > sizes.count) {
      throw new Error('MP4 media sample tables disagree');
    }
    let chunkBytes = 0;
    if (sizes.uniformSize > 0) {
      chunkBytes = safeMultiply(
        mappingEntry.samplesPerChunk,
        sizes.uniformSize,
        'chunk sample bytes'
      );
    } else {
      spendTableVisits(budget, mappingEntry.samplesPerChunk);
      for (let index = 0; index < mappingEntry.samplesPerChunk; index += 1) {
        chunkBytes = safeAdd(
          chunkBytes,
          sampleSizeAt(bytes, sizes, sampleIndex + index),
          'chunk sample bytes'
        );
      }
    }
    const chunkStart = chunkOffsetAt(bytes, offsets, chunkIndex);
    const chunkEnd = safeAdd(chunkStart, chunkBytes, 'chunk end');
    if (!mediaDataContains(mediaData, chunkStart, chunkEnd)) {
      throw new Error('MP4 sample data lies outside its media-data payload');
    }
    referencedBytes = safeAdd(referencedBytes, chunkBytes, 'referenced sample bytes');
    sampleIndex += mappingEntry.samplesPerChunk;
  }
  if (sampleIndex !== sizes.count) throw new Error('MP4 media sample tables disagree');
  return referencedBytes;
}

function parseTrack(bytes: Uint8Array, trak: Box, budget: ParseBudget): Track {
  const children = childBoxes(bytes, trak, budget);
  const header = trackHeaderMetadata(bytes, exactlyOne(children, 'tkhd', 'track header'));
  const mdia = exactlyOne(children, 'mdia', 'media box');
  const mediaChildren = childBoxes(bytes, mdia, budget);
  const timing = fullBoxTiming(bytes, exactlyOne(mediaChildren, 'mdhd', 'media header'), 'media header');
  if (timing.timescale < 1 || timing.duration < 1) throw new Error('MP4 media timing is invalid');
  const hdlr = exactlyOne(mediaChildren, 'hdlr', 'media handler');
  if (hdlr.dataEnd - hdlr.dataStart < 12) throw new Error('MP4 media handler is truncated');
  const handler = fourcc(bytes, hdlr.dataStart + 8, 'media handler type');
  const minf = exactlyOne(mediaChildren, 'minf', 'media information box');
  const minfChildren = childBoxes(bytes, minf, budget);
  const stbl = exactlyOne(minfChildren, 'stbl', 'sample table');
  const sampleChildren = childBoxes(bytes, stbl, budget);
  const codec = sampleDescriptionCodec(bytes, exactlyOne(sampleChildren, 'stsd', 'sample description'), budget);
  if (handler !== 'vide' && handler !== 'soun') {
    return {
      handler,
      codec,
      ...header,
      ...timing,
      sampleCount: 0,
      sampleDuration: 0,
      sampleSizes: null,
      sampleToChunk: null,
      chunkOffsets: null
    };
  }
  const samples = sampleTiming(bytes, exactlyOne(sampleChildren, 'stts', 'time-to-sample table'), budget);
  const sampleSizes = sampleSizeTable(bytes, exactlyOne(sampleChildren, 'stsz', 'sample-size table'));
  if (sampleSizes.count !== samples.sampleCount) throw new Error('MP4 media sample tables disagree');
  const sampleToChunk = sampleToChunkTable(
    bytes,
    exactlyOne(sampleChildren, 'stsc', 'sample-to-chunk table')
  );
  const chunkOffsets = chunkOffsetTable(bytes, sampleChildren);
  validateSampleToChunkMapping(bytes, sampleToChunk, chunkOffsets, samples.sampleCount, budget);
  return { handler, codec, ...header, ...timing, ...samples, sampleSizes, sampleToChunk, chunkOffsets };
}

export function validateH264AacMp4(bytes: Uint8Array, expected: ExpectedMp4Video): Mp4VideoMetadata {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) throw new Error('MP4 is truncated');
  const expectedWidth = safeInteger(expected.width, 'expected MP4 width', 1, 16_384);
  const expectedHeight = safeInteger(expected.height, 'expected MP4 height', 1, 16_384);
  const expectedFrames = safeInteger(expected.frames, 'expected MP4 frame count', 1, 100_000);
  const expectedFps = safeInteger(expected.fps, 'expected MP4 frame rate', 1, 1_000);
  const budget: ParseBudget = {
    remainingBoxes: Math.min(
      MAXIMUM_BOX_BUDGET,
      Math.max(MINIMUM_BOX_BUDGET, expectedFrames * 8 + 1_024)
    ),
    remainingTableVisits: MAXIMUM_TABLE_VISITS
  };
  const root = boxes(bytes, 0, bytes.byteLength, budget);
  const ftyp = exactlyOne(root, 'ftyp', 'file-type box');
  if (ftyp.dataEnd - ftyp.dataStart < 8 || (ftyp.dataEnd - ftyp.dataStart) % 4 !== 0) {
    throw new Error('MP4 file type is unsupported');
  }
  const brands = [fourcc(bytes, ftyp.dataStart, 'major brand')];
  for (let offset = ftyp.dataStart + 8; offset + 4 <= ftyp.dataEnd; offset += 4) {
    brands.push(fourcc(bytes, offset, 'compatible brand'));
  }
  if (!brands.some((brand) => ['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(brand))) {
    throw new Error('MP4 file type is unsupported');
  }
  const moov = exactlyOne(root, 'moov', 'movie box');
  const mediaData = root.filter((entry) => entry.type === 'mdat');
  if (mediaData.length < 1 || mediaData.every((entry) => entry.dataEnd === entry.dataStart)) {
    throw new Error('MP4 contains no media data');
  }
  const movieChildren = childBoxes(bytes, moov, budget);
  const movieTiming = fullBoxTiming(bytes, exactlyOne(movieChildren, 'mvhd', 'movie header'), 'movie header');
  if (movieTiming.timescale < 1 || movieTiming.duration < 1) throw new Error('MP4 movie timing is invalid');
  const tracks = movieChildren
    .filter((entry) => entry.type === 'trak')
    .map((entry) => parseTrack(bytes, entry, budget));
  const videoTracks = tracks.filter((track) => track.handler === 'vide');
  const audioTracks = tracks.filter((track) => track.handler === 'soun');
  if (videoTracks.length !== 1) throw new Error('MP4 must contain exactly one video track');
  if (audioTracks.length !== 1) throw new Error('MP4 must contain exactly one audio track');
  const video = videoTracks[0];
  const audio = audioTracks[0];
  if (video.codec !== 'avc1' && video.codec !== 'avc3') throw new Error('MP4 video codec is not H.264');
  if (audio.codec !== 'mp4a') throw new Error('MP4 audio codec is not AAC');
  if (video.width !== expectedWidth || video.height !== expectedHeight) {
    throw new Error('MP4 video dimensions do not match the request');
  }
  if (video.sampleCount !== expectedFrames) throw new Error('MP4 frame count does not match the request');
  if (video.duration !== video.sampleDuration) throw new Error('MP4 video duration disagrees with its sample table');
  const fps = video.sampleCount * video.timescale / video.sampleDuration;
  if (!Number.isFinite(fps) || Math.abs(fps - expectedFps) > 1e-6) {
    throw new Error('MP4 video frame rate does not match the request');
  }
  const durationSeconds = video.sampleDuration / video.timescale;
  if (Math.abs(durationSeconds - expectedFrames / expectedFps) > 1 / video.timescale) {
    throw new Error('MP4 video duration does not match the request');
  }
  if (audio.sampleCount < 1) throw new Error('MP4 audio track contains no samples');
  if (audio.duration !== audio.sampleDuration) throw new Error('MP4 audio duration disagrees with its sample table');
  const audioDurationSeconds = audio.sampleDuration / audio.timescale;
  if (Math.abs(audioDurationSeconds - durationSeconds) > 1 / expectedFps) {
    throw new Error('MP4 audio duration is not synchronized with the video');
  }
  if (
    video.presentationDuration !== movieTiming.duration
    || audio.presentationDuration !== video.presentationDuration
  ) throw new Error('MP4 track presentation durations are not synchronized');
  const referencedMediaBytes = safeAdd(
    validateTrackMediaData(bytes, video, mediaData, budget),
    validateTrackMediaData(bytes, audio, mediaData, budget),
    'referenced media bytes'
  );
  let availableMediaBytes = 0;
  for (const entry of mediaData) {
    availableMediaBytes = safeAdd(
      availableMediaBytes,
      entry.dataEnd - entry.dataStart,
      'available media bytes'
    );
  }
  if (referencedMediaBytes > availableMediaBytes) {
    throw new Error('MP4 referenced sample data exceeds its media-data payloads');
  }
  const presentationDurationSeconds = movieTiming.duration / movieTiming.timescale;
  if (Math.abs(presentationDurationSeconds - durationSeconds) > 1 / movieTiming.timescale) {
    throw new Error('MP4 presentation duration does not match the video');
  }
  return {
    videoCodec: video.codec,
    audioCodec: 'mp4a',
    width: video.width,
    height: video.height,
    frameCount: video.sampleCount,
    fps: expectedFps,
    durationSeconds,
    audioSampleCount: audio.sampleCount,
    audioDurationSeconds,
    presentationDurationSeconds
  };
}
