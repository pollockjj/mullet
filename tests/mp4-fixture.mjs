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

function text(value) {
  return new TextEncoder().encode(value);
}

function uint32(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function uint64(value) {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value), false);
  return result;
}

function box(type, payload) {
  return concat([uint32(payload.byteLength + 8), text(type), payload]);
}

function trackHeader(width, height, presentationDuration) {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 1, false);
  view.setUint32(20, presentationDuration, false);
  view.setUint32(76, width * 65_536, false);
  view.setUint32(80, height * 65_536, false);
  return box('tkhd', payload);
}

function movieHeader(timescale, duration) {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  return box('mvhd', payload);
}

function mediaHeader(timescale, duration) {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  return box('mdhd', payload);
}

function handler(type) {
  const payload = new Uint8Array(24);
  payload.set(text(type), 8);
  return box('hdlr', payload);
}

function sampleDescription(codec) {
  const entry = box(codec, new Uint8Array(8));
  return box('stsd', concat([new Uint8Array(4), uint32(1), entry]));
}

function timeToSample(entries) {
  return box('stts', concat([
    new Uint8Array(4),
    uint32(entries.length),
    ...entries.flatMap(({ count, delta }) => [uint32(count), uint32(delta)])
  ]));
}

function sampleSizes(frames, uniformSize) {
  return box('stsz', concat([
    new Uint8Array(4),
    uint32(uniformSize),
    uint32(frames),
    ...(uniformSize === 0 ? Array.from({ length: frames }, () => uint32(0)) : [])
  ]));
}

function sampleToChunk(entries) {
  return box('stsc', concat([
    new Uint8Array(4),
    uint32(entries.length),
    ...entries.flatMap(({ firstChunk, samplesPerChunk }) => [
      uint32(firstChunk),
      uint32(samplesPerChunk),
      uint32(1)
    ])
  ]));
}

function chunkOffsets(offsets, useCo64) {
  return box(useCo64 ? 'co64' : 'stco', concat([
    new Uint8Array(4),
    uint32(offsets.length),
    ...offsets.map((offset) => useCo64 ? uint64(offset) : uint32(offset))
  ]));
}

function chunkPlan(samples, maximumChunks = 123) {
  const chunkCount = Math.min(maximumChunks, samples);
  const base = Math.floor(samples / chunkCount);
  const largerChunks = samples % chunkCount;
  const counts = Array.from(
    { length: chunkCount },
    (_, index) => base + (index < largerChunks ? 1 : 0)
  );
  const entries = [{ firstChunk: 1, samplesPerChunk: counts[0] }];
  if (largerChunks > 0 && largerChunks < chunkCount) {
    entries.push({ firstChunk: largerChunks + 1, samplesPerChunk: base });
  }
  return { counts, entries };
}

function track({
  handlerType,
  codec,
  width,
  height,
  timescale,
  duration,
  frames,
  timingEntries,
  sampleToChunkEntries,
  offsets,
  useCo64,
  sampleSize = 1,
  includeSamples = true,
  presentationDuration
}) {
  const sampleTableParts = [sampleDescription(codec)];
  if (includeSamples) {
    sampleTableParts.push(
      timeToSample(timingEntries),
      sampleSizes(frames, sampleSize),
      sampleToChunk(sampleToChunkEntries),
      chunkOffsets(offsets, useCo64)
    );
  }
  const stbl = box('stbl', concat(sampleTableParts));
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat([mediaHeader(timescale, duration), handler(handlerType), minf]));
  return box('trak', concat([trackHeader(width, height, presentationDuration), mdia]));
}

export function buildH264AacMp4Fixture({
  width = 1344,
  height = 768,
  frames = 124,
  fps = 24,
  videoCodec = 'avc1',
  includeAudio = true,
  includeAudioSamples = true,
  audioTimingEntries = [{ count: 162, delta: 1_024 }, { count: 1, delta: 470 }],
  audioSampleSize = 1,
  audioHeaderDuration,
  audioPresentationDuration,
  useCo64 = false,
  mdatPayloadBytes,
  videoChunkOffsetDelta = 0,
  audioChunkOffsetDelta = 0
} = {}) {
  const timescale = 12_288;
  const delta = Math.round(timescale / fps);
  const duration = frames * delta;
  const movieTimescale = 1_000;
  const movieDuration = Math.round(frames / fps * movieTimescale);
  const ftyp = box('ftyp', concat([text('isom'), uint32(0), text('isom'), text('iso2'), text('avc1'), text('mp41')]));
  const audioTimescale = 32_000;
  const audioFrames = audioTimingEntries.reduce((total, entry) => total + entry.count, 0);
  const audioSampleDuration = audioTimingEntries.reduce((total, entry) => total + entry.count * entry.delta, 0);
  const audioDuration = audioHeaderDuration ?? audioSampleDuration;
  const videoPlan = chunkPlan(frames, Math.max(1, frames - 1));
  const audioPlan = chunkPlan(audioFrames);
  const buildMoov = (videoOffsets, audioOffsets) => {
    const video = track({
      handlerType: 'vide',
      codec: videoCodec,
      width,
      height,
      timescale,
      duration,
      frames,
      timingEntries: [{ count: frames, delta }],
      sampleToChunkEntries: videoPlan.entries,
      offsets: videoOffsets,
      useCo64,
      presentationDuration: movieDuration
    });
    const audio = track({
      handlerType: 'soun',
      codec: 'mp4a',
      width: 0,
      height: 0,
      timescale: audioTimescale,
      duration: audioDuration,
      frames: audioFrames,
      timingEntries: audioTimingEntries,
      sampleToChunkEntries: audioPlan.entries,
      offsets: audioOffsets,
      useCo64,
      sampleSize: audioSampleSize,
      includeSamples: includeAudioSamples,
      presentationDuration: audioPresentationDuration ?? movieDuration
    });
    return box('moov', concat([
      movieHeader(movieTimescale, movieDuration),
      ...(includeAudio ? [video, audio] : [video])
    ]));
  };
  const placeholderMoov = buildMoov(
    new Array(videoPlan.counts.length).fill(0),
    new Array(audioPlan.counts.length).fill(0)
  );
  const mdatDataStart = ftyp.byteLength + placeholderMoov.byteLength + 8;
  const videoOffsets = [];
  const audioOffsets = [];
  let dataOffset = mdatDataStart;
  const interleavedChunks = Math.max(videoPlan.counts.length, includeAudio ? audioPlan.counts.length : 0);
  for (let index = 0; index < interleavedChunks; index += 1) {
    if (index < videoPlan.counts.length) {
      videoOffsets.push(dataOffset + videoChunkOffsetDelta);
      dataOffset += videoPlan.counts[index];
    }
    if (includeAudio && index < audioPlan.counts.length) {
      audioOffsets.push(dataOffset + audioChunkOffsetDelta);
      dataOffset += audioPlan.counts[index] * audioSampleSize;
    }
  }
  const moov = buildMoov(videoOffsets, audioOffsets);
  if (moov.byteLength !== placeholderMoov.byteLength) throw new Error('MP4 fixture offset pass changed moov size');
  const payloadBytes = mdatPayloadBytes ?? dataOffset - mdatDataStart;
  const mdat = box('mdat', new Uint8Array(payloadBytes));
  return concat([ftyp, moov, mdat]);
}
