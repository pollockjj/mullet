import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');

test('generated portrait stage uses the displayed media dimensions', () => {
  assert.match(
    pageSource,
    /portraitDisplayAspectRatio = expressionsEnabled && generatedPortraitUrl && generatedPortrait\s+\? `\$\{generatedPortrait\.width\} \/ \$\{generatedPortrait\.height\}`\s+: '3 \/ 4'/
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
});
