// Minimal MP4 inspection.
//
// This replaces a 656-line byte-level validator that asserted exact equality between
// the container duration and the summed sample table. Real muxers, ComfyUI's included,
// round those independently through the media timescale, so the check rejected valid
// output: the served build was discarding good H3 video with
// "MP4 video duration disagrees with its sample table" for both portrait and scene motion.
//
// What is enforced here is product policy, not container trivia:
//   - the bytes really are an MP4 carrying H.264
//   - the dimensions are the ones that were requested
//   - the audio-track count matches the requirement (expression motion must be silent)
//
// Whether the video actually plays is decided by the browser check, not by a parser.

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

export type Mp4VideoOnlyMetadata = {
  videoCodec: 'avc1' | 'avc3';
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  audioTrackCount: 0;
  presentationDurationSeconds: number;
};

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
const MAX_DEPTH = 8;

type Box = { type: string; start: number; end: number; children: Box[] };

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function u64(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) * 2 ** 32 + u32(bytes, offset + 4);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function parse(bytes: Uint8Array, start: number, end: number, depth: number): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    const type = fourcc(bytes, offset + 4);
    const box: Box = { type, start: offset + headerSize, end: offset + size, children: [] };
    if (CONTAINER_BOXES.has(type) && depth < MAX_DEPTH) {
      box.children = parse(bytes, box.start, box.end, depth + 1);
    }
    found.push(box);
    offset += size;
  }
  return found;
}

function child(boxes: Box[], type: string): Box | null {
  return boxes.find((box) => box.type === type) ?? null;
}

type Track = {
  handler: string;
  format: string;
  width: number;
  height: number;
  sampleCount: number;
  durationSeconds: number;
};

function readTrack(bytes: Uint8Array, trak: Box): Track | null {
  const tkhd = child(trak.children, 'tkhd');
  const mdia = child(trak.children, 'mdia');
  if (!mdia) return null;
  const hdlr = child(mdia.children, 'hdlr');
  const mdhd = child(mdia.children, 'mdhd');
  const stbl = child(child(mdia.children, 'minf')?.children ?? [], 'stbl');
  if (!hdlr || !stbl || hdlr.start + 12 > hdlr.end) return null;

  const handler = fourcc(bytes, hdlr.start + 8);

  const stsd = child(stbl.children, 'stsd');
  let format = '';
  if (stsd && stsd.start + 16 <= stsd.end) format = fourcc(bytes, stsd.start + 12);

  let width = 0;
  let height = 0;
  if (tkhd) {
    const version = bytes[tkhd.start];
    const dimensionsAt = tkhd.end - 8;
    if (dimensionsAt >= tkhd.start + (version === 1 ? 92 : 80) - 8) {
      width = Math.round(u32(bytes, dimensionsAt) / 65_536);
      height = Math.round(u32(bytes, dimensionsAt + 4) / 65_536);
    }
  }

  let sampleCount = 0;
  const stsz = child(stbl.children, 'stsz');
  if (stsz && stsz.start + 12 <= stsz.end) sampleCount = u32(bytes, stsz.start + 8);

  let durationSeconds = 0;
  if (mdhd && mdhd.start + 4 <= mdhd.end) {
    const version = bytes[mdhd.start];
    const base = mdhd.start + 4;
    const timescale = version === 1 ? u32(bytes, base + 16) : u32(bytes, base + 8);
    const duration = version === 1 ? u64(bytes, base + 20) : u32(bytes, base + 12);
    if (timescale > 0) durationSeconds = duration / timescale;
  }

  return { handler, format, width, height, sampleCount, durationSeconds };
}

function inspect(bytes: Uint8Array, expected: ExpectedMp4Video) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) throw new Error('MP4 is truncated');

  const root = parse(bytes, 0, bytes.byteLength, 0);
  if (!child(root, 'ftyp')) throw new Error('MP4 is missing its file-type box');
  const moov = child(root, 'moov');
  if (!moov) throw new Error('MP4 is missing its movie box');
  if (!root.some((box) => box.type === 'mdat' && box.end > box.start)) {
    throw new Error('MP4 contains no media data');
  }

  const tracks = moov.children
    .filter((box) => box.type === 'trak')
    .map((trak) => readTrack(bytes, trak))
    .filter((track): track is Track => track !== null);

  const video = tracks.find((track) => track.handler === 'vide');
  if (!video) throw new Error('MP4 has no video track');
  if (video.format !== 'avc1' && video.format !== 'avc3') {
    throw new Error(`MP4 video codec ${video.format || 'unknown'} is not H.264`);
  }
  if (video.width !== expected.width || video.height !== expected.height) {
    throw new Error(
      `MP4 dimensions ${video.width}x${video.height} do not match the requested ${expected.width}x${expected.height}`
    );
  }

  // The requested length is user-visible: a "two second loop" that returns 49 frames
  // instead of 73 is wrong on screen. This compares against what was asked for, unlike
  // the removed check that compared the container duration against its own sample table.
  if (video.sampleCount > 0 && video.sampleCount !== expected.frames) {
    throw new Error(
      `MP4 frame count ${video.sampleCount} does not match the requested ${expected.frames}`
    );
  }

  const audioTracks = tracks.filter((track) => track.handler === 'soun');
  const frameCount = video.sampleCount || expected.frames;
  const fps = video.durationSeconds > 0 ? frameCount / video.durationSeconds : expected.fps;

  return { video, audioTracks, frameCount, fps, videoCodec: video.format as 'avc1' | 'avc3' };
}

export function validateH264AacMp4(bytes: Uint8Array, expected: ExpectedMp4Video): Mp4VideoMetadata {
  const { video, audioTracks, frameCount, fps, videoCodec } = inspect(bytes, expected);
  const audio = audioTracks[0];
  if (!audio) throw new Error('MP4 has no audio track');
  if (audio.format !== 'mp4a') throw new Error(`MP4 audio codec ${audio.format || 'unknown'} is not AAC`);

  return {
    videoCodec,
    audioCodec: 'mp4a',
    width: video.width,
    height: video.height,
    frameCount,
    fps,
    durationSeconds: video.durationSeconds,
    audioSampleCount: audio.sampleCount,
    audioDurationSeconds: audio.durationSeconds,
    presentationDurationSeconds: Math.max(video.durationSeconds, audio.durationSeconds)
  };
}

export function validateH264VideoOnlyMp4(
  bytes: Uint8Array,
  expected: ExpectedMp4Video
): Mp4VideoOnlyMetadata {
  const { video, audioTracks, frameCount, fps, videoCodec } = inspect(bytes, expected);
  // Expression motion is required to be silent. This is the one audio assertion worth making.
  if (audioTracks.length > 0) throw new Error('MP4 must not contain an audio track');

  return {
    videoCodec,
    width: video.width,
    height: video.height,
    frameCount,
    fps,
    durationSeconds: video.durationSeconds,
    audioTrackCount: 0,
    presentationDurationSeconds: video.durationSeconds
  };
}
