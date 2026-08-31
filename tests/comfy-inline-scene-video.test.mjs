import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { livingHistorySourceForMessages } from '../src/lib/living-history.ts';
import {
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneDimensions,
  inlineSceneImageRequestKey
} from '../src/lib/inline-scene.ts';
import {
  LTX25_INLINE_SCENE_VIDEO_TEMPLATE,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID,
  MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE,
  buildInlineSceneVideoRequest
} from '../src/lib/inline-scene-video.ts';
import {
  loadInlineSceneVideoCapabilities,
  runComfyInlineSceneVideo,
  sha256InlineSceneVideoBytes,
  uploadInlineSceneVideoInput,
  uploadInlineSceneVideoPriorMasterInput,
  validateInlineSceneVideoPriorMasterBytes,
  validateInlineSceneVideoPng
} from '../src/lib/server/comfy-inline-scene-video.ts';
import { buildH264AacMp4Fixture } from './mp4-fixture.mjs';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const promptId = '22222222-2222-4222-8222-222222222222';
const comfyPromptId = '33333333-3333-4333-8333-333333333333';
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
const identityReferenceBytes = png(400, 600);
const identityReferenceSha256 = createHash('sha256').update(identityReferenceBytes).digest('hex');
const bodyReferenceBytes = png(512, 768);
const bodyReferenceSha256 = createHash('sha256').update(bodyReferenceBytes).digest('hex');
const soloCast = Object.freeze({
  kind: 'solo',
  identities: [{
    profileId: sceneCandidate.id,
    profileFingerprint: sceneCandidate.profileFingerprint,
    displayName: sceneCandidate.displayName,
    subject: 'Jenna Stannis',
    referenceImage: {
      name: 'jenna-stannis-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: identityReferenceSha256,
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: {
      name: 'jenna-stannis-body-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: bodyReferenceSha256,
      width: 512,
      height: 768,
      aspectRatio: '2:3'
    }
  }]
});
const priorMasterBytes = png(1328, 752);
const priorMaster = Object.freeze({
  requestKey: `sha256:${'8'.repeat(64)}`,
  promptId: '44444444-4444-4444-8444-444444444444',
  seed: 41,
  generatedAt: 123456788,
  width: 1328,
  height: 752,
  imageSha256: createHash('sha256').update(priorMasterBytes).digest('hex'),
  cast: [{ profileId: sceneCandidate.id, profileFingerprint: sceneCandidate.profileFingerprint }]
});

function request(modelTemplate, continuityMaster) {
  const messages = [
    { role: 'user', content: 'What is happening on the flight deck?' },
    { role: 'assistant', content: 'Blake braces against the console as the Liberator pitches under fire.' }
  ];
  const sidecar = buildInlineSceneRequest(
    conversationId,
    messages,
    livingHistorySourceForMessages(conversationId, messages),
    [sceneCandidate]
  );
  const result = createInlineSceneResult(sidecar, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: [sceneCandidate.id]
  });
  const sceneRequest = buildInlineSceneImageRequest(result, {
    modelTemplate: continuityMaster ? INLINE_SCENE_QWEN_TEMPLATE_ID : INLINE_SCENE_TEMPLATE_ID,
    cast: soloCast,
    ...(continuityMaster ? { continuityMaster } : {}),
    lora: continuityMaster ? null : sceneLora,
    aspectRatio: '16:9',
    megapixels: 1
  });
  const dimensions = inlineSceneDimensions('16:9', 1);
  const scene = {
    conversationId,
    epoch: '11111111-1111-4111-8111-111111111111',
    requestKey: inlineSceneImageRequestKey(sceneRequest),
    request: sceneRequest,
    promptId,
    seed: 42,
    width: dimensions.width,
    height: dimensions.height,
    generatedAt: 123456789,
    imageSha256: 'a'.repeat(64)
  };
  return modelTemplate ? buildInlineSceneVideoRequest(scene, modelTemplate) : buildInlineSceneVideoRequest(scene);
}

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function capabilityInfo(nodeName) {
  const ltx = LTX25_INLINE_SCENE_VIDEO_TEMPLATE;
  const minimax = MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE;
  const required = {};
  const optional = {};
  if (nodeName === 'UNETLoader') required.unet_name = [[ltx.modelFiles.unet, minimax.modelFiles.unet], {}];
  if (nodeName === 'CLIPLoader') {
    required.clip_name = [[ltx.modelFiles.clip, minimax.modelFiles.clip], {}];
    required.type = [['ltxv', 'minimax'], {}];
  }
  if (nodeName === 'VAELoader') {
    required.vae_name = [[ltx.modelFiles.videoVae, ltx.modelFiles.audioVae, minimax.modelFiles.videoVae, minimax.modelFiles.audioVae], {}];
  }
  if (nodeName === 'LatentUpscaleModelLoader') required.model_name = [[ltx.modelFiles.latentUpscaler], {}];
  if (nodeName === 'MiniMaxH3ReferenceToVideo') {
    required.ref_image_size = [['match', 'max'], {}];
    optional.ref_images = ['COMFY_AUTOGROW_V3', {
      template: { input: { required: { ref_image: ['IMAGE', {}] } } },
      prefix: 'ref_image_',
      min: 0,
      max: 9
    }];
  }
  if (nodeName === 'KSamplerSelect') required.sampler_name = [[ltx.sampler, minimax.sampler], {}];
  if (nodeName === 'BasicScheduler') required.scheduler = [[minimax.scheduler], {}];
  if (nodeName === 'LoadImage') required.image = [['uploaded.png'], { image_upload: true }];
  if (nodeName === 'SaveVideo') {
    required.format = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'mp4' }, { key: 'auto' }] }];
    optional.codec = ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'h264' }, { key: 'auto' }] }];
  }
  return { [nodeName]: { input: { required, optional } } };
}

test('reports the exact installed LTX and MiniMax stacks additively', async () => {
  const capabilities = await loadInlineSceneVideoCapabilities(async (inputUrl) => {
    const nodeName = decodeURIComponent(String(inputUrl).split('/').at(-1));
    return Response.json(capabilityInfo(nodeName));
  }, 'http://comfy');
  assert.equal(capabilities.spec, 'mullet_inline_scene_video_capabilities_v5');
  assert.deepEqual(capabilities.templates.map(({ template, available }) => [template.id, available]), [
    ['ltx-2.5-distilled-scene-v2', true],
    ['minimax-h3-ref2va-scene-v1', true]
  ]);
  assert.deepEqual(capabilities.durations, [5]);
  const degradationCases = [
    {
      mutate(info) { info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].max = 8; },
      diagnostic: 'node-autogrow:MiniMaxH3ReferenceToVideo.ref_images:ref_image_:IMAGE:max=9'
    },
    {
      mutate(info) { info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].prefix = 'image_'; },
      diagnostic: 'node-autogrow:MiniMaxH3ReferenceToVideo.ref_images:ref_image_:IMAGE:max=9'
    },
    {
      mutate(info) { info.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.input.required.ref_image[0] = 'MASK'; },
      diagnostic: 'node-autogrow:MiniMaxH3ReferenceToVideo.ref_images:ref_image_:IMAGE:max=9'
    },
    {
      mutate(info) { info.MiniMaxH3ReferenceToVideo.input.required.ref_image_size[0] = ['max']; },
      diagnostic: 'node-option:MiniMaxH3ReferenceToVideo.ref_image_size:match'
    }
  ];
  for (const { mutate, diagnostic } of degradationCases) {
    const degraded = await loadInlineSceneVideoCapabilities(async (inputUrl) => {
      const nodeName = decodeURIComponent(String(inputUrl).split('/').at(-1));
      const info = capabilityInfo(nodeName);
      if (nodeName === 'MiniMaxH3ReferenceToVideo') mutate(info);
      return Response.json(info);
    }, 'http://comfy');
    assert.equal(degraded.templates[0].available, true);
    assert.equal(degraded.templates[1].available, false);
    assert.deepEqual(degraded.templates[1].missing, [diagnostic]);
  }
});

test('uploads only digest-matched static scene bytes to the isolated input namespace', async () => {
  const bytes = png(1328, 752);
  const digest = await sha256InlineSceneVideoBytes(bytes);
  let upload;
  const input = await uploadInlineSceneVideoInput(async (_url, init) => {
    upload = init.body;
    const image = upload.get('image');
    return Response.json({ name: image.name, subfolder: upload.get('subfolder'), type: upload.get('type') });
  }, 'http://comfy', bytes, digest);
  assert.match(input.name, /^scene-motion-[0-9a-f-]+\.png$/i);
  assert.equal(input.subfolder, 'mullet/motion-inputs');
  assert.equal(upload.get('overwrite'), 'false');
  await assert.rejects(
    uploadInlineSceneVideoInput(async () => Response.json({}), 'http://comfy', bytes, 'b'.repeat(64)),
    /does not match/
  );
});

test('accepts only PNG bytes with the exact static scene dimensions', () => {
  validateInlineSceneVideoPng(png(1328, 752), 1328, 752);
  assert.throws(() => validateInlineSceneVideoPng(png(1328, 752), 864, 576), /dimensions/);
  assert.throws(() => validateInlineSceneVideoPng(new Uint8Array(24), 1328, 752), /PNG header/);
});

test('uploads only a byte-verified prior master under a unique motion-input name', async () => {
  await validateInlineSceneVideoPriorMasterBytes(priorMasterBytes, priorMaster);
  let calls = 0;
  let upload;
  const input = await uploadInlineSceneVideoPriorMasterInput(async (_url, init) => {
    calls += 1;
    upload = init.body;
    const image = upload.get('image');
    return Response.json({ name: image.name, subfolder: upload.get('subfolder'), type: upload.get('type') });
  }, 'http://comfy', priorMasterBytes, priorMaster);
  assert.equal(calls, 1);
  assert.match(input.name, /^scene-motion-prior-[0-9a-f-]+\.png$/i);
  assert.equal(input.imageSha256, priorMaster.imageSha256);
  assert.equal(input.width, priorMaster.width);
  assert.equal(input.height, priorMaster.height);
  assert.equal(upload.get('subfolder'), 'mullet/motion-inputs');
  assert.equal(upload.get('overwrite'), 'false');
  calls = 0;
  await assert.rejects(
    uploadInlineSceneVideoPriorMasterInput(
      async () => { calls += 1; return Response.json({}); },
      'http://comfy',
      png(1312, 752),
      { ...priorMaster, imageSha256: await sha256InlineSceneVideoBytes(png(1312, 752)) }
    ),
    /dimensions/
  );
  assert.equal(calls, 0);
});

test('queues and returns only the default silent H.264 LTX first/last-frame MP4', async () => {
  const videoRequest = request();
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const mp4 = buildH264AacMp4Fixture({ width: 1344, height: 768, frames: 121, includeAudio: false });
  let queued;
  const result = await runComfyInlineSceneVideo(async (inputUrl, init = {}) => {
    const url = String(inputUrl);
    if (url.endsWith('/prompt')) {
      queued = JSON.parse(init.body);
      return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
    }
    if (url.endsWith('/history/' + comfyPromptId)) {
      return Response.json({
        [comfyPromptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: {
            '36': {
              videos: [{ filename: 'scene-motion-loop-flf_00001_.mp4', subfolder: 'mullet', type: 'output' }],
              animated: [true]
            }
          }
        }
      });
    }
    if (url.includes('/view?')) return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
    throw new Error('unexpected URL ' + url);
  }, 'http://comfy', videoRequest, input, 42);
  assert.equal(queued.client_id, 'mullet-inline-scene-video');
  assert.equal(queued.prompt['3'].inputs.unet_name, LTX25_INLINE_SCENE_VIDEO_TEMPLATE.modelFiles.unet);
  assert.equal(queued.prompt['12'].inputs.frame_idx, 0);
  assert.equal(queued.prompt['13'].inputs.frame_idx, -1);
  assert.equal(queued.prompt['24'].inputs.frame_idx, 0);
  assert.equal(queued.prompt['25'].inputs.frame_idx, -1);
  assert.equal('audio' in queued.prompt['35'].inputs, false);
  assert.equal(queued.prompt['36'].inputs.filename_prefix, 'mullet/scene-motion-loop-flf');
  assert.equal(queued.prompt['36'].inputs.format, 'mp4');
  assert.equal(queued.prompt['36'].inputs.codec, 'h264');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.audioTracks, 0);
  assert.equal(result.durationSeconds, 121 / 24);
  assert.equal(result.sha256, await sha256InlineSceneVideoBytes(mp4));
});

test('rejects unsafe history and cancels only its own incomplete prompt', async () => {
  const videoRequest = request();
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const cancelled = [];
  await assert.rejects(
    runComfyInlineSceneVideo(async (inputUrl) => {
      const url = String(inputUrl);
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
      if (url.endsWith('/history/' + comfyPromptId)) {
        return Response.json({
          [comfyPromptId]: {
            status: { completed: true, status_str: 'success' },
            outputs: {
              '36': {
                videos: [{ filename: '../secret.mp4', subfolder: 'mullet', type: 'output' }],
                animated: [true]
              }
            }
          }
        });
      }
      if (url.endsWith('/api/jobs/' + comfyPromptId + '/cancel')) {
        cancelled.push(url);
        return new Response(null, { status: 204 });
      }
      throw new Error('unexpected URL ' + url);
    }, 'http://comfy', videoRequest, input, 42),
    /filename/
  );
  assert.deepEqual(cancelled, ['http://comfy/api/jobs/' + comfyPromptId + '/cancel']);
});

test('verifies cast identity on the video endpoint before queuing selectable MiniMax H3 Ref2VA', async () => {
  const videoRequest = request(MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID);
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const mp4 = buildH264AacMp4Fixture();
  const calls = [];
  let queued;
  const result = await runComfyInlineSceneVideo(async (inputUrl, init = {}) => {
    const url = String(inputUrl);
    calls.push(url);
    if (url.includes('/view?') && url.includes('subfolder=mullet%2Fidentity')) {
      const bytes = url.includes('jenna-stannis-body-v1.png') ? bodyReferenceBytes : identityReferenceBytes;
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    }
    if (url.endsWith('/prompt')) {
      queued = JSON.parse(init.body);
      return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
    }
    if (url.endsWith('/history/' + comfyPromptId)) return Response.json({
      [comfyPromptId]: {
        status: { completed: true, status_str: 'success' },
        outputs: {
          '29': {
            images: [{ filename: 'scene-motion_00001_.mp4', subfolder: 'mullet', type: 'output' }],
            animated: [true]
          }
        }
      }
    });
    if (url.includes('/view?')) return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
    throw new Error('unexpected URL ' + url);
  }, 'http://comfy', videoRequest, input, 42);
  assert.ok(calls.findIndex((url) => url.includes('subfolder=mullet%2Fidentity')) < calls.findIndex((url) => url.endsWith('/prompt')));
  const identityViews = calls.filter((url) => url.includes('subfolder=mullet%2Fidentity'));
  assert.equal(identityViews.length, 2);
  assert.ok(identityViews.every((url) => calls.indexOf(url) < calls.findIndex((candidate) => candidate.endsWith('/prompt'))));
  assert.equal(queued.prompt['20'].class_type, 'MiniMaxH3ReferenceToVideo');
  assert.equal(queued.prompt['6'].inputs.image, 'mullet/identity/jenna-stannis-v1.png');
  assert.equal(queued.prompt['7'].inputs.image, 'mullet/identity/jenna-stannis-body-v1.png');
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_2'], ['7', 0]);
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.audioTracks, 1);
  assert.equal(result.durationSeconds, 124 / 24);

  let promptCalls = 0;
  await assert.rejects(
    runComfyInlineSceneVideo(async (inputUrl) => {
      const url = String(inputUrl);
      if (url.includes('jenna-stannis-body-v1.png')) {
        return new Response(new Uint8Array([...bodyReferenceBytes, 0]), { headers: { 'content-type': 'image/png' } });
      }
      if (url.includes('/view?') && url.includes('subfolder=mullet%2Fidentity')) {
        return new Response(identityReferenceBytes, { headers: { 'content-type': 'image/png' } });
      }
      if (url.endsWith('/prompt')) promptCalls += 1;
      throw new Error('unexpected URL ' + url);
    }, 'http://comfy', videoRequest, input, 42),
    /does not match its profile/
  );
  assert.equal(promptCalls, 0);
});

test('queues a verified prior master before canonical identity and rejects master mismatches before any fetch', async () => {
  const videoRequest = request(MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID, priorMaster);
  const input = {
    name: 'scene-motion-44444444-4444-4444-8444-444444444444.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: videoRequest.source.sceneImageSha256
  };
  const masterInput = {
    name: 'scene-motion-prior-55555555-5555-4555-8555-555555555555.png',
    subfolder: 'mullet/motion-inputs',
    type: 'input',
    imageSha256: priorMaster.imageSha256,
    width: priorMaster.width,
    height: priorMaster.height
  };
  const mp4 = buildH264AacMp4Fixture();
  let queued;
  const result = await runComfyInlineSceneVideo(async (inputUrl, init = {}) => {
    const url = String(inputUrl);
    if (url.includes('/view?') && url.includes('subfolder=mullet%2Fidentity')) {
      const bytes = url.includes('jenna-stannis-body-v1.png') ? bodyReferenceBytes : identityReferenceBytes;
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    }
    if (url.endsWith('/prompt')) {
      queued = JSON.parse(init.body);
      return Response.json({ prompt_id: comfyPromptId, node_errors: {} });
    }
    if (url.endsWith('/history/' + comfyPromptId)) return Response.json({
      [comfyPromptId]: {
        status: { completed: true, status_str: 'success' },
        outputs: {
          '29': {
            images: [{ filename: 'scene-motion_00001_.mp4', subfolder: 'mullet', type: 'output' }],
            animated: [true]
          }
        }
      }
    });
    if (url.includes('/view?')) return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
    throw new Error('unexpected URL ' + url);
  }, 'http://comfy', videoRequest, input, 42, undefined, masterInput);
  assert.equal(queued.prompt['6'].inputs.image, `mullet/motion-inputs/${masterInput.name}`);
  assert.equal(queued.prompt['7'].inputs.image, 'mullet/identity/jenna-stannis-v1.png');
  assert.equal(queued.prompt['8'].inputs.image, 'mullet/identity/jenna-stannis-body-v1.png');
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_0'], ['5', 0]);
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_1'], ['6', 0]);
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_2'], ['7', 0]);
  assert.deepEqual(queued.prompt['20'].inputs['ref_images.ref_image_3'], ['8', 0]);
  assert.equal(result.audioTracks, 1);

  for (const [candidateRequest, candidateInput, pattern] of [
    [videoRequest, undefined, /presence/],
    [videoRequest, { ...masterInput, imageSha256: '6'.repeat(64) }, /prior master input/],
    [request(MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID), masterInput, /presence/],
    [request(), masterInput, /does not accept/]
  ]) {
    let calls = 0;
    await assert.rejects(
      runComfyInlineSceneVideo(
        async () => { calls += 1; throw new Error('network must not be reached'); },
        'http://comfy',
        candidateRequest,
        input,
        42,
        undefined,
        candidateInput
      ),
      pattern
    );
    assert.equal(calls, 0);
  }
});
