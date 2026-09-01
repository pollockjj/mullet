import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { ensureComfyManagedReferences } from '../src/lib/server/comfy-managed-reference.ts';
import { buildPngFixture, pngWithReplacementIdat, pngWithoutIdat } from './png-fixture.mjs';

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function reference(name, bytes, width = 400, height = 600) {
  return {
    name,
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: hash(bytes),
    width,
    height,
    aspectRatio: `${width / greatestCommonDivisor(width, height)}:${height / greatestCommonDivisor(width, height)}`
  };
}

function managedReference(bytes, overrides = {}) {
  const profileId = overrides.profileId ?? 'jenna-stannis';
  const fingerprint = overrides.fingerprint ?? '1234abcd';
  const digest = hash(bytes);
  const width = overrides.width ?? 576;
  const height = overrides.height ?? 1024;
  const ratioDivisor = greatestCommonDivisor(width, height);
  return {
    name: `body-${profileId}-${fingerprint}-${overrides.nameSha256 ?? digest}.png`,
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: digest,
    width,
    height,
    aspectRatio: overrides.aspectRatio ?? `${width / ratioDivisor}:${height / ratioDivisor}`
  };
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function imageResponse(bytes) {
  return new Response(bytes, { headers: { 'content-type': 'image/png' } });
}

function attachment(bytes, type = 'image/png') {
  return new Blob([bytes], { type });
}

test('accepts zero attachments for resident bundled references and deduplicates by SHA', async () => {
  const bytes = buildPngFixture(400, 600);
  const requested = reference('bundled.png', bytes);
  let views = 0;
  const fetcher = async (input, init) => {
    views += 1;
    assert.equal(init?.method, undefined);
    const url = new URL(String(input));
    assert.equal(url.pathname, '/view');
    assert.equal(url.searchParams.get('filename'), requested.name);
    assert.equal(url.searchParams.get('subfolder'), 'mullet/identity');
    assert.equal(url.searchParams.get('type'), 'input');
    return imageResponse(bytes);
  };

  await ensureComfyManagedReferences(fetcher, 'http://comfy/', [requested, { ...requested }], []);
  assert.equal(views, 1);
});

test('uploads only a missing attached reference with overwrite=false and then verifies it', async () => {
  const bytes = buildPngFixture(576, 1024, 1);
  const requested = managedReference(bytes);
  let views = 0;
  let uploads = 0;
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/view') {
      views += 1;
      return views === 1 ? new Response('missing', { status: 404 }) : imageResponse(bytes);
    }
    assert.equal(url.pathname, '/upload/image');
    uploads += 1;
    assert.equal(init?.method, 'POST');
    assert.ok(init?.body instanceof FormData);
    assert.deepEqual([...init.body.keys()], ['image', 'subfolder', 'type', 'overwrite']);
    const uploaded = init.body.get('image');
    assert.ok(uploaded instanceof Blob);
    assert.equal(uploaded.name, requested.name);
    assert.equal(uploaded.type, 'image/png');
    assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), bytes);
    assert.equal(init.body.get('subfolder'), 'mullet/identity');
    assert.equal(init.body.get('type'), 'input');
    assert.equal(init.body.get('overwrite'), 'false');
    return Response.json({ name: requested.name, subfolder: 'mullet/identity', type: 'input' });
  };

  await ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(bytes)]);
  assert.equal(uploads, 1);
  assert.equal(views, 2);
});

test('allows attachments to cover only references not already resident', async () => {
  const bundledBytes = buildPngFixture(400, 600, 2);
  const attachedBytes = buildPngFixture(576, 1024, 3);
  const bundled = reference('bundled.png', bundledBytes);
  const attached = managedReference(attachedBytes, { profileId: 'cally', fingerprint: '87654321' });
  let attachedViews = 0;
  let uploads = 0;
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/view') {
      const name = url.searchParams.get('filename');
      if (name === bundled.name) return imageResponse(bundledBytes);
      attachedViews += 1;
      return attachedViews === 1 ? new Response(null, { status: 404 }) : imageResponse(attachedBytes);
    }
    uploads += 1;
    const form = init?.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('image').name, attached.name);
    return Response.json({ name: attached.name, subfolder: 'mullet/identity', type: 'input' });
  };

  await ensureComfyManagedReferences(
    fetcher,
    'http://comfy',
    [bundled, attached],
    [attachment(attachedBytes)]
  );
  assert.equal(uploads, 1);
});

test('rejects unexpected and duplicate attachments before any Comfy request', async () => {
  const bytes = buildPngFixture(576, 1024, 4);
  const requested = managedReference(bytes);
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('must not fetch');
  };

  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(buildPngFixture(576, 1024, 5))]),
    /attachment was not requested/
  );
  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(bytes), attachment(bytes)]),
    /attachment is duplicated/
  );
  assert.equal(calls, 0);
});

test('rejects malformed, truncated, bad-CRC, corrupt-deflate, scanline, filter, interlace, missing-IDAT, and trailing-byte PNGs', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('must not fetch');
  };

  const valid = buildPngFixture(576, 1024, 12);
  const malformed = valid.slice();
  malformed[0] = 0;
  const truncated = valid.slice(0, -1);
  const invalidCrc = valid.slice();
  invalidCrc[32] ^= 1;
  const invalidIdatCrc = valid.slice();
  const idatLength = new DataView(invalidIdatCrc.buffer).getUint32(33, false);
  invalidIdatCrc[33 + 8 + idatLength] ^= 1;
  const invalidDeflate = pngWithReplacementIdat(valid, new Uint8Array([1, 2, 3, 4]));
  const invalidLength = pngWithReplacementIdat(valid, deflateSync(new Uint8Array([0])));
  const excessiveScanlines = new Uint8Array(((576 + 1) * 1024) + 1);
  const excessiveLength = pngWithReplacementIdat(valid, deflateSync(excessiveScanlines));
  const invalidFilterScanlines = new Uint8Array((576 + 1) * 1024);
  invalidFilterScanlines[0] = 5;
  const invalidFilter = pngWithReplacementIdat(valid, deflateSync(invalidFilterScanlines));
  const interlaced = buildPngFixture(576, 1024, 12, { interlace: 1 });
  const missingIdat = pngWithoutIdat(valid);
  const trailing = new Uint8Array(valid.byteLength + 1);
  trailing.set(valid);
  for (const [bytes, message] of [
    [malformed, /invalid PNG signature/],
    [truncated, /truncated PNG chunk/],
    [invalidCrc, /IHDR CRC is invalid/],
    [invalidIdatCrc, /IDAT CRC is invalid/],
    [invalidDeflate, /invalid compressed image data/],
    [invalidLength, /scanline length is invalid/],
    [excessiveLength, /scanline length is invalid/],
    [invalidFilter, /invalid scanline filter/],
    [interlaced, /invalid IHDR/],
    [missingIdat, /invalid terminal IEND/],
    [trailing, /invalid terminal IEND/]
  ]) {
    const requested = managedReference(bytes);
    await assert.rejects(
      ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(bytes)]),
      message
    );
  }
  assert.equal(calls, 0);
});

test('rejects non-content-addressed names, wrong SHA suffixes, unsafe profiles, and noncanonical geometry', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('must not fetch');
  };
  const valid = buildPngFixture(576, 1024, 13);
  const canonical = managedReference(valid);
  const wrongGeometryBytes = buildPngFixture(512, 768, 14);
  const rejected = [
    [{ ...canonical, name: 'job-reference.png' }, /target name is not content-addressed/],
    [managedReference(valid, { nameSha256: '0'.repeat(64) }), /target name does not match its SHA-256/],
    [managedReference(valid, { profileId: 'Jenna_Stannis' }), /target name is not content-addressed/],
    [managedReference(wrongGeometryBytes, { width: 512, height: 768 }), /metadata must be exactly 576x1024/],
    [{ ...canonical, width: 512, height: 768, aspectRatio: '2:3' }, /metadata must be exactly 576x1024/],
    [{ ...canonical, aspectRatio: '2:3' }, /aspect ratio does not match its dimensions/]
  ];
  for (const [requested, message] of rejected) {
    const bytes = requested.sha256 === canonical.sha256 ? valid : wrongGeometryBytes;
    await assert.rejects(
      ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(bytes)]),
      message
    );
  }
  assert.equal(calls, 0);
});

test('rejects mislabeled and oversized managed attachments before upload', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('must not fetch');
  };

  const valid = buildPngFixture(576, 1024, 15);
  const validReference = managedReference(valid);
  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [validReference], [attachment(valid, 'image/jpeg')]),
    /must have PNG media type/
  );

  const oversizedBytes = new Uint8Array((20 * 1024 * 1024) + 1);
  const oversizedReference = managedReference(oversizedBytes);
  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [oversizedReference], [attachment(oversizedBytes)]),
    /attachment has an invalid size/
  );
  assert.equal(calls, 0);
});

test('rejects missing unattached references without uploading', async () => {
  const bytes = buildPngFixture(400, 600, 6);
  const requested = reference('missing.png', bytes);
  let calls = 0;
  const fetcher = async (input) => {
    calls += 1;
    assert.equal(new URL(String(input)).pathname, '/view');
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], []),
    /managed identity reference is unavailable: missing\.png/
  );
  assert.equal(calls, 1);
});

test('does not upload over an existing reference that fails integrity verification', async () => {
  const expected = buildPngFixture(576, 1024, 7);
  const tampered = buildPngFixture(576, 1024, 8);
  const requested = managedReference(expected);
  let calls = 0;
  const fetcher = async (input) => {
    calls += 1;
    assert.equal(new URL(String(input)).pathname, '/view');
    return imageResponse(tampered);
  };

  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(expected)]),
    /does not match its profile/
  );
  assert.equal(calls, 1);
});

test('rejects conflicting requested metadata before any Comfy request', async () => {
  const firstBytes = buildPngFixture(400, 600, 9);
  const secondBytes = buildPngFixture(400, 600, 10);
  const first = reference('same.png', firstBytes);
  const conflictingPath = reference('same.png', secondBytes);
  const conflictingHash = { ...first, name: 'other.png' };
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error('must not fetch');
  };

  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [first, conflictingPath], []),
    /path has conflicting hashes/
  );
  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [first, conflictingHash], []),
    /hash has conflicting metadata/
  );
  assert.equal(calls, 0);
});

test('requires the upload response to preserve the exact declared location', async () => {
  const bytes = buildPngFixture(576, 1024, 11);
  const requested = managedReference(bytes);
  let calls = 0;
  const fetcher = async (input) => {
    calls += 1;
    const url = new URL(String(input));
    if (url.pathname === '/view') return new Response(null, { status: 404 });
    return Response.json({ name: 'wrong.png', subfolder: 'mullet/identity', type: 'input' });
  };

  await assert.rejects(
    ensureComfyManagedReferences(fetcher, 'http://comfy', [requested], [attachment(bytes)]),
    /unexpected managed identity reference upload location/
  );
  assert.equal(calls, 2);
});
