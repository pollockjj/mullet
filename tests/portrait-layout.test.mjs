import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('generated expression stage is fixed 2:3 at the proven 0.9 MP default with no aspect selector', () => {
  assert.match(
    pageSource,
    /const portraitAspectRatio: PortraitAspectRatio = '2:3';/
  );
  assert.match(
    pageSource,
    /let portraitMegapixels: PortraitMegapixels = 0\.9;/
  );
  assert.match(
    pageSource,
    /\.portrait\.generated \{ aspect-ratio: 2 \/ 3; border-color:/
  );
  assert.match(pageSource, /portraitMegapixelsStorageKey = 'mullet\.portrait-megapixels\.v3'/);
  assert.doesNotMatch(pageSource, /portraitDisplayAspectRatio/);
  assert.doesNotMatch(pageSource, /style:--portrait-aspect-ratio/);
  assert.doesNotMatch(pageSource, /aria-label="Portrait aspect ratio"/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-aspect/);
  assert.doesNotMatch(pageSource, /portraitMegapixelsStorageKey = 'mullet\.portrait-megapixels';/);
  assert.match(pageSource, /aria-label="Inline scene aspect ratio"/);
});

test('a scenario never falls back to Z-Image when its Qwen reference capability is unavailable', () => {
  assert.match(pageSource, /if \(!profile \|\| !referenceTemplateAvailable\) return null;/);
  assert.match(pageSource, /portraitModelTemplateAvailable\(portraitCapabilities, selectedRequest\.modelTemplate\)/);
  assert.match(pageSource, /promptOverride: profile\.expressionPrompts\[result\.output\.expression\] \?\? null/);
  assert.match(pageSource, /Qwen Image Edit 2511 · unavailable/);
  assert.match(pageSource, /Qwen Image Edit 2511 reference editing is unavailable\. No scenario expression portrait will be generated\./);
  assert.doesNotMatch(pageSource, /portraitRequest\?\.modelTemplate \?\? portraitCapabilities\.template\.id/);
});
