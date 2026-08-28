import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('generated expression stage is fixed 1:1 at the 0.5 MP default with no aspect selector', () => {
  assert.match(
    pageSource,
    /const portraitAspectRatio: PortraitAspectRatio = '1:1';/
  );
  assert.match(
    pageSource,
    /let portraitMegapixels: PortraitMegapixels = 0\.5;/
  );
  assert.match(
    pageSource,
    /\.portrait\.generated \{ aspect-ratio: 1 \/ 1; border-color:/
  );
  assert.match(pageSource, /portraitMegapixelsStorageKey = 'mullet\.portrait-megapixels\.v2'/);
  assert.doesNotMatch(pageSource, /portraitDisplayAspectRatio/);
  assert.doesNotMatch(pageSource, /style:--portrait-aspect-ratio/);
  assert.doesNotMatch(pageSource, /aria-label="Portrait aspect ratio"/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-aspect/);
  assert.doesNotMatch(pageSource, /portraitMegapixelsStorageKey = 'mullet\.portrait-megapixels';/);
  assert.match(pageSource, /aria-label="Inline scene aspect ratio"/);
});

test('a scenario never falls back to Z-Image when its FLUX reference capability is unavailable', () => {
  assert.match(pageSource, /if \(!profile \|\| !referenceTemplateAvailable\) return null;/);
  assert.match(pageSource, /portraitModelTemplateAvailable\(portraitCapabilities, selectedRequest\.modelTemplate\)/);
  assert.match(pageSource, /FLUX\.2 Klein 9B Distilled · unavailable/);
  assert.match(pageSource, /FLUX\.2 Klein 9B reference editing is unavailable\. No scenario expression portrait will be generated\./);
  assert.doesNotMatch(pageSource, /portraitRequest\?\.modelTemplate \?\? portraitCapabilities\.template\.id/);
});
