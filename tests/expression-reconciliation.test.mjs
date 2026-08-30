import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('never renders a restored expression portrait unless it matches the current request', () => {
  assert.match(pageSource, /generatedPortraitUrl && portraitCurrent\} class="portrait"/);
  assert.match(pageSource, /\{:else if expressionsEnabled && generatedPortraitUrl && portraitCurrent\}/);
  assert.doesNotMatch(pageSource, /\{:else if expressionsEnabled && generatedPortraitUrl\}/);
});

test('an unavailable selected expression model exposes an in-place capability refresh', () => {
  assert.match(pageSource, /selectedPortraitCapability && !portraitSelectedModelAvailable/);
  assert.match(pageSource, /class="error-retry" on:click=\{\(\) => void loadPortraitGenerator\(\)\}/);
  assert.match(pageSource, /portraitCapabilitiesLoading \? 'Checking…' : 'Refresh models'/);
});

test('each automatic expression stage receives at most one delayed retry per failed key', () => {
  for (const stage of ['Expression', 'Portrait', 'PortraitVideo']) {
    assert.match(pageSource, new RegExp(`function queue${stage}AutomaticRetry\\(key: string\\)`));
  }
  assert.match(pageSource, /expressionRetriedKey === key\) return;/);
  assert.match(pageSource, /portraitRetriedKey === key\) return;/);
  assert.match(pageSource, /portraitVideoRetriedKey === key\) return;/);
  assert.match(pageSource, /queueExpressionAutomaticRetry\(key\);/);
  assert.match(pageSource, /queuePortraitAutomaticRetry\(key\);/);
  assert.match(pageSource, /queuePortraitVideoAutomaticRetry\(key\);/);
  assert.match(pageSource, /automaticExpressionRetryDelayMs = 1_500/);
});
