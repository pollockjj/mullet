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

test('runtime exposes independent expression and scene Comfy endpoints without a legacy fallback', async () => {
  const runtimeSource = await source('src/lib/server/runtime.ts');

  assert.match(
    runtimeSource,
    /expressionComfyBaseUrl\s*:\s*\(env\.EXPRESSION_COMFY_BASE_URL\s*\?\?\s*['"]{2}\)/
  );
  assert.match(
    runtimeSource,
    /sceneComfyBaseUrl\s*:\s*\(env\.SCENE_COMFY_BASE_URL\s*\?\?\s*['"]{2}\)/
  );
  assert.doesNotMatch(runtimeSource, /\bcomfyBaseUrl\s*:/);
  assert.doesNotMatch(runtimeSource, /\bCOMFY_BASE_URL\b/);
});

test('portrait and scene routes cannot cross their dedicated Comfy endpoint boundary', async () => {
  const routeExpectations = [
    ['src/routes/api/portrait/+server.ts', 'expressionComfyBaseUrl'],
    ['src/routes/api/portrait/video/+server.ts', 'expressionComfyBaseUrl'],
    ['src/routes/api/scene/+server.ts', 'sceneComfyBaseUrl'],
    ['src/routes/api/scene/video/+server.ts', 'sceneComfyBaseUrl']
  ];

  for (const [relativePath, expectedProperty] of routeExpectations) {
    const routeSource = await source(relativePath);
    assert.deepEqual(
      new Set(runtimeProperties(routeSource)),
      new Set([expectedProperty]),
      `${relativePath} must use only runtime.${expectedProperty}`
    );
    assert.doesNotMatch(routeSource, /\bCOMFY_BASE_URL\b/, `${relativePath} must not read the legacy environment variable`);
  }
});
