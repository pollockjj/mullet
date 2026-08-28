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
};

type Track = {
  handler: string;
  codec: string;
  width: number;
  height: number;
  timescale: number;
  duration: number;
  sampleCount: number;
  sampleDuration: number;
};

const MINIMUM_BOX_BUDGET = 4_096;
const MAXIMUM_BOX_BUDGET = 200_000;

function safeInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(name + ' is invalid');
  return value;
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

function mediaTiming(bytes: Uint8Array, mdhd: Box): { timescale: number; duration: number } {
  const version = fullBoxVersion(bytes, mdhd, 'media header');
  if (version === 0) {
    return {
      timescale: uint32(bytes, mdhd.dataStart + 12, 'media timescale'),
      duration: uint32(bytes, mdhd.dataStart + 16, 'media duration')
    };
  }
  if (version === 1) {
    return {
      timescale: uint32(bytes, mdhd.dataStart + 20, 'media timescale'),
      duration: uint64(bytes, mdhd.dataStart + 24, 'media duration')
    };
  }
  throw new Error('MP4 media header version is unsupported');
}

function trackDimensions(bytes: Uint8Array, tkhd: Box): { width: number; height: number } {
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
  return { width: widthFixed / 65_536, height: heightFixed / 65_536 };
}

function sampleDescriptionCodec(bytes: Uint8Array, stsd: Box, budget: ParseBudget): string {
  if (stsd.dataEnd - stsd.dataStart < 8) throw new Error('MP4 sample description is truncated');
  const entryCount = uint32(bytes, stsd.dataStart + 4, 'sample-description entry count');
  const entries = boxes(bytes, stsd.dataStart + 8, stsd.dataEnd, budget);
  if (entryCount !== 1 || entries.length !== 1) throw new Error('MP4 must contain exactly one sample description');
  return entries[0].type;
}

function sampleTiming(bytes: Uint8Array, stts: Box): { sampleCount: number; sampleDuration: number } {
  if (stts.dataEnd - stts.dataStart < 8) throw new Error('MP4 time-to-sample table is truncated');
  const entryCount = uint32(bytes, stts.dataStart + 4, 'time-to-sample entry count');
  if (entryCount < 1 || stts.dataStart + 8 + entryCount * 8 !== stts.dataEnd) {
    throw new Error('MP4 time-to-sample table is invalid');
  }
  let sampleCount = 0;
  let sampleDuration = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const offset = stts.dataStart + 8 + entry * 8;
    const count = uint32(bytes, offset, 'time-to-sample count');
    const delta = uint32(bytes, offset + 4, 'time-to-sample delta');
    if (count < 1 || delta < 1) throw new Error('MP4 time-to-sample entry is invalid');
    sampleCount += count;
    sampleDuration += count * delta;
    if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(sampleDuration)) {
      throw new Error('MP4 time-to-sample table exceeds the safe parser range');
    }
  }
  return { sampleCount, sampleDuration };
}

function sampleSizeCount(bytes: Uint8Array, stsz: Box): number {
  if (stsz.dataEnd - stsz.dataStart < 12) throw new Error('MP4 sample-size table is truncated');
  const uniformSize = uint32(bytes, stsz.dataStart + 4, 'uniform sample size');
  const count = uint32(bytes, stsz.dataStart + 8, 'sample-size count');
  const expectedLength = uniformSize === 0 ? 12 + count * 4 : 12;
  if (stsz.dataEnd - stsz.dataStart !== expectedLength) throw new Error('MP4 sample-size table is invalid');
  return count;
}

function parseTrack(bytes: Uint8Array, trak: Box, budget: ParseBudget): Track {
  const children = childBoxes(bytes, trak, budget);
  const dimensions = trackDimensions(bytes, exactlyOne(children, 'tkhd', 'track header'));
  const mdia = exactlyOne(children, 'mdia', 'media box');
  const mediaChildren = childBoxes(bytes, mdia, budget);
  const timing = mediaTiming(bytes, exactlyOne(mediaChildren, 'mdhd', 'media header'));
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
    return { handler, codec, ...dimensions, ...timing, sampleCount: 0, sampleDuration: 0 };
  }
  const samples = sampleTiming(bytes, exactlyOne(sampleChildren, 'stts', 'time-to-sample table'));
  const sizeCount = sampleSizeCount(bytes, exactlyOne(sampleChildren, 'stsz', 'sample-size table'));
  if (sizeCount !== samples.sampleCount) throw new Error('MP4 media sample tables disagree');
  return { handler, codec, ...dimensions, ...timing, ...samples };
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
    )
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
  const tracks = childBoxes(bytes, moov, budget)
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
  return {
    videoCodec: video.codec,
    audioCodec: 'mp4a',
    width: video.width,
    height: video.height,
    frameCount: video.sampleCount,
    fps: expectedFps,
    durationSeconds,
    audioSampleCount: audio.sampleCount,
    audioDurationSeconds
  };
}
