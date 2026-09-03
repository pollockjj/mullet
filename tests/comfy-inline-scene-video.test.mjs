import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_TEMPLATES,
  MINIMAX_H3_REFERENCE_SCENE_TEMPLATE,
  buildInlineSceneVideoRequest,
  buildInlineSceneVideoWorkflow,
  inlineSceneVideoReferenceName
} from '../src/lib/inline-scene-video.ts';
import {
  ComfyInlineSceneVideoOutputTooLargeError,
  InlineSceneVideoReferenceMissingError,
  assertInlineSceneVideoReferencesPresent,
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes
} from '../src/lib/server/comfy-inline-scene-video.ts';
import { inflightPromptIds } from '../src/lib/server/inflight.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
const baseUrl = 'http://comfy';
const clipMp4Bytes = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73, includeAudio: false });
const messages = [
  { role: 'user', content: 'What is happening on the flight deck?' },
  { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
];
const prompt = 'A damaged starship flight deck tilts sharply beneath Blake as he braces both hands against a glowing control console. Red warning lights rake across dark metal walls while loose equipment slides toward the lower side of the room. The wide camera frames Blake in the foreground, the main display and streaking stars behind him, with hard directional light, visible smoke, and a tense cinematic composition.';
const sceneLora = Object.freeze({
  path: 'zimage/jenna6.safetensors',
  trigger: 'jennastannis',
  modelHash: 'c'.repeat(64)
});
const sceneCandidate = Object.freeze({
  id: 'jenna',
  displayName: 'Jenna Stannis',
  aliases: ['Jenna', 'Jenna Stannis'],
  profileFingerprint: 'd'.repeat(64)
});
const jennaIdentity = Object.freeze({
  profileId: sceneCandidate.id,
  profileFingerprint: sceneCandidate.profileFingerprint,
  displayName: sceneCandidate.displayName,
  subject: 'Jenna Stannis',
  referenceImage: {
    name: 'jenna-stannis-v1.png',
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: 'e'.repeat(64),
    width: 400,
    height: 600,
    aspectRatio: '2:3'
  },
  bodyReferenceImage: null
});
// One-to-one by design (operator order, 2026-09-03): the director selects exactly one
// subject, so a scene request can only ever carry a solo cast.
const soloCast = Object.freeze({ kind: 'solo', identities: [jennaIdentity] });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function reference(identity, view, salt = 0) {
  return {
    profileId: identity.profileId,
    view,
    sha256: sha256(`${identity.profileId}:${view}:${salt}`),
    name: inlineSceneVideoReferenceName(identity.profileId, view, identity.profileFingerprint)
  };
}

function referencesFor(cast, views = ['face', 'threequarter', 'waistup']) {
  return cast.identities.flatMap((identity) => views.map((view) => reference(identity, view)));
}

function request(cast = soloCast, references = referencesFor(cast)) {
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    [sceneCandidate]
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: cast.identities.map(({ profileId }) => profileId)
  });
  const sceneRequest = buildInlineSceneImageRequest(result, {
    modelTemplate: INLINE_SCENE_TEMPLATE_ID,
    cast,
    lora: sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
  return buildInlineSceneVideoRequest({ conversationId, epoch, request: sceneRequest, references });
}

function refpackViewUrl(name) {
  const query = new URLSearchParams({ filename: name, subfolder: 'mullet/identity/refpack', type: 'input' });
  return `${baseUrl}/view?${query}`;
}

function capabilityInfo(nodeName) {
  const template = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE;
  const required = {};
  const optional = {};
  if (nodeName === 'UNETLoader') required.unet_name = [['other_model.safetensors', template.modelFiles.unet], {}];
  if (nodeName === 'CLIPLoader') {
    required.clip_name = [[template.modelFiles.clip], {}];
    required.type = [['stable_diffusion', 'minimax'], {}];
  }
  if (nodeName === 'VAELoader') {
    required.vae_name = [[template.modelFiles.videoVae, template.modelFiles.audioVae], {}];
  }
  if (nodeName === 'MiniMaxH3ReferenceToVideo') {
    required.clip = ['CLIP', {}];
    required.vae = ['VAE', {}];
    required.audio_vae = ['VAE', {}];
    required.prompt = ['STRING', { multiline: true }];
    required.width = ['INT', { min: 32, max: 16384, step: 32 }];
    required.height = ['INT', { min: 32, max: 16384, step: 32 }];
    required.length = ['INT', { min: 5, max: 3600, step: 17 }];
    required.ref_image_size = ['COMBO', { default: 'match', options: ['match', 'max'] }];
    optional.ref_images = ['COMFY_AUTOGROW_V3', {
      template: {
        input: { required: { ref_image: ['IMAGE', { tooltip: 'Reference image' }] } },
        prefix: 'ref_image_',
        min: 0,
        max: 9
      }
    }];
    optional.ref_videos = ['COMFY_AUTOGROW_V3', {
      template: { input: { required: { ref_video: ['VIDEO', {}] } }, prefix: 'ref_video_', min: 0, max: 3 }
    }];
  }
  if (nodeName === 'KSamplerSelect') required.sampler_name = [['euler_ancestral', template.sampler], {}];
  if (nodeName === 'BasicScheduler') required.scheduler = [[template.scheduler, 'normal'], {}];
  if (nodeName === 'LoraLoaderModelOnly') required.lora_name = [['unrelated.safetensors', template.modelFiles.turboLora], {}];
  if (nodeName === 'LoadImage') required.image = [['uploaded.png'], { image_upload: true }];
  if (nodeName === 'SaveVideo') {
    required.format = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'mp4' }, { key: 'auto' }] }];
    optional.codec = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'h264' }, { key: 'auto' }] }];
  }
  return { [nodeName]: { input: { required, optional } } };
}

function nodeNameOf(inputUrl) {
  return decodeURIComponent(String(inputUrl).split('/object_info/').at(-1));
}

async function capabilitiesWith(mutate = () => {}, signal) {
  const queried = [];
  const capabilities = await loadInlineSceneVideoCapabilities(async (inputUrl, init) => {
    const nodeName = nodeNameOf(inputUrl);
    queried.push(nodeName);
    const info = capabilityInfo(nodeName);
    const replacement = mutate(nodeName, info);
    if (replacement instanceof Response) return replacement;
    return Response.json(info);
  }, baseUrl, signal);
  return { capabilities, queried };
}

function successHistory(overrides = {}) {
  return {
    [comfyPromptId]: {
      status: { completed: true, status_str: 'success' },
      outputs: {
        '15': {
          videos: [{ filename: 'scene-motion-ref_00001_.mp4', subfolder: 'mullet', type: 'output' }],
          animated: [true]
        }
      },
      ...overrides
    }
  };
}

function comfyFetcher({
  history = successHistory(),
  videoBytes = clipMp4Bytes,
  contentType = 'video/mp4',
  viewStatus = 200,
  declaredLength = null,
  onHistory = () => {}
} = {}) {
  const calls = [];
  const fetcher = async (inputUrl, init = {}) => {
    const url = String(inputUrl);
    const method = init.method ?? 'GET';
    calls.push({ method, url, init });
    if (url === `${baseUrl}/prompt` && method === 'POST') {
      return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
    }
    if (url === `${baseUrl}/history/${comfyPromptId}`) {
      onHistory();
      return Response.json(typeof history === 'function' ? history() : history);
    }
    if (url.startsWith(`${baseUrl}/view?`)) {
      if (viewStatus !== 200) return new Response('missing', { status: viewStatus });
      return new Response(declaredLength === null ? videoBytes : new Uint8Array(0), {
        headers: {
          'content-type': contentType,
          'content-length': String(declaredLength ?? videoBytes.byteLength)
        }
      });
    }
    if (url === `${baseUrl}/api/jobs/${comfyPromptId}/cancel` && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected URL ' + method + ' ' + url);
  };
  return { fetcher, calls };
}

function cancellations(calls) {
  return calls.filter(({ method, url }) => method === 'POST' && url.includes('/cancel')).map(({ url }) => url);
}

test('reports the exact installed MiniMax H3 reference stack and names every missing piece', async () => {
  const { capabilities, queried } = await capabilitiesWith();
  assert.equal(capabilities.spec, 'mullet_inline_scene_video_capabilities_v7');
  assert.deepEqual(capabilities.templates.map(({ template, available, missing }) => [template.id, available, missing]), [
    ['minimax-h3-ref2va-scene-v1', true, []]
  ]);
  assert.equal(capabilities.templates[0].template, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE);
  assert.deepEqual(capabilities.durations, [3]);
  assert.equal(capabilities.aspectRatios, INLINE_SCENE_VIDEO_DIMENSIONS);
  const expectedNodes = new Set(INLINE_SCENE_VIDEO_TEMPLATES.flatMap(({ requiredNodes }) => requiredNodes));
  assert.deepEqual(new Set(queried), expectedNodes);
  assert.equal(queried.length, expectedNodes.size);
  assert.equal(queried.includes('MiniMaxH3ReferenceToVideo'), true);
  assert.equal(queried.includes('MiniMaxH3ImageToVideo'), false);

  const cases = [
    {
      label: 'autogrow max below nine',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.max = 8; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'autogrow min above zero',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.min = 1; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'autogrow prefix renamed',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.prefix = 'image_'; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'autogrow slot is not an IMAGE',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.input.required.ref_image[0] = 'MASK'; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'autogrow definition is flat',
      mutate: (nodeName, info) => {
        if (nodeName !== 'MiniMaxH3ReferenceToVideo') return;
        info.MiniMaxH3ReferenceToVideo.input.optional.ref_images = ['COMFY_AUTOGROW_V3', {
          template: { input: { required: { ref_image: ['IMAGE', {}] } } },
          prefix: 'ref_image_',
          min: 0,
          max: 9
        }];
      },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'ref_images is not autogrow',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.optional.ref_images = ['IMAGE', {}]; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'ref_images absent',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') delete info.MiniMaxH3ReferenceToVideo.input.optional.ref_images; },
      missing: ['node-input:MiniMaxH3ReferenceToVideo.ref_images']
    },
    {
      label: 'ref_image_size without max',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.required.ref_image_size = ['COMBO', { options: ['match'] }]; },
      missing: ['ref-image-size:max']
    },
    {
      label: 'ref_image_size as a legacy option list',
      mutate: (nodeName, info) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') info.MiniMaxH3ReferenceToVideo.input.required.ref_image_size = [['match'], {}]; },
      missing: ['ref-image-size:max']
    },
    {
      label: 'reference node not installed',
      mutate: (nodeName) => nodeName === 'MiniMaxH3ReferenceToVideo' ? new Response('not found', { status: 404 }) : undefined,
      missing: ['node:MiniMaxH3ReferenceToVideo']
    },
    {
      label: 'reference node query fails',
      mutate: (nodeName) => { if (nodeName === 'MiniMaxH3ReferenceToVideo') throw new Error('connection reset'); },
      missing: ['node:MiniMaxH3ReferenceToVideo']
    },
    {
      label: 'turbo LoRA missing',
      mutate: (nodeName, info) => { if (nodeName === 'LoraLoaderModelOnly') info.LoraLoaderModelOnly.input.required.lora_name[0] = ['unrelated.safetensors']; },
      missing: [`model:lora:${MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.turboLora}`]
    },
    {
      label: 'reference UNET missing',
      mutate: (nodeName, info) => { if (nodeName === 'UNETLoader') info.UNETLoader.input.required.unet_name[0] = ['minimax_h3_fl2va_pruned_int8_convrot.safetensors']; },
      missing: [`model:unet:${MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.unet}`]
    },
    {
      label: 'audio VAE missing',
      mutate: (nodeName, info) => { if (nodeName === 'VAELoader') info.VAELoader.input.required.vae_name[0] = [MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.videoVae]; },
      missing: [`model:vae:${MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.modelFiles.audioVae}`]
    },
    {
      label: 'clip type missing',
      mutate: (nodeName, info) => { if (nodeName === 'CLIPLoader') info.CLIPLoader.input.required.type[0] = ['stable_diffusion']; },
      missing: ['clip-type:minimax']
    },
    {
      label: 'LoadImage without upload',
      mutate: (nodeName, info) => { if (nodeName === 'LoadImage') info.LoadImage.input.required.image[1] = {}; },
      missing: ['node-input:LoadImage.image_upload']
    },
    {
      label: 'SaveVideo without auto codec',
      mutate: (nodeName, info) => { if (nodeName === 'SaveVideo') info.SaveVideo.input.optional.codec[1].options = [{ key: 'h264' }]; },
      missing: ['video-codec:auto']
    },
    {
      label: 'sampler and scheduler missing',
      mutate: (nodeName, info) => {
        if (nodeName === 'KSamplerSelect') info.KSamplerSelect.input.required.sampler_name[0] = ['euler_ancestral'];
        if (nodeName === 'BasicScheduler') info.BasicScheduler.input.required.scheduler[0] = ['normal'];
      },
      missing: ['sampler:euler', 'scheduler:simple']
    },
    {
      label: 'several nodes missing at once',
      mutate: (nodeName) => ['MiniMaxH3SigmaShift', 'CreateVideo', 'LoraLoaderModelOnly'].includes(nodeName)
        ? new Response('not found', { status: 404 })
        : undefined,
      missing: ['node:CreateVideo', 'node:LoraLoaderModelOnly', 'node:MiniMaxH3SigmaShift']
    }
  ];
  for (const { label, mutate, missing } of cases) {
    const { capabilities: degraded } = await capabilitiesWith(mutate);
    assert.equal(degraded.templates.length, 1, label);
    assert.equal(degraded.templates[0].available, false, label);
    assert.deepEqual([...degraded.templates[0].missing].sort(), [...missing].sort(), label);
  }

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(capabilitiesWith((nodeName) => {
    controller.signal.throwIfAborted();
  }, controller.signal));
});

test('queues the reference graph with its own client id, polls history, and returns the verified silent MP4', async () => {
  const videoRequest = request();
  const { fetcher, calls } = comfyFetcher();
  const result = await runComfyInlineSceneVideo(fetcher, baseUrl, videoRequest, 42);
  assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
    ['POST', `${baseUrl}/prompt`],
    ['GET', `${baseUrl}/history/${comfyPromptId}`],
    ['GET', `${baseUrl}/view?filename=scene-motion-ref_00001_.mp4&subfolder=mullet&type=output`]
  ]);
  assert.equal(calls.some(({ url }) => url.includes('/upload/')), false);
  const queued = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(queued.client_id, 'mullet-inline-scene-video');
  assert.deepEqual(queued.prompt, buildInlineSceneVideoWorkflow(videoRequest, 42));
  assert.equal(queued.prompt['6'].class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(queued.prompt['6'].inputs.ref_images, { ref_image_0: ['20', 0], ref_image_1: ['21', 0], ref_image_2: ['22', 0] });
  assert.equal(queued.prompt['20'].inputs.image, `mullet/identity/refpack/jenna-face-${'d'.repeat(16)}.png`);
  assert.equal(queued.prompt['10'].inputs.noise_seed, 42);
  assert.equal(queued.prompt['15'].inputs.filename_prefix, 'mullet/scene-motion-ref');
  assert.deepEqual(result.bytes, clipMp4Bytes);
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.promptId, comfyPromptId);
  assert.equal(result.filename, 'scene-motion-ref_00001_.mp4');
  assert.equal(result.sha256, sha256(clipMp4Bytes));
  assert.equal(result.sha256, await sha256InlineSceneVideoBytes(clipMp4Bytes));
  assert.equal(result.durationSeconds, 73 / 24);
  assert.equal(result.audioTracks, 0);
  assert.equal(cancellations(calls).length, 0);
  assert.equal(inflightPromptIds().includes(comfyPromptId), false);

  // A shorter reference set for the same one subject: the pictures keep their submitted
  // order, each gets its own LoadImage node, and both bind to the one cast display name.
  const pairRequest = request(soloCast, [reference(jennaIdentity, 'face'), reference(jennaIdentity, 'identity')]);
  const pair = comfyFetcher();
  await runComfyInlineSceneVideo(pair.fetcher, baseUrl, pairRequest, 7);
  const pairQueued = JSON.parse(pair.calls[0].init.body);
  assert.deepEqual(pairQueued.prompt['6'].inputs.ref_images, { ref_image_0: ['20', 0], ref_image_1: ['21', 0] });
  assert.equal(pairQueued.prompt['21'].inputs.image, `mullet/identity/refpack/jenna-identity-${'d'.repeat(16)}.png`);
  assert.match(pairQueued.prompt['6'].inputs.prompt, /Jenna Stannis is the person in <Picture 1> face, <Picture 2> identity/);
});

test('waits through pending history and keeps polling until the clip lands', async () => {
  let polls = 0;
  const { fetcher, calls } = comfyFetcher({
    history: () => {
      polls += 1;
      if (polls === 1) return {};
      if (polls === 2) return { [comfyPromptId]: { status: { completed: false, status_str: 'running' }, outputs: {} } };
      return successHistory();
    }
  });
  const result = await runComfyInlineSceneVideo(fetcher, baseUrl, request(), 1);
  assert.equal(polls, 3);
  assert.equal(result.filename, 'scene-motion-ref_00001_.mp4');
  assert.equal(calls.filter(({ url }) => url.includes('/history/')).length, 3);
  assert.equal(cancellations(calls).length, 0);
});

test('rejects unsafe or foreign history and cancels only its own incomplete prompt', async () => {
  const videoRequest = request();
  const unsafe = [
    ['../secret.mp4', 'mullet', 'output', [true], '15', /filename/],
    ['scene-motion-loop_00001_.mp4', 'mullet', 'output', [true], '15', /filename/],
    ['scene-motion-ref_00001_.png', 'mullet', 'output', [true], '15', /filename/],
    ['scene-motion-ref_00001_.mp4', 'other', 'output', [true], '15', /location/],
    ['scene-motion-ref_00001_.mp4', 'mullet', 'temp', [true], '15', /location/],
    ['scene-motion-ref_00001_.mp4', 'mullet', 'output', [false], '15', /animated/],
    ['scene-motion-ref_00001_.mp4', 'mullet', 'output', [], '15', /animated/],
    ['scene-motion-ref_00001_.mp4', 'mullet', 'output', [true], '29', /fixed output node/]
  ];
  for (const [filename, subfolder, type, animated, node, expected] of unsafe) {
    const { fetcher, calls } = comfyFetcher({
      history: {
        [comfyPromptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: { [node]: { videos: [{ filename, subfolder, type }], animated } }
        }
      }
    });
    await assert.rejects(runComfyInlineSceneVideo(fetcher, baseUrl, videoRequest, 42), expected);
    assert.deepEqual(cancellations(calls), [`${baseUrl}/api/jobs/${comfyPromptId}/cancel`]);
    assert.equal(calls.some(({ url }) => url.includes('/interrupt') || url.includes('/queue')), false);
    assert.equal(calls.some(({ url }) => url.includes('/view?')), false);
    assert.equal(inflightPromptIds().includes(comfyPromptId), false);
  }

  const failed = comfyFetcher({
    history: { [comfyPromptId]: { status: { completed: true, status_str: 'error' }, outputs: {} } }
  });
  await assert.rejects(runComfyInlineSceneVideo(failed.fetcher, baseUrl, videoRequest, 42), /execution failed/);
  assert.deepEqual(cancellations(failed.calls), [`${baseUrl}/api/jobs/${comfyPromptId}/cancel`]);
  assert.equal(failed.calls.some(({ url }) => url.includes('/interrupt')), false);

  const unfinished = comfyFetcher({
    history: { [comfyPromptId]: { status: { completed: true, status_str: 'cancelled' }, outputs: {} } }
  });
  await assert.rejects(runComfyInlineSceneVideo(unfinished.fetcher, baseUrl, videoRequest, 42), /did not succeed/);
  assert.equal(cancellations(unfinished.calls).length, 1);

  const twoOutputs = comfyFetcher({
    history: successHistory({
      outputs: {
        '15': { videos: [{ filename: 'scene-motion-ref_00001_.mp4', subfolder: 'mullet', type: 'output' }], animated: [true] },
        '16': { videos: [{ filename: 'scene-motion-ref_00002_.mp4', subfolder: 'mullet', type: 'output' }], animated: [true] }
      }
    })
  });
  await assert.rejects(runComfyInlineSceneVideo(twoOutputs.fetcher, baseUrl, videoRequest, 42), /fixed output node/);
  assert.equal(cancellations(twoOutputs.calls).length, 1);
});

test('an abort while polling cancels exactly the submitted prompt and releases it from in-flight tracking', async () => {
  const controller = new AbortController();
  let seenInflight = false;
  const { fetcher, calls } = comfyFetcher({
    history: {},
    onHistory: () => {
      seenInflight = inflightPromptIds().includes(comfyPromptId);
      controller.abort();
    }
  });
  await assert.rejects(
    runComfyInlineSceneVideo(fetcher, baseUrl, request(), 42, controller.signal),
    (cause) => cause instanceof Error && cause.name === 'AbortError'
  );
  assert.equal(seenInflight, true);
  assert.deepEqual(cancellations(calls), [`${baseUrl}/api/jobs/${comfyPromptId}/cancel`]);
  assert.equal(calls.filter(({ url }) => url.includes('/history/')).length, 1);
  assert.equal(calls.some(({ url }) => url.includes('/interrupt') || url.includes('/queue') || url.includes('/free')), false);
  assert.equal(inflightPromptIds().includes(comfyPromptId), false);
  const cancel = calls.find(({ url }) => url.includes('/cancel'));
  assert.notEqual(cancel.init.signal, controller.signal);

  const aborted = new AbortController();
  aborted.abort();
  const neverQueued = comfyFetcher();
  await assert.rejects(
    runComfyInlineSceneVideo(async (inputUrl, init) => {
      init?.signal?.throwIfAborted();
      return neverQueued.fetcher(inputUrl, init);
    }, baseUrl, request(), 42, aborted.signal),
    (cause) => cause instanceof Error && cause.name === 'AbortError'
  );
  assert.equal(neverQueued.calls.length, 0);
});

test('rejects output that is not the requested silent H.264 MP4 and cancels the prompt', async () => {
  const videoRequest = request();
  const audioBearing = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 73 });
  const wrongSize = buildH264AacMp4Fixture({ width: 1344, height: 768, frames: 73, includeAudio: false });
  const wrongLength = buildH264AacMp4Fixture({ width: 1024, height: 576, frames: 121, includeAudio: false });
  const notMp4 = new Uint8Array(64);
  const cases = [
    [{ videoBytes: audioBearing }, /audio track/],
    [{ videoBytes: wrongSize }, /dimensions/],
    [{ videoBytes: wrongLength }, /frame count/],
    [{ videoBytes: notMp4 }, /MP4 signature/],
    [{ contentType: 'image/png' }, /not MP4/],
    [{ viewStatus: 500 }, /fetch failed \(500\)/],
    [{ viewStatus: 404 }, /fetch failed \(404\)/]
  ];
  for (const [options, expected] of cases) {
    const { fetcher, calls } = comfyFetcher(options);
    await assert.rejects(runComfyInlineSceneVideo(fetcher, baseUrl, videoRequest, 42), expected);
    assert.deepEqual(cancellations(calls), [`${baseUrl}/api/jobs/${comfyPromptId}/cancel`]);
    assert.equal(inflightPromptIds().includes(comfyPromptId), false);
  }
  const oversized = comfyFetcher({ declaredLength: 64 * 1024 * 1024 + 1 });
  await assert.rejects(
    runComfyInlineSceneVideo(oversized.fetcher, baseUrl, videoRequest, 42),
    (cause) => cause instanceof ComfyInlineSceneVideoOutputTooLargeError
  );
  assert.equal(cancellations(oversized.calls).length, 1);
  const cancelFailure = comfyFetcher({ videoBytes: audioBearing });
  await assert.rejects(
    runComfyInlineSceneVideo(async (inputUrl, init) => {
      if (String(inputUrl).includes('/cancel')) throw new Error('cancel endpoint down');
      return cancelFailure.fetcher(inputUrl, init);
    }, baseUrl, videoRequest, 42),
    /audio track/
  );
});

test('confirms every reference on the loop lane with a drained GET before queuing', async () => {
  const videoRequest = request();
  const names = videoRequest.source.references.map(({ name }) => name);
  const signal = new AbortController().signal;

  const present = [];
  await assertInlineSceneVideoReferencesPresent(async (inputUrl, init) => {
    present.push({ url: String(inputUrl), init });
    return new Response(null, { status: 200 });
  }, baseUrl, videoRequest, signal);
  assert.deepEqual(present.map(({ url }) => url), names.map(refpackViewUrl));
  assert.equal(present[0].url, `${baseUrl}/view?filename=jenna-face-${'d'.repeat(16)}.png&subfolder=mullet%2Fidentity%2Frefpack&type=input`);
  // ComfyUI's /view does not answer HEAD consistently, so the probe is a GET whose body
  // is read and dropped.
  assert.deepEqual(present.map(({ init }) => init.method ?? 'GET'), ['GET', 'GET', 'GET']);
  assert.ok(present.every(({ init }) => init.signal === signal));

  const missingCalls = [];
  await assert.rejects(
    assertInlineSceneVideoReferencesPresent(async (inputUrl, init) => {
      missingCalls.push({ url: String(inputUrl), init });
      return new Response(null, { status: missingCalls.length === 2 ? 404 : 200 });
    }, baseUrl, videoRequest),
    (cause) => cause instanceof InlineSceneVideoReferenceMissingError
      && cause.name === 'InlineSceneVideoReferenceMissingError'
      && cause.message.includes(names[1])
      && !cause.message.includes(names[0])
  );
  assert.equal(missingCalls.length, 2);

  for (const status of [403, 500, 503]) {
    await assert.rejects(
      assertInlineSceneVideoReferencesPresent(async () => new Response(null, { status }), baseUrl, videoRequest),
      (cause) => cause instanceof InlineSceneVideoReferenceMissingError && cause.message.includes(names[0])
    );
  }

  // The probe follows the submitted reference order, whatever it is, and accepts a 204.
  const reorderedRequest = request(soloCast, [reference(jennaIdentity, 'identity'), reference(jennaIdentity, 'waistup')]);
  const reorderedCalls = [];
  await assertInlineSceneVideoReferencesPresent(async (inputUrl) => {
    reorderedCalls.push(String(inputUrl));
    return new Response(null, { status: 204 });
  }, baseUrl, reorderedRequest);
  assert.deepEqual(reorderedCalls, [
    refpackViewUrl(`jenna-identity-${'d'.repeat(16)}.png`),
    refpackViewUrl(`jenna-waistup-${'d'.repeat(16)}.png`)
  ]);
});
