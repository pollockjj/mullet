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

// Lanes are split by pipeline: expression still, end frame and motion on one instance,
// scene still and motion on the other, so the two pipelines never queue behind each other.
test('expression and scene pipelines cannot cross their dedicated Comfy endpoint boundary', async () => {
  const routeExpectations = [
    ['src/routes/api/portrait/+server.ts', ['expressionComfyBaseUrl']],
    ['src/routes/api/portrait/video/+server.ts', ['expressionComfyBaseUrl']],
    ['src/routes/api/scene/+server.ts', ['sceneComfyBaseUrl']],
    ['src/routes/api/scene/video/+server.ts', ['sceneComfyBaseUrl']]
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
