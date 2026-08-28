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

function box(type, payload) {
  return concat([uint32(payload.byteLength + 8), text(type), payload]);
}

function trackHeader(width, height) {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 1, false);
  view.setUint32(76, width * 65_536, false);
  view.setUint32(80, height * 65_536, false);
  return box('tkhd', payload);
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

function track({
  handlerType,
  codec,
  width,
  height,
  timescale,
  duration,
  frames,
  timingEntries,
  sampleSize = 1,
  includeSamples = true
}) {
  const sampleTableParts = [sampleDescription(codec)];
  if (includeSamples) {
    sampleTableParts.push(timeToSample(timingEntries), sampleSizes(frames, sampleSize));
  }
  const stbl = box('stbl', concat(sampleTableParts));
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat([mediaHeader(timescale, duration), handler(handlerType), minf]));
  return box('trak', concat([trackHeader(width, height), mdia]));
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
  audioHeaderDuration
} = {}) {
  const timescale = 12_288;
  const delta = Math.round(timescale / fps);
  const duration = frames * delta;
  const ftyp = box('ftyp', concat([text('isom'), uint32(0), text('isom'), text('iso2'), text('avc1'), text('mp41')]));
  const video = track({
    handlerType: 'vide',
    codec: videoCodec,
    width,
    height,
    timescale,
    duration,
    frames,
    timingEntries: [{ count: frames, delta }]
  });
  const audioTimescale = 32_000;
  const audioFrames = audioTimingEntries.reduce((total, entry) => total + entry.count, 0);
  const audioSampleDuration = audioTimingEntries.reduce((total, entry) => total + entry.count * entry.delta, 0);
  const audioDuration = audioHeaderDuration ?? audioSampleDuration;
  const audio = track({
    handlerType: 'soun',
    codec: 'mp4a',
    width: 0,
    height: 0,
    timescale: audioTimescale,
    duration: audioDuration,
    frames: audioFrames,
    timingEntries: audioTimingEntries,
    sampleSize: audioSampleSize,
    includeSamples: includeAudioSamples
  });
  const moov = box('moov', includeAudio ? concat([video, audio]) : video);
  const mdat = box('mdat', Uint8Array.from([1]));
  return concat([ftyp, moov, mdat]);
}
