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

test('runtime exposes one Comfy endpoint per pipeline', async () => {
  const runtimeSource = await source('src/lib/server/runtime.ts');

  assert.match(runtimeSource, /expressionComfyBaseUrl\s*:/);
  assert.match(runtimeSource, /sceneComfyBaseUrl\s*:/);
  assert.match(runtimeSource, /EXPRESSION_COMFY_BASE_URL/);
  assert.match(runtimeSource, /SCENE_COMFY_BASE_URL/);
  assert.doesNotMatch(runtimeSource, /\bcomfyBaseUrl\s*:/);
});

// Each stage reads exactly one lane from the runtime. By default the four stages follow
// their pipeline lanes; per-stage overrides let the operator run the media-type layout
// (stills on one instance, H3 loops on the other) when it measures faster.
test('each stage reads exactly its own Comfy endpoint from the runtime', async () => {
  const routeExpectations = [
    ['src/routes/api/portrait/+server.ts', ['portraitStillComfyBaseUrl']],
    ['src/routes/api/portrait/video/+server.ts', ['portraitStillComfyBaseUrl', 'portraitVideoComfyBaseUrl']],
    ['src/routes/api/scene/+server.ts', ['sceneStillComfyBaseUrl']],
    ['src/routes/api/scene/video/+server.ts', ['sceneVideoComfyBaseUrl']]
  ];

  for (const [relativePath, expectedProperties] of routeExpectations) {
    const routeSource = await source(relativePath);
    assert.deepEqual(
      new Set(runtimeProperties(routeSource)),
      new Set(expectedProperties),
      `${relativePath} must use only ${expectedProperties.map((property) => `runtime.${property}`).join(' and ')}`
    );
    assert.doesNotMatch(routeSource, /\bCOMFY_BASE_URL\b/, `${relativePath} must not read the legacy environment variable`);
    assert.doesNotMatch(routeSource, /\bIMAGE_COMFY_BASE_URL\b/, `${relativePath} must not read the legacy image endpoint`);
    assert.doesNotMatch(routeSource, /\bSCENE_COMFY_BASE_URL\b/, `${relativePath} must not read the legacy scene endpoint`);
  }
});
