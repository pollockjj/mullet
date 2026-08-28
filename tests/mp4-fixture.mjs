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

function timeToSample(frames, delta) {
  return box('stts', concat([new Uint8Array(4), uint32(1), uint32(frames), uint32(delta)]));
}

function sampleSizes(frames) {
  return box('stsz', concat([new Uint8Array(4), uint32(1), uint32(frames)]));
}

function track({ handlerType, codec, width, height, timescale, duration, frames, sampleDelta, includeSamples = true }) {
  const sampleTableParts = [sampleDescription(codec)];
  if (includeSamples) {
    sampleTableParts.push(timeToSample(frames, sampleDelta), sampleSizes(frames));
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
  audioFrames = 161,
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
    sampleDelta: delta
  });
  const audioTimescale = 32_000;
  const audioDelta = 1_024;
  const audioDuration = audioHeaderDuration ?? audioFrames * audioDelta;
  const audio = track({
    handlerType: 'soun',
    codec: 'mp4a',
    width: 0,
    height: 0,
    timescale: audioTimescale,
    duration: audioDuration,
    frames: audioFrames,
    sampleDelta: audioDelta,
    includeSamples: includeAudioSamples
  });
  const moov = box('moov', includeAudio ? concat([video, audio]) : video);
  const mdat = box('mdat', Uint8Array.from([1]));
  return concat([ftyp, moov, mdat]);
}
