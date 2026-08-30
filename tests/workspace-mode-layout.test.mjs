import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('keeps workspace switching out of the permanent fiction sidebar', () => {
  assert.doesNotMatch(pageSource, /class="mode-picker"/);
  assert.doesNotMatch(pageSource, />Workspace mode</);
  assert.doesNotMatch(pageSource, /aria-label="Workspace mode"/);
  assert.doesNotMatch(pageSource, /<section[^>]*workspace-mode/i);
  assert.doesNotMatch(pageSource, /\.mode-picker\s*\{/);

  const header = pageSource.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? '';
  const outsideHeader = pageSource.replace(header, '');
  assert.match(header, /<details class="runtime">/);
  assert.match(header, /<summary aria-label="Runtime and workspace controls">/);
  assert.match(header, /<div class="runtime-menu" aria-label="Conversation mode">/);
  assert.match(header, />Fiction<\/button>/);
  assert.match(header, />Assistant<\/button>/);
  assert.doesNotMatch(outsideHeader, />\s*Workspace(?: mode)?\s*</i);
});
