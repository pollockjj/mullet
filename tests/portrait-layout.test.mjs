import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('generated expression stage is fixed 2:3 with no portrait aspect selector', () => {
  assert.match(
    pageSource,
    /portraitDisplayAspectRatio = expressionsEnabled && generatedPortraitUrl && generatedPortrait\s+\? '2 \/ 3'\s+: '3 \/ 4'/
  );
  assert.match(
    pageSource,
    /class="portrait" style:--portrait-aspect-ratio=\{portraitDisplayAspectRatio\}/
  );
  assert.match(
    pageSource,
    /\.portrait \{ aspect-ratio: var\(--portrait-aspect-ratio, 3 \/ 4\);/
  );
  assert.doesNotMatch(pageSource, /\.portrait \{ aspect-ratio: 3 \/ 4;/);
  assert.doesNotMatch(pageSource, /aria-label="Portrait aspect ratio"/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-aspect/);
  assert.match(pageSource, /aria-label="Inline scene aspect ratio"/);
});
