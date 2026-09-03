import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildKrea2TurboImageWorkflow } from '../src/lib/portrait.ts';
import { inflightPromptIds } from '../src/lib/server/inflight.ts';
import {
  SCENE_REFERENCE_SUBFOLDER,
  SCENE_REFERENCE_VIEWS,
  ensureSceneReferences,
  sceneReferenceName
} from '../src/lib/server/comfy-scene-references.ts';

const STILL = 'http://still-lane:8188';
const LOOP = 'http://loop-lane:8189';
const VIEWS = SCENE_REFERENCE_VIEWS.map(({ view }) => view);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// The module's only cache is a process-wide Map keyed by profile fingerprint, so every
// test mints its own fingerprint and no run can be served by another test's entry.
function fingerprint(label) {
  return sha256(Buffer.from(`fingerprint:${label}`));
}

// Minimal PNG-shaped bytes: signature, IHDR, then a tag so views hash differently.
function png(width, height, tag = 0) {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[39] = tag & 0xff;
  return bytes;
}

const janIdentity = png(1024, 1024, 0x4a);

function janProfile(label, overrides = {}) {
  return {
    id: 'jan-pollock',
    fingerprint: fingerprint(label),
    displayName: 'Jan Pollock',
    subject: 'Jan Pollock, an adult brunette woman with long softly wavy dark-brown hair, clear blue eyes, '
      + 'fair skin, an oval face, and a gentle closed-mouth smile',
    seed: 560103,
    subjectLora: {
      name: 'janpollock-krea2-v3-attn.safetensors',
      trigger: 'janpollock',
      sha256: '45cb6a77582ed989ce022ae55de2cfc917bbdc8f52a4a7781288001abad41ba3'
    },
    referenceImage: {
      name: 'cabin-jan-v1.png',
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: sha256(janIdentity),
      width: 1024,
      height: 1024
    },
    ...overrides
  };
}

// The deterministic refpack names for one profile, in the module's emitted view order.
function refpackNames(profile, views = VIEWS) {
  return views.map((view) => sceneReferenceName(profile.id, view, profile.fingerprint));
}

function loopProbe(name) {
  return { filename: name, subfolder: SCENE_REFERENCE_SUBFOLDER, type: 'input' };
}

// Two fake ComfyUI lanes behind one fetcher, keyed by origin, method, and path.
// The still lane renders Krea prompts and serves identity photos; the loop lane
// stores uploads under mullet/identity/refpack and serves them back on /view.
function createLanes(options = {}) {
  const requests = [];
  const prompts = [];
  const uploads = [];
  const renders = new Map();
  const stored = new Map(options.stored ?? []);
  const identity = new Map(options.identity ?? []);
  let renderCount = 0;
  const fetcher = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(String(input));
    const query = url.searchParams;
    requests.push({ method, url: url.toString(), query: Object.fromEntries(query), init });
    if (url.origin === new URL(STILL).origin) {
      if (method === 'POST' && url.pathname === '/prompt') {
        const body = JSON.parse(init.body);
        renderCount += 1;
        const id = `00000000-0000-4000-8000-${String(renderCount).padStart(12, '0')}`;
        const filename = `refpack_${String(renderCount).padStart(5, '0')}_.png`;
        const latent = body.prompt['7'].inputs;
        const bytes = png(latent.width, latent.height, renderCount);
        prompts.push({ id, workflow: body.prompt, clientId: body.client_id, bytes });
        renders.set(id, { filename, bytes });
        return Response.json({ prompt_id: id });
      }
      if (method === 'GET' && url.pathname.startsWith('/history/')) {
        const id = decodeURIComponent(url.pathname.slice('/history/'.length));
        const override = options.history?.(id);
        if (override) return override;
        const render = renders.get(id);
        if (!render) return Response.json({});
        return Response.json({
          [id]: {
            status: { completed: true, status_str: 'success' },
            outputs: { 10: { images: [{ filename: render.filename, subfolder: 'mullet', type: 'output' }] } }
          }
        });
      }
      if (method === 'GET' && url.pathname === '/view' && query.get('type') === 'output') {
        const render = [...renders.values()].find((entry) => entry.filename === query.get('filename'));
        if (!render || query.get('subfolder') !== 'mullet') return new Response('missing', { status: 404 });
        return new Response(render.bytes, { headers: { 'content-type': 'image/png' } });
      }
      if (method === 'GET' && url.pathname === '/view' && query.get('type') === 'input') {
        const bytes = identity.get(`${query.get('subfolder')}/${query.get('filename')}`);
        if (!bytes) return new Response('missing', { status: 404 });
        return new Response(bytes, { headers: { 'content-type': 'image/png' } });
      }
      if (method === 'POST' && /^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)) return Response.json({});
    }
    if (url.origin === new URL(LOOP).origin) {
      if (method === 'GET' && url.pathname === '/view') {
        const bytes = query.get('type') === 'input' && query.get('subfolder') === SCENE_REFERENCE_SUBFOLDER
          ? stored.get(query.get('filename'))
          : undefined;
        if (!bytes) return new Response('missing', { status: 404 });
        const headers = { 'content-type': 'image/png' };
        if (options.contentLength !== false) headers['content-length'] = String(bytes.byteLength);
        return new Response(bytes, { headers });
      }
      if (method === 'POST' && url.pathname === '/upload/image') {
        const form = init.body;
        const file = form.get('image');
        const bytes = new Uint8Array(await file.arrayBuffer());
        uploads.push({
          name: file.name,
          mediaType: file.type,
          subfolder: form.get('subfolder'),
          type: form.get('type'),
          overwrite: form.get('overwrite'),
          bytes
        });
        stored.set(file.name, bytes);
        return Response.json({ name: file.name, subfolder: form.get('subfolder'), type: 'input' });
      }
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return {
    fetcher,
    requests,
    prompts,
    uploads,
    stored,
    cancels: () => requests.filter((entry) => entry.method === 'POST' && /\/api\/jobs\/[^/]+\/cancel$/.test(entry.url)),
    forget: (name) => stored.delete(name),
    stillRequests: () => requests.filter((entry) => entry.url.startsWith(`${STILL}/`)),
    loopViews: () => requests.filter((entry) => entry.method === 'GET' && entry.url.startsWith(`${LOOP}/view?`))
  };
}

test('sceneReferenceName keys the refpack entry on the profile fingerprint', () => {
  const fp = fingerprint('naming');
  assert.equal(sceneReferenceName('jan-pollock', 'face', fp), `jan-pollock-face-${fp.slice(0, 16)}.png`);
  // Scenario fingerprints are 8-hex FNV-1a digests and are used whole.
  assert.equal(sceneReferenceName('jan-pollock', 'identity', '0a1b2c3d'), 'jan-pollock-identity-0a1b2c3d.png');
  assert.throws(() => sceneReferenceName('Jan Pollock', 'face', fp), /scene reference profile id is invalid/);
  assert.throws(() => sceneReferenceName('jan-pollock', 'profile', fp), /scene reference view is invalid/);
  assert.throws(() => sceneReferenceName('jan-pollock', 'face', 'abc'), /scene reference fingerprint is invalid/);
  assert.throws(() => sceneReferenceName('jan-pollock', 'face', 'NOTHEX01'), /scene reference fingerprint is invalid/);
  assert.throws(() => sceneReferenceName('jan-pollock', 'face', 'a'.repeat(65)), /scene reference fingerprint is invalid/);
  assert.equal(SCENE_REFERENCE_SUBFOLDER, 'mullet/identity/refpack');
  assert.deepEqual(
    SCENE_REFERENCE_VIEWS.map(({ view, width, height }) => [view, width, height]),
    [['face', 832, 1024], ['threequarter', 832, 1024], ['waistup', 832, 1024]]
  );
});

test('the Krea builder accepts the refpack filename prefix and still rejects unknown ones', () => {
  const settings = { prompt: 'a test', width: 832, height: 1024, seed: 1, lora: null };
  const graph = buildKrea2TurboImageWorkflow({ ...settings, filenamePrefix: 'mullet/refpack' });
  assert.equal(graph['10'].inputs.filename_prefix, 'mullet/refpack');
  assert.throws(
    () => buildKrea2TurboImageWorkflow({ ...settings, filenamePrefix: 'mullet/other' }),
    /Krea filename prefix is invalid/
  );
});

test('a cold LoRA profile probes the loop lane, renders three Krea views, then uploads them', async () => {
  const lanes = createLanes();
  const profile = janProfile('cold-lora');
  const names = refpackNames(profile);

  const references = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);

  // Every view is asked for by name on the loop lane before anything is rendered: the
  // first three requests of the whole run are the three misses.
  assert.deepEqual(lanes.requests.slice(0, 3).map((entry) => entry.query), names.map(loopProbe));
  assert.deepEqual(lanes.requests.slice(0, 3).map((entry) => `${entry.method} ${new URL(entry.url).origin}`),
    [`GET ${LOOP}`, `GET ${LOOP}`, `GET ${LOOP}`]);
  // 3 misses plus one verification GET per upload.
  assert.equal(lanes.loopViews().length, 6);

  assert.equal(lanes.prompts.length, 3);
  lanes.prompts.forEach((entry, index) => {
    const spec = SCENE_REFERENCE_VIEWS[index];
    assert.equal(entry.clientId, 'mullet-scene-reference');
    assert.equal(entry.workflow['10'].inputs.filename_prefix, 'mullet/refpack');
    assert.equal(entry.workflow['8'].inputs.seed, profile.seed + index);
    assert.equal(entry.workflow['11'].class_type, 'LoraLoaderModelOnly');
    assert.equal(entry.workflow['11'].inputs.lora_name, profile.subjectLora.name);
    assert.deepEqual(entry.workflow['7'].inputs, { width: spec.width, height: spec.height, batch_size: 1 });
    const prompt = entry.workflow['4'].inputs.text;
    assert.ok(prompt.startsWith(`${spec.text} of janpollock, Jan Pollock, `), prompt);
    assert.ok(prompt.endsWith('. No text, watermark, or extra people.'), prompt);
  });
  assert.equal(lanes.prompts[0].workflow['4'].inputs.text.startsWith('photorealistic neutral close-up portrait'), true);
  // The third view is waist up, not a full figure: a full-body reference pulls the clip
  // back into a distant landscape.
  assert.equal(lanes.prompts[2].workflow['4'].inputs.text.includes('waist-up photo facing the camera'), true);
  assert.equal(lanes.prompts.some(({ workflow }) => workflow['4'].inputs.text.includes('head to shoes')), false);

  // The returned hashes are the hashes of the bytes the still lane produced; the names
  // carry the profile fingerprint, not the image hash.
  const expected = VIEWS.map((view, index) => ({
    profileId: 'jan-pollock',
    view,
    sha256: sha256(lanes.prompts[index].bytes),
    name: names[index]
  }));
  assert.deepEqual(references, expected);

  assert.equal(lanes.uploads.length, 3);
  lanes.uploads.forEach((upload, index) => {
    assert.equal(upload.name, names[index]);
    assert.equal(upload.mediaType, 'image/png');
    assert.equal(upload.subfolder, 'mullet/identity/refpack');
    assert.equal(upload.type, 'input');
    assert.equal(upload.overwrite, 'true');
    assert.deepEqual(upload.bytes, lanes.prompts[index].bytes);
  });

  // Nothing was queued on the loop lane and nothing was uploaded to the still lane.
  assert.equal(lanes.requests.some((entry) => entry.url.startsWith(`${LOOP}/prompt`)), false);
  assert.equal(lanes.requests.some((entry) => entry.url.startsWith(`${STILL}/upload/image`)), false);
  assert.equal(lanes.cancels().length, 0);
  assert.deepEqual(inflightPromptIds(), []);
});

test('a pack already on the loop lane renders nothing and uploads nothing', async () => {
  const profile = janProfile('warm');
  const names = refpackNames(profile);
  const stored = new Map(names.map((name, index) => [name, png(832, 1024, 0xa0 + index)]));
  const lanes = createLanes({ stored });

  const references = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);

  assert.equal(lanes.prompts.length, 0, 'a prepared pack is never re-rendered');
  assert.equal(lanes.uploads.length, 0, 'a prepared pack is never re-uploaded');
  assert.deepEqual(lanes.loopViews().map((entry) => entry.query), names.map(loopProbe));
  assert.deepEqual(lanes.stillRequests(), [], 'the still lane is never touched');
  // The sha256 is the hash of the bytes the loop lane handed back.
  assert.deepEqual(references, VIEWS.map((view, index) => ({
    profileId: 'jan-pollock',
    view,
    sha256: sha256(stored.get(names[index])),
    name: names[index]
  })));
  assert.deepEqual(inflightPromptIds(), []);
});

test('a cached pack is re-confirmed on the lane and re-rendered when the lane loses it', async () => {
  const profile = janProfile('recheck');
  const names = refpackNames(profile);
  const stored = new Map(names.map((name, index) => [name, png(832, 1024, 0xb0 + index)]));
  const lanes = createLanes({ stored });

  const first = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);
  assert.equal(lanes.prompts.length, 0);
  const firstProbes = lanes.loopViews().length;
  assert.equal(firstProbes, names.length);

  // Second call, same process: the in-memory entry is still confirmed against the lane,
  // which MULLET does not own, before it is reported as prepared.
  const second = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);
  assert.deepEqual(second, first);
  assert.equal(lanes.prompts.length, 0, 'a confirmed pack is never re-rendered');
  assert.equal(lanes.uploads.length, 0);
  assert.equal(lanes.loopViews().length, firstProbes + names.length, 'every cached view is re-confirmed');

  // The lane's input namespace is cleaned between turns: the pack is rebuilt, not trusted.
  lanes.forget(names[1]);
  const third = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);
  assert.equal(lanes.prompts.length, 1, 'only the view the lane lost is re-rendered');
  assert.deepEqual(lanes.uploads.map(({ name }) => name), [names[1]]);
  assert.deepEqual(third.map(({ name }) => name), names);
  assert.deepEqual(inflightPromptIds(), []);
});

test('a partially prepared pack renders and uploads only the missing view', async () => {
  const profile = janProfile('partial');
  const names = refpackNames(profile);
  // face and waistup are already on the loop lane; the three-quarter view is not.
  const stored = new Map([[names[0], png(832, 1024, 0xb0)], [names[2], png(832, 1024, 0xb2)]]);
  const lanes = createLanes({ stored });

  const references = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);

  assert.equal(lanes.prompts.length, 1);
  // The seed offset follows the view's index in the full view list, not the render order.
  assert.equal(lanes.prompts[0].workflow['8'].inputs.seed, profile.seed + 1);
  assert.deepEqual(lanes.prompts[0].workflow['7'].inputs, { width: 832, height: 1024, batch_size: 1 });
  assert.equal(lanes.uploads.length, 1);
  assert.equal(lanes.uploads[0].name, names[1]);
  assert.deepEqual(lanes.uploads[0].bytes, lanes.prompts[0].bytes);
  // 3 probes plus the one upload verification.
  assert.equal(lanes.loopViews().length, 4);

  // Emitted in view order regardless of which views were warm.
  assert.deepEqual(references.map((reference) => reference.view), ['face', 'threequarter', 'waistup']);
  assert.deepEqual(references.map((reference) => reference.name), names);
  assert.deepEqual(references.map((reference) => reference.sha256), [
    sha256(stored.get(names[0])),
    sha256(lanes.prompts[0].bytes),
    sha256(stored.get(names[2]))
  ]);
  assert.deepEqual(inflightPromptIds(), []);
});

test('a profile without a Krea LoRA uploads its identity photo as the single reference', async () => {
  const profile = janProfile('identity', { subjectLora: null });
  const lanes = createLanes({ identity: [['mullet/identity/cabin-jan-v1.png', janIdentity]] });

  const references = await ensureSceneReferences(lanes.fetcher, STILL, LOOP, [profile]);

  const name = sceneReferenceName('jan-pollock', 'identity', profile.fingerprint);
  assert.deepEqual(references, [{ profileId: 'jan-pollock', view: 'identity', sha256: sha256(janIdentity), name }]);
  assert.equal(lanes.prompts.length, 0);
  assert.equal(lanes.uploads.length, 1);
  assert.equal(lanes.uploads[0].name, name);
  assert.equal(lanes.uploads[0].subfolder, 'mullet/identity/refpack');
  assert.deepEqual(lanes.uploads[0].bytes, janIdentity);
  // The identity photo is read from the still lane at its own input location.
  assert.deepEqual(lanes.stillRequests().map((entry) => entry.query), [
    { filename: 'cabin-jan-v1.png', subfolder: 'mullet/identity', type: 'input' }
  ]);

  // A LoRA that is not a Krea LoRA takes the identity path too.
  const zimage = janProfile('identity-zimage', {
    subjectLora: { name: 'zimage/jan6.safetensors', trigger: 'jan', sha256: 'c'.repeat(64) }
  });
  const zimageLanes = createLanes({ identity: [['mullet/identity/cabin-jan-v1.png', janIdentity]] });
  const zimageReferences = await ensureSceneReferences(zimageLanes.fetcher, STILL, LOOP, [zimage]);
  assert.equal(zimageLanes.prompts.length, 0);
  assert.deepEqual(zimageReferences.map((reference) => reference.view), ['identity']);
});

test('a missing or mismatched identity photo on the still lane is an error and uploads nothing', async () => {
  const missing = createLanes();
  await assert.rejects(
    ensureSceneReferences(missing.fetcher, STILL, LOOP, [janProfile('identity-missing', { subjectLora: null })]),
    (error) => {
      assert.ok(
        error.message.startsWith('identity reference is unavailable on the still lane:'),
        error.message
      );
      assert.match(error.message, /mullet\/identity\/cabin-jan-v1\.png \(404\)$/);
      return true;
    }
  );
  assert.equal(missing.uploads.length, 0);

  const forged = janProfile('identity-forged', { subjectLora: null });
  forged.referenceImage = { ...forged.referenceImage, sha256: '0'.repeat(64) };
  const mismatched = createLanes({ identity: [['mullet/identity/cabin-jan-v1.png', janIdentity]] });
  await assert.rejects(
    ensureSceneReferences(mismatched.fetcher, STILL, LOOP, [forged]),
    /does not match its profile hash/
  );
  assert.equal(mismatched.uploads.length, 0);
});

test('a failed render is reported without cancelling the settled prompt', async () => {
  const lanes = createLanes({
    history: (id) => Response.json({ [id]: { status: { completed: true, status_str: 'error' }, outputs: {} } })
  });
  await assert.rejects(
    ensureSceneReferences(lanes.fetcher, STILL, LOOP, [janProfile('render-error')]),
    /scene reference render failed/
  );
  assert.equal(lanes.prompts.length, 1);
  assert.equal(lanes.cancels().length, 0);
  assert.equal(lanes.uploads.length, 0);
  assert.deepEqual(inflightPromptIds(), []);
});

test('an aborted signal cancels only the prompt that was submitted', async () => {
  const controller = new AbortController();
  const lanes = createLanes({
    history: () => {
      controller.abort();
      return Response.json({});
    }
  });
  await assert.rejects(
    ensureSceneReferences(lanes.fetcher, STILL, LOOP, [janProfile('abort')], controller.signal),
    { name: 'AbortError' }
  );
  assert.equal(lanes.prompts.length, 1);
  const cancels = lanes.cancels();
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].url, `${STILL}/api/jobs/${lanes.prompts[0].id}/cancel`);
  assert.equal(lanes.uploads.length, 0);
  assert.deepEqual(inflightPromptIds(), []);
});

test('rejects malformed profile lists before touching either lane', async () => {
  const lanes = createLanes();
  const run = (profiles) => ensureSceneReferences(lanes.fetcher, STILL, LOOP, profiles);
  const four = ['a', 'b', 'c', 'd'].map((label) => janProfile(`too-many-${label}`, { id: `cast-${label}` }));
  await assert.rejects(run(four), /at most 3 profiles/);
  await assert.rejects(run([]), /at least one profile/);
  await assert.rejects(run([janProfile('dup-a'), janProfile('dup-b')]), /listed twice/);
  await assert.rejects(run([janProfile('bad-fp', { fingerprint: 'not-hex!' })]), /fingerprint is invalid/);
  await assert.rejects(run([janProfile('bad-fp-short', { fingerprint: 'abc' })]), /fingerprint is invalid/);
  await assert.rejects(run([janProfile('bad-seed', { seed: -1 })]), /seed is invalid/);
  await assert.rejects(run([janProfile('bad-seed-float', { seed: 1.5 })]), /seed is invalid/);
  await assert.rejects(run([janProfile('bad-id', { id: 'Jan' })]), /profile id is invalid/);
  await assert.rejects(
    run([janProfile('bad-lora', {
      subjectLora: { name: 'janpollock-krea2-v3-attn.safetensors', trigger: '', sha256: 'a'.repeat(64) }
    })]),
    /subject LoRA is invalid/
  );
  await assert.rejects(
    ensureSceneReferences(lanes.fetcher, 'still-lane', LOOP, [janProfile('bad-url')]),
    /still lane base URL is invalid/
  );
  await assert.rejects(
    ensureSceneReferences(lanes.fetcher, STILL, 'loop-lane', [janProfile('bad-loop-url')]),
    /loop lane base URL is invalid/
  );
  assert.equal(lanes.requests.length, 0);
});
