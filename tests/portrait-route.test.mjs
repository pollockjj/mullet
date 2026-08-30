import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = resolve(repositoryRoot, 'scratch/build-portrait-route');
const publicOrigin = 'https://mullet.test';
const deadComfyBaseUrl = 'http://127.0.0.1:1';

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

test('compiled portrait route rejects stale selectable expression contracts before ComfyUI', { timeout: 120_000 }, async (context) => {
  execFileSync(process.execPath, [resolve(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      BASE_PATH: '/mullet',
      BUILD_OUTPUT_DIR: buildDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let comfyCalls = 0;
  const comfyServer = createServer((_request, response) => {
    comfyCalls += 1;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'forged request reached ComfyUI' }));
  });
  let appServer;
  context.after(async () => {
    await close(appServer);
    await close(comfyServer);
  });
  const comfyBaseUrl = await listen(comfyServer);
  process.env.IMAGE_COMFY_BASE_URL = comfyBaseUrl;
  process.env.VIDEO_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.EXPRESSION_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.SCENE_COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.COMFY_BASE_URL = deadComfyBaseUrl;
  process.env.ORIGIN = publicOrigin;
  process.env.BUILD_SHA = 'portrait-route-test';
  process.env.PUBLIC_BUILD_SHA = 'portrait-route-test';
  const handlerModule = await import(`${pathToFileURL(resolve(buildDirectory, 'handler.js')).href}?test=${Date.now()}`);
  appServer = createServer(handlerModule.handler);
  const appBaseUrl = await listen(appServer);

  const requestBody = {
    spec: 'mullet_portrait_request_v5',
    modelTemplate: 'z-image-turbo-v1',
    source: {
      conversationId: '8d78c151-83f0-4c72-9b9b-1ab957adca78',
      messageCount: 2,
      messageIndex: 1,
      fingerprint: '4:1234abcd',
      expression: 'joy'
    },
    subject: 'Jenna Stannis',
    setting: 'the Liberator flight deck',
    attire: 'a rust-red and deep maroon Liberator tunic',
    lora: null,
    referenceImage: null,
    aspectRatio: '1:1',
    megapixels: 0.5
  };
  const response = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicOrigin
    },
    body: JSON.stringify(requestBody)
  });
  assert.equal(response.status, 400, await response.text());

  const legacyResponse = await fetch(`${appBaseUrl}/mullet/api/portrait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: publicOrigin
    },
    body: JSON.stringify({ ...requestBody, spec: 'mullet_portrait_request_v4', aspectRatio: '9:16' })
  });
  assert.equal(legacyResponse.status, 400, await legacyResponse.text());
  assert.equal(comfyCalls, 0);
});
