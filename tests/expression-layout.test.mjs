import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
const expressionPanel = pageSource.match(
  /<section class="expression-panel" aria-label="Expression sidecar">[\s\S]*?<\/section>/
)?.[0] ?? '';

test('expression toggle owns automatic determination and exposes only a compact rerun action', () => {
  assert.match(pageSource, /scheduleExpressionReconciliation\([\s\S]*?expressionsEnabled/);
  assert.match(pageSource, /void determineExpression\(snapshot\);/);
  assert.match(expressionPanel, /bind:checked=\{expressionsEnabled\}/);
  assert.match(expressionPanel, /\{#if expressionsEnabled\}[\s\S]*?class="expression-redetermine"/);
  assert.match(expressionPanel, /Redetermine expression/);
  assert.doesNotMatch(expressionPanel, /'Determine expression'/);
  assert.match(pageSource, /\.expression-redetermine \{[^}]*width: auto;[^}]*padding: 3px 6px;/);
  assert.doesNotMatch(pageSource, /\.expression-panel > button/);
});
