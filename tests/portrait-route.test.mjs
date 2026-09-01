import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
} from '../src/lib/portrait.ts';
import { buildPngFixture } from './png-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';
const ownedPromptId = '77777777-7777-4777-8777-777777777777';
const canonicalBytes = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  0x02, 0x58,
  0x01, 0x90,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
]);
const canonicalReference = Object.freeze({
  name: 'jenna-stannis-v1.jpg',
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: createHash('sha256').update(canonicalBytes).digest('hex'),
  width: 400,
  height: 600,
  aspectRatio: '2:3'
});
const managedBodyBytes = buildPngFixture(576, 1024);
const managedBodySha256 = createHash('sha256').update(managedBodyBytes).digest('hex');
const managedBodyReference = Object.freeze({
  name: `body-jenna-stannis-1234abcd-${managedBodySha256}.png`,
  subfolder: 'mullet/identity',
  type: 'input',
  sha256: managedBodySha256,
  width: 576,
  height: 1024,
  aspectRatio: '9:16'
});
const portraitOutputBytes = buildPngFixture(576, 1024);

function node(name, required = {}, optional = {}, output = undefined) {
  return { [name]: { input: { required, optional }, ...(output ? { output } : {}) } };
}



function h3Form(request = h3Request(), reference = managedBodyBytes) {
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  if (reference) form.append('reference', new Blob([reference], { type: 'image/png' }), 'untrusted.png');
  return form;
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolveClose, reject) => {
    server.close((cause) => cause ? reject(cause) : resolveClose());
  });
  server.closeAllConnections();
  await closed;
}

