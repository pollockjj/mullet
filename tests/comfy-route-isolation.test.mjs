import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

async function source(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), 'utf8');
}

function runtimeProperties(routeSource) {
  return [...routeSource.matchAll(/\bruntime\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);
}

test('runtime exposes independent image and video Comfy endpoints without a legacy fallback', async () => {
  const runtimeSource = await source('src/lib/server/runtime.ts');

  assert.match(
    runtimeSource,
    /imageComfyBaseUrl\s*:\s*\(env\.IMAGE_COMFY_BASE_URL\s*\?\?\s*['"]{2}\)/
  );
  assert.match(
    runtimeSource,
    /videoComfyBaseUrl\s*:\s*\(env\.VIDEO_COMFY_BASE_URL\s*\?\?\s*['"]{2}\)/
  );
  assert.doesNotMatch(runtimeSource, /\bcomfyBaseUrl\s*:/);
  assert.doesNotMatch(runtimeSource, /\bCOMFY_BASE_URL\b/);
  assert.doesNotMatch(runtimeSource, /\bEXPRESSION_COMFY_BASE_URL\b/);
  assert.doesNotMatch(runtimeSource, /\bSCENE_COMFY_BASE_URL\b/);
});

test('image and video routes cannot cross their dedicated Comfy endpoint boundary', async () => {
  const routeExpectations = [
    ['src/routes/api/portrait/+server.ts', ['imageComfyBaseUrl']],
    ['src/routes/api/portrait/video/+server.ts', ['imageComfyBaseUrl', 'videoComfyBaseUrl']],
    ['src/routes/api/scene/+server.ts', ['imageComfyBaseUrl']],
    ['src/routes/api/scene/video/+server.ts', ['videoComfyBaseUrl']]
  ];

  for (const [relativePath, expectedProperties] of routeExpectations) {
    const routeSource = await source(relativePath);
    assert.deepEqual(
      new Set(runtimeProperties(routeSource)),
      new Set(expectedProperties),
      `${relativePath} must use only ${expectedProperties.map((property) => `runtime.${property}`).join(' and ')}`
    );
    assert.doesNotMatch(routeSource, /\bCOMFY_BASE_URL\b/, `${relativePath} must not read the legacy environment variable`);
    assert.doesNotMatch(routeSource, /\bEXPRESSION_COMFY_BASE_URL\b/, `${relativePath} must not read the legacy expression endpoint`);
    assert.doesNotMatch(routeSource, /\bSCENE_COMFY_BASE_URL\b/, `${relativePath} must not read the legacy scene endpoint`);
  }
});
