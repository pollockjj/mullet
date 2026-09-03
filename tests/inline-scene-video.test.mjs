import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transcriptSourceForMessages } from '../src/lib/transcript-source.ts';
import {
  INLINE_SCENE_QWEN_TEMPLATE_ID,
  INLINE_SCENE_TEMPLATE_ID,
  buildInlineSceneImageRequest,
  buildInlineSceneRequest,
  createInlineSceneResult,
  inlineSceneImageRequestKey
} from '../src/lib/inline-scene.ts';
import {
  INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
  INLINE_SCENE_VIDEO_DIMENSIONS,
  INLINE_SCENE_VIDEO_DURATION_SECONDS,
  INLINE_SCENE_VIDEO_FPS,
  INLINE_SCENE_VIDEO_FRAMES,
  INLINE_SCENE_VIDEO_MODE,
  INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER,
  INLINE_SCENE_VIDEO_REQUEST_SPEC,
  INLINE_SCENE_VIDEO_TEMPLATE_ID,
  INLINE_SCENE_VIDEO_TEMPLATES,
  MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES,
  MINIMAX_H3_REFERENCE_SCENE_TEMPLATE,
  MINIMAX_H3_SCENE_DIMENSIONS,
  buildInlineSceneVideoPrompt,
  buildInlineSceneVideoRequest,
  buildInlineSceneVideoWorkflow,
  inlineSceneMasterToggleEnabled,
  inlineSceneVideoDecodeFailureTransition,
  inlineSceneVideoDimensions,
  inlineSceneVideoMasterToggleAction,
  inlineSceneVideoOutputNode,
  inlineSceneVideoReconciliationAllowed,
  inlineSceneVideoReferenceName,
  inlineSceneVideoReferencesSha256,
  inlineSceneVideoRequestKey,
  inlineSceneVideoSourceRequestSha256,
  inlineSceneVideoTemplateAvailable,
  normalizeInlineSceneVideoCapabilities,
  normalizeInlineSceneVideoReference,
  normalizeInlineSceneVideoRequest,
  parseInlineSceneVideoIntegerHeader,
  parseInlineSceneVideoNumberHeader
} from '../src/lib/inline-scene-video.ts';

const conversationId = '8d78c151-83f0-4c72-9b9b-1ab957adca78';
const epoch = '11111111-1111-4111-8111-111111111111';
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
const soloCast = Object.freeze({
  kind: 'solo',
  identities: [{
    profileId: sceneCandidate.id,
    profileFingerprint: sceneCandidate.profileFingerprint,
    displayName: sceneCandidate.displayName,
    subject: 'Jenna Stannis',
    referenceImage: {
      name: 'jenna-stannis-v1.jpg',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: 'e'.repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: null
  }]
});
const trioCandidates = Object.freeze([
  sceneCandidate,
  Object.freeze({
    id: 'cally',
    displayName: 'Cally',
    aliases: ['Cally'],
    profileFingerprint: 'f'.repeat(64)
  }),
  Object.freeze({
    id: 'servalan',
    displayName: 'Servalan',
    aliases: ['Servalan'],
    profileFingerprint: '9'.repeat(64)
  })
]);
const trioCast = Object.freeze({
  kind: 'trio',
  identities: trioCandidates.map((candidate, index) => ({
    profileId: candidate.id,
    profileFingerprint: candidate.profileFingerprint,
    displayName: candidate.displayName,
    subject: candidate.displayName,
    referenceImage: {
      name: `${candidate.id}-canonical.png`,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: String(index + 1).repeat(64),
      width: 400,
      height: 600,
      aspectRatio: '2:3'
    },
    bodyReferenceImage: null
  }))
});
const ALL_VIEWS = Object.freeze(['face', 'threequarter', 'waistup', 'identity']);

function castForCount(count) {
  const identities = trioCast.identities.slice(0, count);
  return {
    kind: count === 1 ? 'solo' : count === 2 ? 'duo' : 'trio',
    identities
  };
}

function sceneRequest(
  aspectRatio = '16:9',
  { candidates = [sceneCandidate], cast = soloCast, megapixels = 1 } = {}
) {
  const sidecarRequest = buildInlineSceneRequest(
    conversationId,
    messages,
    transcriptSourceForMessages(conversationId, messages),
    candidates
  );
  const result = createInlineSceneResult(sidecarRequest, 'gemma-4-ortenzya', {
    prompt,
    subjectIds: cast.identities.map(({ profileId }) => profileId)
  });
  const usesQwen = cast.kind !== 'solo';
  return buildInlineSceneImageRequest(result, {
    modelTemplate: usesQwen ? INLINE_SCENE_QWEN_TEMPLATE_ID : INLINE_SCENE_TEMPLATE_ID,
    cast,
    lora: usesQwen ? null : sceneLora,
    aspectRatio,
    megapixels
  });
}

function fingerprintOf(profileId) {
  const identity = trioCast.identities.find((entry) => entry.profileId === profileId);
  if (!identity) throw new Error(`no fixture identity for ${profileId}`);
  return identity.profileFingerprint;
}

// A prepared reference on the loop lane: named by profile, view, and the first sixteen
// hex characters of the subject's profile fingerprint, exactly as /api/scene/references
// names it. sha256 is the hash of the prepared PNG itself, which the name does not carry.
function reference(profileId, view, salt = 0, profileFingerprint = fingerprintOf(profileId)) {
  const sha256 = createHash('sha256').update(`${profileId}:${view}:${salt}`).digest('hex');
  return { profileId, view, sha256, name: inlineSceneVideoReferenceName(profileId, view, profileFingerprint) };
}

function referencesFor(request, views = ['face', 'threequarter', 'waistup']) {
  return request.cast.identities.flatMap(({ profileId }) => views.map((view) => reference(profileId, view)));
}

function motionSource(request = sceneRequest(), references = referencesFor(request)) {
  return { conversationId, epoch, request, references };
}


test('builds a single reference-to-video request bound to the scene request and its cast references', () => {
  const scene = sceneRequest();
  const references = referencesFor(scene);
  const request = buildInlineSceneVideoRequest({ conversationId, epoch, request: scene, references });
  assert.equal(INLINE_SCENE_VIDEO_REQUEST_SPEC, 'mullet_inline_scene_video_request_v7');
  assert.equal(request.spec, INLINE_SCENE_VIDEO_REQUEST_SPEC);
  assert.equal(request.modelTemplate, 'minimax-h3-ref2va-scene-v1');
  assert.equal(request.modelTemplate, INLINE_SCENE_VIDEO_TEMPLATE_ID);
  assert.equal(request.mode, 'ref2v');
  assert.equal(request.mode, INLINE_SCENE_VIDEO_MODE);
  assert.equal(request.aspectRatio, '16:9');
  assert.equal(request.durationSeconds, 3);
  assert.equal(request.durationSeconds, INLINE_SCENE_VIDEO_DURATION_SECONDS);
  assert.equal(request.source.conversationId, conversationId);
  assert.equal(request.source.epoch, epoch);
  assert.equal(request.source.sceneRequestKey, inlineSceneImageRequestKey(scene));
  assert.deepEqual(request.source.sceneRequest, scene);
  assert.deepEqual(request.source.references, references);
  assert.notEqual(request.source.references, references);
  assert.equal(request.source.references[0].name, `jenna-face-${'d'.repeat(16)}.png`);
  assert.deepEqual(normalizeInlineSceneVideoRequest(request), request);
  assert.deepEqual(normalizeInlineSceneVideoRequest(JSON.parse(JSON.stringify(request))), request);
  assert.equal('sceneImageSha256' in request.source, false);
  assert.equal('scenePromptId' in request.source, false);
  assert.equal('priorMaster' in request.source, false);
});

test('offers exactly one scene-motion path: the MiniMax H3 reference clip', () => {
  assert.deepEqual(INLINE_SCENE_VIDEO_TEMPLATES.map(({ id }) => id), ['minimax-h3-ref2va-scene-v1']);
  const template = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE;
  assert.equal(template.id, INLINE_SCENE_VIDEO_TEMPLATE_ID);
  assert.equal(template.mode, 'ref2v');
  assert.equal(template.modelFamily, 'minimax-h3-ref2va');
  assert.equal(template.modelFiles.unet, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors');
  assert.equal(template.modelFiles.turboLora, 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors');
  assert.equal(template.dimensions, MINIMAX_H3_SCENE_DIMENSIONS);
  assert.equal(template.frames, 73);
  assert.equal(template.frames, INLINE_SCENE_VIDEO_FRAMES);
  assert.equal(template.durationSeconds, 3);
  assert.equal(template.steps, 4);
  assert.equal(template.outputNode, '15');
  assert.equal(template.refImageSize, 'max');
  assert.equal(MINIMAX_H3_REFERENCE_SCENE_MAX_REFERENCES, 9);
  assert.equal(INLINE_SCENE_VIDEO_REFERENCE_SUBFOLDER, 'mullet/identity/refpack');
  assert.equal(INLINE_SCENE_VIDEO_FPS, 24);
  assert.equal(template.requiredNodes.includes('MiniMaxH3ReferenceToVideo'), true);
  assert.equal(template.requiredNodes.includes('MiniMaxH3ImageToVideo'), false);
  const serialized = JSON.stringify(template);
  assert.equal(serialized.includes('fl2v'), false);
  assert.equal(serialized.includes('ltx'), false);
  for (const { width, height } of MINIMAX_H3_SCENE_DIMENSIONS) {
    assert.equal(width % template.multiple, 0);
    assert.equal(height % template.multiple, 0);
    assert.ok(width * height <= template.maxPixels);
  }
});

test('derives clip dimensions per aspect ratio from the H3 scene table', () => {
  for (const { aspectRatio, width, height } of MINIMAX_H3_SCENE_DIMENSIONS) {
    assert.deepEqual(inlineSceneVideoDimensions(aspectRatio), { width, height, frames: 73, fps: 24 });
  }
  assert.deepEqual(inlineSceneVideoDimensions('16:9'), { width: 1024, height: 576, frames: 73, fps: 24 });
  assert.deepEqual(inlineSceneVideoDimensions('3:2'), { width: 928, height: 640, frames: 73, fps: 24 });
  assert.throws(() => inlineSceneVideoDimensions('9:16'), /aspect ratio/);
  assert.throws(() => inlineSceneVideoDimensions('16:9', 'minimax-h3-fl2va-scene-loop-v1'), /model template/);
  for (const scene of [sceneRequest('3:2'), sceneRequest('4:3'), sceneRequest('5:4')]) {
    const request = buildInlineSceneVideoRequest(motionSource(scene));
    assert.equal(request.aspectRatio, scene.aspectRatio);
  }
});

test('request key carries the ordered reference names and the hashes cover the reference set', () => {
  const scene = sceneRequest();
  const references = referencesFor(scene);
  const request = buildInlineSceneVideoRequest({ conversationId, epoch, request: scene, references });
  const key = inlineSceneVideoRequestKey(request);
  // The scene request key is itself unit-separated, so the clip key is compared whole.
  assert.equal(key, [
    conversationId,
    epoch,
    inlineSceneImageRequestKey(scene),
    ...references.map(({ name }) => name),
    'minimax-h3-ref2va-scene-v1',
    'ref2v',
    '16:9',
    '3'
  ].join('\u001f'));

  const reordered = buildInlineSceneVideoRequest({ conversationId, epoch, request: scene, references: [...references].reverse() });
  assert.notEqual(inlineSceneVideoRequestKey(reordered), key);
  const fewer = buildInlineSceneVideoRequest({ conversationId, epoch, request: scene, references: references.slice(0, 1) });
  assert.notEqual(inlineSceneVideoRequestKey(fewer), key);
  const otherView = buildInlineSceneVideoRequest({
    conversationId,
    epoch,
    request: scene,
    references: [reference(sceneCandidate.id, 'identity'), ...references.slice(1)]
  });
  assert.notEqual(inlineSceneVideoRequestKey(otherView), key);

  const expectedReferencesSha256 = createHash('sha256')
    .update(references.map(({ sha256 }) => sha256).join('\n'))
    .digest('hex');
  assert.equal(inlineSceneVideoReferencesSha256(request), expectedReferencesSha256);
  assert.equal(inlineSceneVideoReferencesSha256(normalizeInlineSceneVideoRequest(request)), expectedReferencesSha256);
  assert.notEqual(inlineSceneVideoReferencesSha256(reordered), expectedReferencesSha256);
  assert.notEqual(inlineSceneVideoReferencesSha256(fewer), expectedReferencesSha256);
  // The same picture names with re-prepared bytes: the name-based key holds, the
  // provenance hash over the image bytes moves.
  const reprepared = buildInlineSceneVideoRequest({
    conversationId,
    epoch,
    request: scene,
    references: [reference(sceneCandidate.id, 'face', 1), ...references.slice(1)]
  });
  assert.notEqual(inlineSceneVideoReferencesSha256(reprepared), expectedReferencesSha256);
  assert.equal(
    inlineSceneVideoSourceRequestSha256(request),
    createHash('sha256').update(inlineSceneImageRequestKey(scene)).digest('hex')
  );
  assert.equal(inlineSceneVideoSourceRequestSha256(reordered), inlineSceneVideoSourceRequestSha256(request));
});

test('normalizes a reference only when its name is derived from its profile, view, and subject fingerprint', () => {
  const fingerprint = fingerprintOf('cally');
  const good = reference('cally', 'threequarter');
  assert.equal(good.name, `cally-threequarter-${'f'.repeat(16)}.png`);
  assert.equal(inlineSceneVideoReferenceName('jenna-stannis', 'identity', '1234abcd'), 'jenna-stannis-identity-1234abcd.png');
  assert.equal(inlineSceneVideoReferenceName('jenna-stannis', 'face', 'a'.repeat(64)), `jenna-stannis-face-${'a'.repeat(16)}.png`);
  assert.deepEqual(normalizeInlineSceneVideoReference(good), good);
  assert.deepEqual(normalizeInlineSceneVideoReference(good, fingerprint), good);
  assert.deepEqual(normalizeInlineSceneVideoReference({ ...good, extra: 'ignored' }, fingerprint), good);
  const short = { ...good, name: 'cally-threequarter-1234abcd.png' };
  assert.deepEqual(normalizeInlineSceneVideoReference(short, '1234abcd'), short);
  assert.throws(() => normalizeInlineSceneVideoReference(null), /reference is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference([good]), /reference is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, profileId: 'Cally' }), /profile is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, profileId: '-cally' }), /profile is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, profileId: 'c'.repeat(65) }), /profile is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, view: 'portrait' }), /view is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, sha256: good.sha256.toUpperCase() }), /hash is invalid/);
  assert.throws(() => normalizeInlineSceneVideoReference({ ...good, sha256: good.sha256.slice(0, 63) }), /hash is invalid/);
  for (const name of [
    `cally-face-${'f'.repeat(16)}.png`,
    `jenna-threequarter-${'f'.repeat(16)}.png`,
    `cally-threequarter-${'f'.repeat(17)}.png`,
    `cally-threequarter-${'F'.repeat(16)}.png`,
    'cally-threequarter-.png',
    `cally-threequarter-${'f'.repeat(16)}.jpg`,
    `../cally-threequarter-${'f'.repeat(16)}.png`,
    `mullet/identity/refpack/${good.name}`,
    'other',
    ''
  ]) {
    assert.throws(() => normalizeInlineSceneVideoReference({ ...good, name }), /does not match its profile and view/);
    assert.throws(() => normalizeInlineSceneVideoReference({ ...good, name }, fingerprint), /does not match its profile and view/);
  }
  assert.throws(() => normalizeInlineSceneVideoReference(good, fingerprintOf('jenna')), /does not match its subject fingerprint/);
  assert.throws(
    () => normalizeInlineSceneVideoReference({ ...good, name: `cally-threequarter-${'f'.repeat(8)}.png` }, fingerprint),
    /does not match its subject fingerprint/
  );
  assert.throws(
    () => normalizeInlineSceneVideoReference({ ...good, name: `cally-threequarter-${'f'.repeat(15)}.png` }, fingerprint),
    /does not match its subject fingerprint/
  );
});

test('rejects foreign, mis-fingerprinted, duplicated, and out-of-range reference sets', () => {
  const solo = sceneRequest();
  const soloReferences = referencesFor(solo);
  const build = (request, references) => buildInlineSceneVideoRequest({ conversationId, epoch, request, references });

  // One-to-one: the cast is one subject, and every picture must be that subject's.
  assert.throws(
    () => build(solo, [...soloReferences, reference('cally', 'face')]),
    /does not belong to the scene cast/
  );
  assert.throws(
    () => build(solo, [reference('cally', 'face')]),
    /does not belong to the scene cast/
  );
  assert.throws(
    () => build(solo, [{ ...soloReferences[0], profileId: 'kerr-avon' }]),
    /does not belong to the scene cast/
  );
  assert.throws(
    () => build(solo, [reference('jenna', 'face', 0, fingerprintOf('cally'))]),
    /does not match its subject fingerprint/
  );
  assert.throws(
    () => build(solo, [reference('jenna', 'face', 0, 'd'.repeat(8))]),
    /does not match its subject fingerprint/
  );
  assert.throws(
    () => build(solo, [soloReferences[0], soloReferences[0]]),
    /references are duplicated/
  );
  assert.throws(
    () => build(solo, [soloReferences[0], { ...soloReferences[0], sha256: 'a'.repeat(64) }]),
    /references are duplicated/
  );
  assert.throws(
    () => build(solo, [{ ...soloReferences[0], name: 'other' }]),
    /does not match its profile and view/
  );
  assert.throws(() => build(solo, []), /between 1 and 9 references/);
  assert.throws(() => build(solo, 'none'), /between 1 and 9 references/);
  const ten = ALL_VIEWS.concat(ALL_VIEWS).concat(ALL_VIEWS).slice(0, 10)
    .map((view, index) => reference(sceneCandidate.id, view, index));
  assert.equal(ten.length, 10);
  assert.throws(() => build(solo, ten), /between 1 and 9 references/);
  assert.deepEqual(build(solo, [soloReferences[0]]).source.references, [soloReferences[0]]);
  const everyView = build(solo, referencesFor(solo, ALL_VIEWS));
  assert.deepEqual(everyView.source.references.map(({ view }) => view), ALL_VIEWS);
  assert.deepEqual(
    build(solo, soloReferences).source.references.map(({ name }) => name),
    soloReferences.map(({ name }) => name)
  );
});

test('rejects provenance drift between the clip request and its scene', () => {
  const request = buildInlineSceneVideoRequest(motionSource());
  const withSource = (source) => ({ ...request, source: { ...request.source, ...source } });
  assert.throws(() => normalizeInlineSceneVideoRequest(null), /must be an object/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, spec: 'mullet_inline_scene_video_request_v6' }), /request spec/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, modelTemplate: 'minimax-h3-fl2va-scene-loop-v1' }), /model template/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, mode: 'flf2v_loop' }), /mode/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, mode: 'ref2va' }), /mode/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, source: null }), /source is invalid/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' })), /source provenance/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ epoch: 'not-a-uuid' })), /source provenance/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ sceneRequestKey: 'wrong' })), /source provenance/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ sceneRequest: { ...request.source.sceneRequest, prompt: prompt + ' Extra.' } })), /prompt hash|source provenance/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ sceneRequest: null })), /inline-scene image request spec/);
  assert.throws(() => normalizeInlineSceneVideoRequest(withSource({ references: null })), /between 1 and 9 references/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, aspectRatio: '3:2' }), /aspect ratio does not match/);
  assert.throws(() => normalizeInlineSceneVideoRequest({ ...request, durationSeconds: 5 }), /duration/);
  assert.throws(() => buildInlineSceneVideoRequest({ ...motionSource(), epoch: '' }), /source provenance/);
  assert.throws(
    () => buildInlineSceneVideoRequest({ ...motionSource(), conversationId: '748b08b7-20bb-4138-a402-0188cc04d2ea' }),
    /source provenance/
  );
  // A cast whose fingerprint changed invalidates the references prepared for it.
  const rekeyed = {
    ...request.source.sceneRequest,
    cast: {
      kind: 'solo',
      identities: [{ ...request.source.sceneRequest.cast.identities[0], profileFingerprint: 'a'.repeat(64) }]
    }
  };
  assert.throws(
    () => normalizeInlineSceneVideoRequest(withSource({ sceneRequest: rekeyed, sceneRequestKey: inlineSceneImageRequestKey(rekeyed) })),
    /does not match its subject fingerprint/
  );
});

test('binds every picture to the one subject and demands a close, solitary, silent shot', () => {
  const solo = buildInlineSceneVideoRequest(motionSource());
  const bound = buildInlineSceneVideoPrompt(solo);
  assert.match(
    bound,
    /^Use the pictures only as the identity of Jenna Stannis: Jenna Stannis is the person in <Picture 1> face, <Picture 2> three-quarter view, <Picture 3> clothing from the waist up\./
  );
  assert.ok(bound.includes(solo.source.sceneRequest.prompt));
  // The three defects the operator named on 2026-09-03: a distant subject, other people
  // in the frame, and speech where none belongs.
  assert.ok(bound.includes('Jenna Stannis is the only person in the frame: no other people, no bystanders, no crowd, no silhouettes, and no reflections of anyone else.'));
  assert.ok(bound.includes('a close medium shot of Jenna Stannis from roughly the waist up'));
  assert.ok(bound.includes('never pulls back to a wide landscape'));
  assert.ok(bound.includes('Keep the face unobstructed, sharp, and matching the reference pictures exactly.'));
  assert.ok(bound.includes('no talking, no lip or mouth movement, no speech gestures, and no singing; the mouth stays closed'));
  assert.ok(bound.includes(MINIMAX_H3_REFERENCE_SCENE_TEMPLATE.promptGuide));
  assert.ok(bound.endsWith('no black frames.'));
  assert.equal(bound.includes('<Picture 4>'), false);
  assert.equal(bound.includes('<Subject'), false);

  const oneReference = buildInlineSceneVideoRequest(motionSource(sceneRequest(), [reference(sceneCandidate.id, 'face')]));
  assert.match(
    buildInlineSceneVideoPrompt(oneReference),
    /identity of Jenna Stannis: Jenna Stannis is the person in <Picture 1> face\./
  );
});

test('submits one MiniMaxH3ReferenceToVideo graph loading the refpack pictures by name', () => {
  const scene = sceneRequest();
  const references = referencesFor(scene);
  const request = buildInlineSceneVideoRequest({ conversationId, epoch, request: scene, references });
  const graph = buildInlineSceneVideoWorkflow(request, 7);
  const template = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE;
  assert.deepEqual(
    Object.keys(graph).sort((left, right) => Number(left) - Number(right)),
    ['1', '2', '3', '4', '6', '7', '8', '9', '10', '11', '12', '14', '15', '16', '18', '20', '21', '22']
  );
  assert.equal(graph['1'].class_type, 'UNETLoader');
  assert.equal(graph['1'].inputs.unet_name, template.modelFiles.unet);
  assert.equal(graph['2'].inputs.clip_name, template.modelFiles.clip);
  assert.equal(graph['2'].inputs.type, 'minimax');
  assert.equal(graph['3'].inputs.vae_name, template.modelFiles.videoVae);
  assert.equal(graph['4'].inputs.vae_name, template.modelFiles.audioVae);
  const conditioning = graph['6'];
  assert.equal(conditioning.class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(conditioning.inputs.clip, ['2', 0]);
  assert.deepEqual(conditioning.inputs.vae, ['3', 0]);
  assert.deepEqual(conditioning.inputs.audio_vae, ['4', 0]);
  assert.equal(conditioning.inputs.prompt, buildInlineSceneVideoPrompt(request));
  assert.equal(conditioning.inputs.width, 1024);
  assert.equal(conditioning.inputs.height, 576);
  assert.equal(conditioning.inputs.length, 73);
  assert.equal(conditioning.inputs.ref_image_size, 'max');
  assert.deepEqual(conditioning.inputs.ref_images, {
    ref_image_0: ['20', 0],
    ref_image_1: ['21', 0],
    ref_image_2: ['22', 0]
  });
  assert.equal(Object.keys(conditioning.inputs).some((key) => key.startsWith('ref_images.')), false);
  references.forEach((entry, index) => {
    const node = graph[String(20 + index)];
    assert.equal(node.class_type, 'LoadImage');
    assert.equal(node.inputs.image, `mullet/identity/refpack/${entry.name}`);
  });
  assert.equal(graph['20'].inputs.image, `mullet/identity/refpack/jenna-face-${'d'.repeat(16)}.png`);
  assert.equal(Object.values(graph).filter(({ class_type }) => class_type === 'LoadImage').length, references.length);
  assert.deepEqual(graph['7'].inputs, { model: ['18', 0], conditioning: ['6', 0] });
  assert.equal(graph['8'].inputs.sampler_name, 'euler');
  assert.deepEqual(graph['9'].inputs, { model: ['18', 0], scheduler: 'simple', steps: 4, denoise: 1 });
  assert.equal(graph['10'].inputs.noise_seed, 7);
  assert.deepEqual(graph['11'].inputs.latent_image, ['6', 1]);
  assert.deepEqual(graph['12'].inputs, { samples: ['11', 0], vae: ['3', 0] });
  assert.deepEqual(graph['14'].inputs, { images: ['12', 0], fps: 24 });
  assert.deepEqual(graph['15'].inputs, {
    video: ['14', 0],
    filename_prefix: 'mullet/scene-motion-ref',
    format: 'auto',
    codec: 'auto'
  });
  assert.equal('audio' in graph['14'].inputs, false);
  assert.deepEqual(graph['16'].inputs, { model: ['1', 0], lora_name: template.modelFiles.turboLora, strength_model: 1 });
  assert.deepEqual(graph['18'].inputs, { model: ['16', 0], shift_video: 6, shift_audio: 3 });
  assert.equal(inlineSceneVideoOutputNode(request), '15');
  const serialized = JSON.stringify(graph);
  assert.equal(serialized.includes('motion-inputs'), false);
  assert.equal(serialized.includes('fl2v'), false);
  assert.equal(serialized.includes('MiniMaxH3ImageToVideo'), false);

  const wide = buildInlineSceneVideoRequest(motionSource(sceneRequest('3:2')));
  const wideGraph = buildInlineSceneVideoWorkflow(wide, 0);
  assert.equal(wideGraph['6'].inputs.width, 928);
  assert.equal(wideGraph['6'].inputs.height, 640);
  assert.equal(wideGraph['10'].inputs.noise_seed, 0);
  // Up to nine pictures of the one subject still load in connection order.
  // A reference name carries profile, view and fingerprint, so one subject has as many
  // pictures as there are views; each loads in connection order.
  const everyView = ALL_VIEWS.map((view) => reference(sceneCandidate.id, view));
  const deepGraph = buildInlineSceneVideoWorkflow(buildInlineSceneVideoRequest(motionSource(sceneRequest(), everyView)), 1);
  assert.deepEqual(
    Object.keys(deepGraph['6'].inputs.ref_images),
    ALL_VIEWS.map((_, index) => `ref_image_${index}`)
  );
  assert.equal(deepGraph[String(20 + ALL_VIEWS.length - 1)].class_type, 'LoadImage');
  assert.equal(deepGraph[String(20 + ALL_VIEWS.length - 1)].inputs.image, `mullet/identity/refpack/${everyView.at(-1).name}`);
  assert.throws(() => buildInlineSceneVideoWorkflow(request, -1), /seed is invalid/);
  assert.throws(() => buildInlineSceneVideoWorkflow(request, 1.5), /seed is invalid/);
});

test('normalizes the single-template capability report and its availability', () => {
  const available = normalizeInlineSceneVideoCapabilities({
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates: [{ template: { id: INLINE_SCENE_VIDEO_TEMPLATE_ID }, available: true, missing: [] }]
  });
  assert.equal(INLINE_SCENE_VIDEO_CAPABILITIES_SPEC, 'mullet_inline_scene_video_capabilities_v7');
  assert.equal(available.templates.length, 1);
  assert.equal(available.templates[0].template, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE);
  assert.deepEqual(available.durations, [3]);
  assert.equal(available.aspectRatios, INLINE_SCENE_VIDEO_DIMENSIONS);
  assert.equal(inlineSceneVideoTemplateAvailable(available), true);
  const degraded = normalizeInlineSceneVideoCapabilities({
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates: [{
      template: { id: INLINE_SCENE_VIDEO_TEMPLATE_ID },
      available: false,
      missing: ['node:MiniMaxH3ReferenceToVideo', 'node:MiniMaxH3ReferenceToVideo']
    }]
  });
  assert.equal(inlineSceneVideoTemplateAvailable(degraded), false);
  assert.deepEqual(degraded.templates[0].missing, ['node:MiniMaxH3ReferenceToVideo']);
  assert.equal(inlineSceneVideoTemplateAvailable(null), false);
  assert.throws(() => normalizeInlineSceneVideoCapabilities({
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates: [{ template: { id: INLINE_SCENE_VIDEO_TEMPLATE_ID }, available: true, missing: ['x'] }]
  }), /contradicts diagnostics/);
  assert.throws(() => normalizeInlineSceneVideoCapabilities({
    spec: INLINE_SCENE_VIDEO_CAPABILITIES_SPEC,
    templates: [{ template: { id: 'minimax-h3-fl2va-scene-loop-v1' }, available: true, missing: [] }]
  }), /template capability/);
  assert.throws(() => normalizeInlineSceneVideoCapabilities({ spec: 'mullet_inline_scene_video_capabilities_v6', templates: [] }), /capabilities/);
});

test('blocks replacement generation until persisted motion restoration finishes', () => {
  const ready = {
    scenesEnabled: true,
    motionEnabled: true,
    capabilitiesReady: true,
    persistenceReady: true,
    persistenceAvailable: true,
    restorationPending: false,
    streaming: false,
    sceneBusy: false,
    videoBusy: false,
    videoError: false,
    requestReady: true,
    current: false
  };
  assert.equal(inlineSceneVideoReconciliationAllowed(ready), true);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, restorationPending: true }), false);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, videoError: true }), false);
  assert.equal(inlineSceneVideoReconciliationAllowed({ ...ready, current: true }), false);
});

test('maps teardown and decode failure to non-generating playback states', () => {
  const request = buildInlineSceneVideoRequest(motionSource());
  assert.deepEqual(
    inlineSceneVideoDecodeFailureTransition(true, request),
    { action: 'ignore' }
  );
  assert.deepEqual(
    inlineSceneVideoDecodeFailureTransition(false, request),
    {
      action: 'show-static-fallback',
      error: 'The generated scene motion could not be decoded; showing the static scene.',
      attemptKey: inlineSceneVideoRequestKey(request)
    }
  );
  assert.equal(
    inlineSceneVideoDecodeFailureTransition(false, null).attemptKey,
    null
  );
});

test('restores persisted motion when the master scene toggle is re-enabled', () => {
  assert.equal(inlineSceneVideoMasterToggleAction(false, true, true), 'abort');
  assert.equal(inlineSceneVideoMasterToggleAction(true, true, true), 'restore');
  assert.equal(inlineSceneVideoMasterToggleAction(true, false, true), 'none');
  assert.equal(inlineSceneVideoMasterToggleAction(true, true, false), 'none');
});

test('blocks the master scene toggle while a motion persistence operation is queued', () => {
  assert.equal(inlineSceneMasterToggleEnabled(true, true, true), true);
  assert.equal(inlineSceneMasterToggleEnabled(true, true, false), false);
  assert.equal(inlineSceneMasterToggleEnabled(false, true, true), false);
  assert.equal(inlineSceneMasterToggleEnabled(true, false, true), false);
});

test('rejects missing, empty, and non-canonical integer provenance headers', () => {
  assert.equal(parseInlineSceneVideoIntegerHeader('0', 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER), 0);
  assert.equal(parseInlineSceneVideoIntegerHeader('42', 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER), 42);
  for (const value of [null, '', ' 0', '00', '+1', '1.0', '9007199254740992']) {
    assert.throws(
      () => parseInlineSceneVideoIntegerHeader(value, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
      /omitted x-mullet-seed/
    );
  }
});

test('accepts only a canonical finite encoded-duration header', () => {
  const duration = 73 / 24;
  assert.equal(parseInlineSceneVideoNumberHeader(String(duration), 'x-mullet-duration-seconds', 0.001, 3_600), duration);
  for (const value of [null, '', ' 5', '05', '+5', '5.0', '.5', '5.', '5e0', 'NaN', 'Infinity']) {
    assert.throws(
      () => parseInlineSceneVideoNumberHeader(value, 'x-mullet-duration-seconds', 0.001, 3_600),
      /omitted x-mullet-duration-seconds/
    );
  }
});

test('reference scene graph nests the pictures under ref_images and names them in order', async () => {
  const { buildMiniMaxH3ReferenceSceneWorkflow, buildMiniMaxH3ReferenceScenePrompt, MINIMAX_H3_REFERENCE_SCENE_TEMPLATE: template } = await import('../src/lib/inline-scene-video.ts');
  const references = [
    { subject: 'Jan', view: 'face', image: 'mullet/identity/refpack/jan-pollock-face-493aecb2.png' },
    { subject: 'Jan', view: 'waistup', image: 'mullet/identity/refpack/jan-pollock-waistup-493aecb2.png' }
  ];
  const built = buildMiniMaxH3ReferenceScenePrompt('She sets a mug on the counter.', 'grey shirt.', references);
  assert.match(built, /^Use the pictures only as the identity of Jan: Jan is the person in <Picture 1> face, <Picture 2> clothing from the waist up\./);
  assert.ok(built.includes('Jan is the only person in the frame'));
  const graph = buildMiniMaxH3ReferenceSceneWorkflow({ prompt: built, references, width: 1024, height: 576, frames: 73, fps: 24, seed: 7 });
  const node = graph['6'];
  assert.equal(node.class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(node.inputs.ref_images, { ref_image_0: ['20', 0], ref_image_1: ['21', 0] });
  assert.equal(node.inputs.ref_image_size, 'max');
  assert.equal(graph['1'].inputs.unet_name, template.modelFiles.unet);
  assert.equal(graph['16'].inputs.lora_name, template.modelFiles.turboLora);
  assert.equal(graph['21'].inputs.image, references[1].image);
  assert.equal(Object.keys(graph).filter((id) => graph[id].class_type === 'LoadImage').length, 2);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt: built, references: [], width: 1024, height: 576, frames: 73, fps: 24, seed: 7 }), /between 1 and 9/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt: built, references, width: 1000, height: 576, frames: 73, fps: 24, seed: 7 }), /multiples of 32/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt: built, references, width: 1024, height: 576, frames: 72, fps: 24, seed: 7 }), /5 \+ 17k/);
  assert.throws(() => buildMiniMaxH3ReferenceSceneWorkflow({ prompt: built, references: [{ subject: 'X', view: 'face', image: '../etc/passwd.png' }], width: 1024, height: 576, frames: 73, fps: 24, seed: 7 }), /mullet input namespace/);
});
